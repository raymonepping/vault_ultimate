#!/usr/bin/env bash
# scripts/witness.sh (make witness): try every inventory credential with a
# real request (api/lib/witness.js) and record the answers, fingerprints and
# lifetimes in .build/witness/ (latest.json, history/, scoreboard.json).
# Values stay in the witness's memory; nothing here prints one.
#
# The host gathers what only the host can see (the act, GitHub's own record
# through gh, the canary note's time from PostgreSQL); the witness itself
# runs in a throwaway container on vult-internal, with the lab's record
# mounted read-only. Until the console API exists (prompt 08) it reads Vault
# with Ansible's token: reads only (leases, associations, wrapping lookup).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
out="$BUILD_DIR/witness"
mkdir -p "$out/history" "$BUILD_DIR/github"
[ -d api/node_modules/pg ] || (cd api && npm ci --omit=dev --no-audit --no-fund >/dev/null)

./scripts/github-evidence.sh >/dev/null 2>&1 || echo "witness: no fresh GitHub evidence (gh); the GitHub copy is judged on the last record" >&2
[ -f "$BUILD_DIR/github/evidence.json" ] || echo '{"secrets": []}' >"$BUILD_DIR/github/evidence.json"

act=$(cat "$BUILD_DIR/act" 2>/dev/null || echo 0)
# The act 0 canary: Teun's support note (its time, never its body).
note=$(podman exec vult-postgres gosu postgres psql -At -d tidewell -c \
  "select json_build_object('id', 'act0', 'note', id, 'credential', 'booking-db-password', 'posted_at', to_char(created_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')) from support_notes where author = 'teun' order by id limit 1" 2>/dev/null || true)
jq -n --argjson act "$act" --argjson note "${note:-null}" '{act: $act, canaries: [$note | select(. != null)]}' >"$out/host-facts.json"

podman run --rm --name vult-witness --network vult-internal \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  -e NODE_EXTRA_CA_CERTS=/ca/ca-chain.pem \
  -v "$VULT_ROOT/api:/app:ro" \
  -v "$VULT_ROOT/config:/cfg:ro" \
  -v "$VULT_ROOT/vault-tls/ca-chain.pem:/ca/ca-chain.pem:ro" \
  -v "$VULT_ROOT/.secrets/workload:/secrets/workload:ro" \
  -v "$VULT_ROOT/.secrets/identity/system/keycloak-bind:/secrets/ldap-bind:ro" \
  -v "$VULT_ROOT/.secrets/identity/booking-client-secret:/secrets/oidc-secret:ro" \
  -v "$VULT_ROOT/.secrets/vault/tokens/ansible-platform:/run/witness/token:ro" \
  -v "$BUILD_DIR/github:/github:ro" \
  -v "$out:/out" \
  -w /app "$(vult_conf NODE_IMAGE)" node bin/witness.js
