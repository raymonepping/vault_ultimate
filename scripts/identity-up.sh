#!/usr/bin/env bash
# scripts/identity-up.sh (make identity-up): OpenLDAP and Keycloak. Passwords
# first (create-only), then the stack, the access rules, and the one-shot
# bootstraps the first time (or when stage-reset sets VULT_SET_*=1). The
# one-shot containers are removed after a good start, kept on failure.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
./scripts/identity-secrets.sh
./scripts/network.sh
./scripts/compose.sh identity up -d openldap keycloak >/dev/null
wait_healthy() {
  for _ in $(seq 1 80); do
    [ "$(podman inspect "$1" --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && return 0
    sleep 3
  done
  die "identity-up: $1 is not healthy (podman logs $1)"
}
wait_healthy vult-openldap
./scripts/ldap-acl.sh
./scripts/compose.sh identity --profile init run --rm --name vult-ldap_bootstrap ldap-bootstrap >/dev/null ||
  die "identity-up: the LDAP bootstrap failed (rerun: make identity-up)"
wait_healthy vult-keycloak
./scripts/compose.sh identity --profile init run --rm --name vult-keycloak_bootstrap keycloak-bootstrap |
  grep -E '^\s*[+*]|ready' || die "identity-up: the Keycloak bootstrap failed (rerun: make identity-up)"
./scripts/compose.sh identity rm -f identity-init >/dev/null 2>&1 || true
echo "identity-up: OpenLDAP and Keycloak ready (https://localhost:$(vult_conf VULT_PORT_KEYCLOAK)/realms/tidewell)"
