#!/bin/sh
# compose/identity/keycloak/entrypoint.sh: keycloak/keycloak:26.x has no _FILE
# support for the bootstrap admin password (vault_dance). Read the value
# identity-init rendered, export it, then exec the real launcher.
set -eu
password_file=/run/secrets/keycloak-admin-password
attempt=0
until [ -s "$password_file" ]; do
  attempt=$((attempt + 1))
  [ "$attempt" -ge 30 ] && { echo "[entrypoint] $password_file never appeared" >&2; exit 1; }
  sleep 2
done
KC_BOOTSTRAP_ADMIN_USERNAME="admin"
KC_BOOTSTRAP_ADMIN_PASSWORD="$(cat "$password_file")"
export KC_BOOTSTRAP_ADMIN_USERNAME KC_BOOTSTRAP_ADMIN_PASSWORD
exec /opt/keycloak/bin/kc.sh "$@"
