#!/usr/bin/env bash
# scripts/identity-secrets.sh: generate the identity stack's passwords into
# .secrets/identity/ (0600), create-only: an existing file is never replaced.
# Never prints a value. The people's passwords are also linked from
# .secrets/people/ (make people-copy-password reads them there).
#
#   ldap-admin-password, keycloak-admin-password   the services' admins
#   system/keycloak-bind     the before estate's standing bind password (D4)
#   system/vault-rotator     Vault's LDAP secrets engine bind (act 4)
#   booking-client-secret    the booking app's Keycloak client secret (D4)
#   users/saskia, users/teun the people (typed on forms, never printed)
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
umask 077
dir="$VULT_ROOT/.secrets/identity"
mkdir -p "$dir/system" "$dir/users" "$VULT_ROOT/.secrets/people"
made=0
gen() { # file bytes
  [ -s "$1" ] && return 0
  printf '%s' "$(openssl rand -base64 "$2" | tr -d '/+=\n' | cut -c1-32)" >"$1.tmp"
  mv "$1.tmp" "$1"
  made=$((made + 1))
}
gen "$dir/ldap-admin-password" 32
gen "$dir/keycloak-admin-password" 32
gen "$dir/system/keycloak-bind" 32
gen "$dir/system/vault-rotator" 32
gen "$dir/booking-client-secret" 32
for who in $(jq -r '.presenter.user, .clerk.user' "$VULT_ROOT/config/story.json"); do
  gen "$dir/users/$who" 24
  [ -s "$VULT_ROOT/.secrets/people/$who" ] || cp "$dir/users/$who" "$VULT_ROOT/.secrets/people/$who"
done
echo "identity-secrets: $made new, the rest kept (.secrets/identity, 0600; never printed)"
