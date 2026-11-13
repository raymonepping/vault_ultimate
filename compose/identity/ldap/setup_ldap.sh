#!/usr/bin/env bash
# compose/identity/ldap/setup_ldap.sh: idempotent per-entry loader for
# bootstrap.ldif, then the people's and the system binds' passwords. Runs in
# the one-shot ldap-bootstrap container. Passwords come from /run/secrets
# (rendered by identity-init from .secrets/identity/), never from the LDIF.
# The keycloak-bind password is set only while Vault does not own it: after
# act 4 the LDAP secrets engine rotates it, and this loader must not undo that
# (stage-reset puts the before estate's password back on purpose).
set -euo pipefail

SECRETS=/run/secrets
LDAP_ADMIN_PASSWORD="$(cat "$SECRETS/ldap-admin-password")"
LDAP_HOST="${LDAP_HOST:-openldap}"
BASE_DN="${LDAP_BASE_DN:-dc=tidewell,dc=lab}"
BIND_DN="cn=admin,${BASE_DN}"
LDIF="/bootstrap/bootstrap.ldif"

for _ in $(seq 1 30); do
  ldapsearch -x -H "ldap://${LDAP_HOST}" -D "$BIND_DN" -w "$LDAP_ADMIN_PASSWORD" -b "$BASE_DN" -s base >/dev/null 2>&1 && break
  sleep 2
done

added=0 skipped=0 failed=0 entry="" bind_created=0
apply_entry() {
  [ -z "$1" ] && return 0
  local dn
  dn="$(printf '%s\n' "$1" | awk -F': ' '/^dn:/{print $2; exit}')"
  [ -z "$dn" ] && return 0
  if ldapsearch -x -H "ldap://${LDAP_HOST}" -D "$BIND_DN" -w "$LDAP_ADMIN_PASSWORD" -b "$dn" -s base >/dev/null 2>&1; then
    skipped=$((skipped + 1))
  elif printf '%s\n' "$1" | ldapadd -x -H "ldap://${LDAP_HOST}" -D "$BIND_DN" -w "$LDAP_ADMIN_PASSWORD" >/dev/null 2>&1; then
    echo "  + added: $dn"
    added=$((added + 1))
    case "$dn" in cn=keycloak-bind,*) bind_created=1 ;; esac
  else
    echo "  ! failed: $dn" >&2
    failed=$((failed + 1))
  fi
}
while IFS= read -r line; do
  if [ -z "$line" ]; then apply_entry "$entry"; entry=""
  elif [[ "$line" == \#* ]]; then continue
  else entry="${entry}${line}"$'\n'; fi
done <"$LDIF"
apply_entry "$entry"
echo "LDAP fixture: ${added} added, ${skipped} already present, ${failed} failed"
[ "$failed" -eq 0 ] || exit 1

setpw() { # dn file
  ldappasswd -x -H "ldap://${LDAP_HOST}" -D "$BIND_DN" -w "$LDAP_ADMIN_PASSWORD" -s "$(cat "$2")" "$1" >/dev/null 2>&1
}
set_count=0
for file in "$SECRETS"/users/*; do
  setpw "uid=$(basename "$file"),ou=people,${BASE_DN}" "$file" || { echo "  ! password NOT set: $(basename "$file")" >&2; exit 1; }
  set_count=$((set_count + 1))
done
setpw "cn=vault-rotator,ou=system,${BASE_DN}" "$SECRETS/system/vault-rotator" || { echo "  ! vault-rotator password NOT set" >&2; exit 1; }
set_count=$((set_count + 1))
# keycloak-bind: only when its entry was just created, or when the before estate asks for it
# (VULT_SET_KEYCLOAK_BIND=1 from stage-reset). Never over a Vault rotation.
if [ "$bind_created" = 1 ] || [ "${VULT_SET_KEYCLOAK_BIND:-0}" = 1 ]; then
  setpw "cn=keycloak-bind,ou=system,${BASE_DN}" "$SECRETS/system/keycloak-bind" || { echo "  ! keycloak-bind password NOT set" >&2; exit 1; }
  set_count=$((set_count + 1))
fi
echo "LDAP passwords: ${set_count} set from .secrets/identity (never printed)"
