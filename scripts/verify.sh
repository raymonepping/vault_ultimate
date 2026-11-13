#!/usr/bin/env bash
# scripts/verify.sh [section...]: end-to-end checks of the running lab.
# Sections: podman vault units platform stage cloud app console boundary
# drift idempotency secrets rehearsal (default: all). Read-only except
# rehearsal, which runs the four acts and ends with make stage-reset. The browser-level checks are Playwright's: make test-ui.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"

pass=0
fail=0
ok() {
  printf '  \033[32m✓\033[0m %s\n' "$*"
  pass=$((pass + 1))
}
bad() {
  printf '  \033[31m✗\033[0m %s\n' "$*"
  fail=$((fail + 1))
}
check() { # a failure shows the command's last lines (the lab's scripts never print a secret)
  local msg=$1
  shift
  if "$@" >"$TMP/check.out" 2>&1; then ok "$msg"; else
    bad "$msg"
    grep -v '^ *$' "$TMP/check.out" | tail -6 | cut -c1-200 | sed 's/^/      /'
  fi
}
healthy() {
  local _
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "$(podman container inspect "$1" --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && return 0
    sleep 3
  done
  return 1
}
native() { # <image>: pulled and the host's architecture, not emulated
  [ "$(podman image inspect "$1" --format '{{.Architecture}}' 2>/dev/null)" = "$(podman info --format '{{.Host.Arch}}')" ]
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

section_podman() {
  echo "podman"
  check "Podman machine answers" podman info
  check "network vult-internal exists" podman network exists vult-internal
  check "Vault Enterprise image is native arm64" native "$(vult_conf VAULT_ENT_IMAGE)"
  local skew=99 vm
  if vm=$(podman machine ssh date +%s 2>/dev/null | tr -d '\r' | tail -1) && [ -n "$vm" ]; then
    skew=$(($(date +%s) - vm))
    skew=${skew#-}
  fi
  check "VM clock within 5s of the Mac (${skew}s; fix: make clock-sync)" test "$skew" -le 5
}

section_vault() {
  echo "vault"
  check "listener certificate chains to the lab CA" openssl verify -CAfile vault-tls/ca-chain.pem vault-tls/vault.crt
  local node s
  for node in vault-s $VULT_CLUSTER_NODES; do
    check "$(vault_container "$node") healthy" healthy "$(vault_container "$node")"
    vault_node "$node"
    s=$(vault_json 2>/dev/null || echo '{}')
    check "$node initialized and unsealed" jq -e '.initialized and (.sealed | not)' <<<"$s"
    check "$node runs 2.2.1+ent" jq -e '.version == "2.2.1+ent"' <<<"$s"
  done
  vault_node vault-s
  check "vault-s is Shamir-sealed" jq -e '.type == "shamir"' <<<"$(vault_json 2>/dev/null || echo '{}')"
  for node in $VULT_CLUSTER_NODES; do
    vault_node "$node"
    check "$node is Transit-sealed" jq -e '.type == "transit"' <<<"$(vault_json 2>/dev/null || echo '{}')"
  done
  check "every node's own seal token is accepted by vault-s" ./scripts/seal-token-status.sh

  vault_cluster
  vault_token ansible-platform
  local peers leaders
  peers=$(vault operator raft list-peers -format=json 2>/dev/null || echo '{}')
  check "three Raft voters" jq -e '[.data.config.servers[] | select(.voter)] | length == 3' <<<"$peers"
  leaders=$(jq '[.data.config.servers[] | select(.leader)] | length' <<<"$peers" 2>/dev/null || echo 0)
  check "exactly one leader" test "$leaders" = 1
  check "licence autoloaded on the cluster" bash -c 'vault read -format=json sys/license/status | jq -e ".data.autoloaded.license_id != null"'
  unset VAULT_TOKEN

  check "no root token in the seal init file" jq -e 'has("root_token") | not' .secrets/vault/seal-init.json
  check "no root token in the cluster init file" jq -e 'has("root_token") | not' .secrets/vault/vault-init.json
  check "no regenerated root token lying around (make root-revoke)" bash -c '! compgen -G ".secrets/vault/root-*" >/dev/null'
  local t
  for t in tf-seal ansible-seal tf-platform ansible-platform; do
    check "scoped token $t is 0600" test "$(stat -f '%Lp' ".secrets/vault/tokens/$t")" = 600
  done
  check "Terraform state is 0600" bash -c '! find .secrets/terraform -name "*.tfstate*" ! -perm 600 | grep . >/dev/null'
}

ns=$(vult_conf VULT_NAMESPACE)

section_platform() {
  echo "platform"
  vault_cluster
  vault_token ansible-platform
  check "namespace $ns exists" bash -c "vault read -format=json sys/namespaces/$ns | jq -e '.data.path == \"$ns/\"'"
  check "kv/ (v2) in $ns" bash -c "vault read -format=json -namespace=$ns sys/mounts | jq -e '.data[\"kv/\"].options.version == \"2\"'"
  check "userpass/ in $ns" bash -c "vault read -format=json -namespace=$ns sys/auth | jq -e '.data | has(\"userpass/\")'"
  check "two audit devices, file/ and stdout/ (root namespace)" bash -c 'vault read -format=json sys/audit | jq -e ".data | has(\"file/\") and has(\"stdout/\")"'
  check "Secrets Sync and Secrets Import activated" bash -c 'vault read -format=json sys/activation-flags | jq -e ".data.activated | index(\"secrets-sync\") and index(\"secrets-import\")"'
  check "the licence has Secrets Sync, Secrets Import and Namespaces" bash -c 'vault read -format=json sys/license/status | jq -e "[\"Secrets Sync\", \"Secrets Import\", \"Namespaces\"] - .data.autoloaded.features == []"'
  check "the GitHub App is registered with the key in .secrets/github/ (fingerprint)" bash -c "test \"\$(vault read -format=json -namespace=$ns sys/sync/github-apps/$(vult_conf VULT_GITHUB_APP_NAME) | jq -r .data.fingerprint)\" = \"\$(openssl rsa -in \"\$(find .secrets/github -name '*.pem' | head -1)\" -pubout -outform DER 2>/dev/null | openssl dgst -sha256 -binary | base64)\""
  check "the AWS destination allows LocalStack's /32 and port 4566 only" bash -c "vault read -format=json -namespace=$ns sys/sync/destinations/aws-sm/tidewell-localstack | jq -e '.data.connection_details.allowed_ipv4_addresses == [\"$(vult_conf VULT_LOCALSTACK_IP)/32\"] and .data.connection_details.allowed_ports == [4566]'"
  check "phase validate passes (Saskia, her capabilities, the app, both destinations, the legacy store)" ./scripts/ansible.sh validate
  unset VAULT_TOKEN
}

section_stage() {
  echo "stage"
  check "the story validates (make story-check)" node scripts/story-check.js
  check "the stage file says: nothing imported, nothing synced" jq -e '.imported == [] and ([.associations[]] | all(. == 0))' .build/stage/stage.json
}

section_cloud() {
  echo "cloud"
  check "vult-localstack healthy" healthy vult-localstack
  check "LocalStack image is native arm64" native "$(vult_conf LOCALSTACK_IMAGE)"
  check "LocalStack at its fixed address $(vult_conf VULT_LOCALSTACK_IP)" bash -c "test \"\$(podman inspect vult-localstack --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')\" = $(vult_conf VULT_LOCALSTACK_IP)"
  check "LocalStack serves TLS that verifies against the lab CA" curl -sf --cacert vault-tls/ca-chain.pem "https://localhost:$(vult_conf VULT_PORT_LOCALSTACK)/_localstack/health"
  check "the Vault nodes send every AWS call to LocalStack, trusting the lab CA" bash -c "podman exec $(vault_container vault-1) sh -c 'test \"\$AWS_ENDPOINT_URL\" = https://localstack:4566 && test -z \"\${AWS_CA_BUNDLE:-}\"'"
  check "the auth token reached only LocalStack (not the Vault nodes)" bash -c "! podman exec $(vault_container vault-1) sh -c 'env | grep -q LOCALSTACK_AUTH_TOKEN'"
}

section_app() {
  echo "app"
  check "vult-api healthy" healthy vult-api
  check "API healthz answers (through the console)" bash -c "curl -sf --cacert vault-tls/ca-chain.pem https://localhost:$(vult_conf VULT_PORT_WEB)/api/healthz | jq -e .ok"
  check "the API is not published on its own (only through the console's TLS)" bash -c "test -z \"\$(podman port vult-api)\""
  check "API image is native arm64" native "$(vult_conf VULT_IMAGE_PREFIX)/api:$(vult_conf VULT_IMAGE_TAG)"
  check "the API image carries Vault 2.2.1+ent (for Secrets Import)" bash -c "podman exec vult-api vault version | grep -q 'v2.2.1+ent'"
  check "the API image carries no legacy value" bash -c "! podman exec vult-api grep -rqF -e $(jq -r '.legacy[0].value' config/story.json) /app"
  check "the API mounts only the lab CA and GitHub's evidence: no credential (Saskia types her password)" bash -c "test \"\$(podman inspect vult-api --format '{{range .Mounts}}{{.Destination}}{{println}}{{end}}' | grep . | sort | paste -sd' ' -)\" = '/etc/vult/ca-chain.pem /evidence/github'"
  check "the API's mounts are all read-only" bash -c "test \"\$(podman inspect vult-api --format '{{range .Mounts}}{{.RW}} {{end}}')\" = 'false false '"
  check "the API's root filesystem is read-only" bash -c "test \"\$(podman inspect vult-api --format '{{.HostConfig.ReadonlyRootfs}}')\" = true"
}

section_console() {
  echo "console"
  local web
  web="localhost:$(vult_conf VULT_PORT_WEB)"
  check "vult-web healthy" healthy vult-web
  check "web image is native arm64" native "$(vult_conf VULT_IMAGE_PREFIX)/web:$(vult_conf VULT_IMAGE_TAG)"
  check "TLS 1.3, chain verifies against the lab CA" bash -c "openssl s_client -connect $web -tls1_3 -servername localhost -CAfile vault-tls/ca-chain.pem </dev/null 2>/dev/null | grep -q 'Verify return code: 0'"
  check "TLS 1.2 refused" bash -c "! openssl s_client -connect $web -tls1_2 </dev/null >/dev/null 2>&1"
  check "Content-Security-Policy without unsafe-inline scripts" bash -c "curl -sI --cacert vault-tls/ca-chain.pem https://$web/ | grep -i '^content-security-policy' | grep -v unsafe-inline | grep -q \"script-src 'self'\""
  check "the console page is served (200)" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' --cacert vault-tls/ca-chain.pem 'https://$web/')\" = 200"
  check "only saskia may sign in to the console (403 for anyone else)" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' --cacert vault-tls/ca-chain.pem -H 'content-type: application/json' -d '{\"username\":\"mallory\",\"password\":\"x\"}' https://$web/api/session)\" = 403"
  check "no one-shot init container left behind" bash -c "! podman ps -a --filter name='^vult-.*_init\$' --format '{{.Names}}' | grep . >/dev/null"
}

section_units() {
  echo "units"
  check "the story validates (make story-check)" node scripts/story-check.js
  check "script unit tests (node --test scripts/)" bash -c "node --test scripts/*.test.js"
  check "API unit tests (node --test api/test/)" bash -c "cd api && NODE_ENV=test node --test 'test/*.test.js'"
  check "static checks (make lint)" ./scripts/lint.sh
}

section_idempotency() {
  echo "idempotency"
  check "every Ansible phase changed=0 (make idempotency)" ./scripts/idempotency.sh
}

section_secrets() {
  echo "secrets"
  check "no known secret in state, .build/ or logs (make secret-scan)" ./scripts/secret-scan.sh
}

section_rehearsal() {
  echo "rehearsal"
  check "the four acts through the console, every way they must fail (make rehearsal)" ./scripts/rehearsal.sh
}

section_boundary() {
  echo "boundary"
  check "each scoped token does its own job and nothing else (make boundary)" ./scripts/boundary-check.sh
}

section_drift() {
  echo "drift"
  check "Terraform: every root plans clean (make tf-plan-all)" make -s tf-plan-all
  check "Ansible: every phase changes nothing in check mode (make drift)" ./scripts/drift.sh
}

all="podman vault units platform stage cloud app console boundary drift idempotency secrets rehearsal"
sections=${*:-$all}
for s in $sections; do
  if declare -F "section_$s" >/dev/null; then
    "section_$s"
  else
    echo "$s"
    echo "  - not built yet"
  fi
done

echo
echo "verify: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
