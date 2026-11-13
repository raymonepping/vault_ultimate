#!/usr/bin/env bash
# scripts/identity-verify.sh (make identity-verify): each person signs in to
# Keycloak through the LDAP federation (the lab-only tidewell-cli client) and
# gets the groups claim Vault will bind; Keycloak's bind account and Vault's
# rotator bind against OpenLDAP. Passwords are read from their files into the
# request body on stdin, never onto a command line; no token is printed.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
kc="https://localhost:$(vult_conf VULT_PORT_KEYCLOAK)"
fails=0
claims() { cut -d. -f2 | tr '_-' '/+' | awk '{ while (length($0) % 4) $0 = $0 "="; print }' | base64 -d 2>/dev/null; }
for who in $(jq -r '.presenter.user, .clerk.user' config/story.json); do
  want=$(jq -r --arg u "$who" 'if .presenter.user == $u then .presenter.group else .clerk.group end' config/story.json)
  got=$(tr -d '\n' <".secrets/people/$who" |
    curl -sS --cacert vault-tls/ca-chain.pem "$kc/realms/tidewell/protocol/openid-connect/token" \
      -d grant_type=password -d client_id=tidewell-cli -d "username=$who" --data-urlencode "password@-" |
    jq -r '.access_token // empty' | claims | jq -c '{user: .preferred_username, groups, aud}' 2>/dev/null || true)
  if [ -n "$got" ] && jq -e --arg g "$want" '.groups | index($g)' <<<"$got" >/dev/null; then
    printf '  \033[32mok\033[0m   %-8s signs in, %s\n' "$who" "$got"
  else
    printf '  \033[31mFAIL\033[0m %-8s did not sign in with group %s\n' "$who" "$want"
    fails=$((fails + 1))
  fi
done
for cn in keycloak-bind vault-rotator; do
  if podman exec vult-openldap sh -c "umask 077; tr -d '\\n' </run/secrets/system/$cn >/tmp/.pw; ldapwhoami -x -H ldap://localhost -D cn=$cn,ou=system,dc=tidewell,dc=lab -y /tmp/.pw; rc=\$?; rm -f /tmp/.pw; exit \$rc" >/dev/null 2>&1; then
    printf '  \033[32mok\033[0m   %-14s binds to OpenLDAP\n' "$cn"
  else
    printf '  \033[31mFAIL\033[0m %-14s does not bind\n' "$cn"
    fails=$((fails + 1))
  fi
done
[ "$fails" -eq 0 ] || die "identity-verify: $fails check(s) failed"
info "identity-verify: people sign in through Keycloak, the system binds work"
