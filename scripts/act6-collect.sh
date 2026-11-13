#!/usr/bin/env bash
# scripts/act6-collect.sh: act 6's records, from the systems' own logs, into
# .build/act6/raw.json for api/lib/timeline.js (ansible/act-6.yml runs it).
#
#   audit    Vault's audit log on every node since the drill started,
#            namespace tidewell, responses only, trimmed to who, what, when,
#            request id, error and lease id (HMAC on: no value is in it)
#   pg       PostgreSQL's connection log for the app's dynamic users
#   targets  GitHub's update time for the deploy token (gh, through
#            make github-evidence) and LocalStack's LastChangedDate
#   leases   the revoked lease (and when it ended)
# Read-only; nothing here prints a value.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
d="$BUILD_DIR/act6"
drill="$d/drill.json"
[ -s "$drill" ] || die "act6-collect: no drill yet (make act-6)"
since=$(jq -r .started_at "$drill")
pg_since=$(date -u -j -f %Y-%m-%dT%H:%M:%SZ "$since" "+%Y-%m-%d %H:%M:%S")

audit=$(for n in vault_1 vault_2 vault_3; do podman exec "vult-$n" tail -n 50000 /vault/audit/audit.log 2>/dev/null || true; done |
  jq -c --arg s "$since" 'select(.type == "response" and .time >= $s and (.request.namespace.path // "") == "tidewell/")
    | {type, time, error, request: {id: .request.id, path: .request.path, operation: .request.operation},
       auth: {display_name: .auth.display_name}, response: {secret: {lease_id: .response.secret.lease_id}}}' | jq -s 'sort_by(.time)')

pg=$(podman exec vult-postgres tail -n 100000 /var/log/postgresql/postgresql.json |
  jq -c --arg s "$pg_since" 'select(.timestamp >= $s and ((.user // "") | startswith("v-tidewell-booking")))
    | {timestamp, user, message, pid, error_severity}' | jq -s .)

./scripts/github-evidence.sh >/dev/null 2>&1 || echo "act6-collect: no fresh GitHub evidence (gh)" >&2
gh_name=$(jq -r .deploy.github_name config/story.json)
aws_name=$(jq -r .deploy.aws_name config/story.json)
gh=$(jq -c --arg n "$gh_name" '[.secrets[]? | select(.name == $n) | {system: "github", name, at: .updated_at}]' "$BUILD_DIR/github/evidence.json" 2>/dev/null || echo '[]')
ls=$(curl -sS --cacert vault-tls/ca-chain.pem "https://localhost:$(vult_conf VULT_PORT_LOCALSTACK)/" \
  -H 'X-Amz-Target: secretsmanager.DescribeSecret' -H 'Content-Type: application/x-amz-json-1.1' \
  -H "Authorization: AWS4-HMAC-SHA256 Credential=test/20260101/$(vult_conf VULT_AWS_REGION)/secretsmanager/aws4_request, SignedHeaders=host, Signature=0" \
  --data "{\"SecretId\": \"$aws_name\"}" | jq -c --arg n "$aws_name" '[{system: "localstack", name: $n, at: (.LastChangedDate | floor | todate)}]' || echo '[]')

jq -n --slurpfile drill "$drill" --argjson audit "$audit" --argjson pg "$pg" --argjson gh "$gh" --argjson ls "$ls" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{collected_at: $at, drill: $drill[0], audit: $audit, pg: $pg, targets: ($gh + $ls),
    leases: [{lease: $drill[0].revoked_lease, ended_at: $drill[0].revoked_at, revoked: true}]}' >"$d/raw.json"
echo "act6-collect: $(jq '.audit | length' "$d/raw.json") audit responses, $(jq '.pg | length' "$d/raw.json") PostgreSQL lines, $(jq '.targets | length' "$d/raw.json") target times"
