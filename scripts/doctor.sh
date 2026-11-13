#!/usr/bin/env bash
# scripts/doctor.sh (make doctor): what is wrong, and which command fixes it.
# Read-only: it never changes anything, it only tells you what to run.
set -uo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
set +e
cd "$VULT_ROOT" || exit 1

problems=0
fine() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fix() { # <problem> <command>
  printf '  \033[31m✗\033[0m %s\n      fix: %s\n' "$1" "$2"
  problems=$((problems + 1))
}
running() { [ "$(vult_container_state "$1")" = running ]; }
api() { # <token file> <path>: GET on the cluster, JSON or nothing
  vcurl "$(cat "$1" 2>/dev/null)" -sf --cacert "$VAULT_CACERT" "$VAULT_ADDR/v1/$2" 2>/dev/null
}
days_left() { echo $((($(date -j -u -f '%Y-%m-%dT%H:%M:%S' "${1%%.*}" +%s 2>/dev/null || echo 0) - $(date +%s)) / 86400)); }

echo "machine"
if podman info >/dev/null 2>&1; then fine "Podman answers"; else fix "Podman does not answer" "podman machine start (ask first: it affects every lab)"; fi
vm=$(podman machine ssh date +%s 2>/dev/null | tr -d '\r' | tail -1)
if [ -n "$vm" ]; then
  skew=$(($(date +%s) - vm))
  skew=${skew#-}
  if [ "$skew" -le 5 ]; then fine "VM clock within ${skew}s"; else fix "VM clock is ${skew}s off the Mac: JWTs (5 min), leases and tokens expire early or late" "make clock-sync"; fi
fi
# Free space, not percent used (the user's call: 29 GiB free on a 460 GiB
# disk is plenty). On macOS / is the sealed system volume; $HOME's is the data.
avail=$(df -g "$HOME" | awk 'NR==2 {print $4}')
[ "${avail:-0}" -ge 10 ] && fine "Mac disk: ${avail} GiB free" || fix "Mac disk: ${avail:-?} GiB free (under 10 GiB; a full disk corrupts writes in the VM)" "free space on the Mac (ask before any podman prune)"
vmfree=$(podman machine ssh df -BG /var 2>/dev/null | awk 'NR==2 {gsub("G", "", $4); print $4}')
[ "${vmfree:-0}" -ge 5 ] && fine "Podman VM disk: ${vmfree} GiB free on /var" || fix "Podman VM disk: ${vmfree:-?} GiB free on /var" "make disk-check (reclaiming is the operator's call)"
[ -s "$VULT_STATE/vault.hclic" ] && fine "the Vault licence is installed (.secrets/vault/vault.hclic)" || fix "no Vault licence installed" "VAULT_LICENSE in .env, then make license"
for img in "$(vult_conf VAULT_ENT_IMAGE)" "$(vult_conf LOCALSTACK_IMAGE)" "$(vult_conf NODE_IMAGE)" "$(vult_conf NGINX_IMAGE)" "$(vult_conf ALPINE_IMAGE)" "$(vult_conf KEYCLOAK_IMAGE)" "$(vult_conf OPENLDAP_IMAGE)" "$(vult_conf POSTGRES_IMAGE)" "$(vult_conf OLLAMA_IMAGE)"; do
  podman image exists "$img" || fix "image $img is missing" "make lab (compose pulls what is missing)"
done
for t in api web booking tide-agent; do
  podman image exists "$(vult_conf VULT_IMAGE_PREFIX)/$t:$(vult_conf VULT_IMAGE_TAG)" || fix "image $t is not built" "make app-build"
done
busy=$("$VULT_ROOT/scripts/ports-check.sh" 2>/dev/null | grep -vE ' free$|\(this stack\)' | awk '{print $1}' | paste -sd' ' - || true)
[ -z "$busy" ] && fine "every port is free or held by this lab" || fix "a port this lab needs is held by something else: $busy" "make ports-check, then override it in .env"

echo "vault"
[ -s .secrets/vault/vault.hclic ] || fix "no Vault Enterprise licence" "make license"
if ! running "$(vault_container vault-s)"; then
  fix "vault-s is not running: nothing can unseal or restart" "make up"
else
  vault_node vault-s
  if vault_json 2>/dev/null | jq -e '.sealed' >/dev/null; then fix "vault-s is sealed: cluster nodes cannot restart" "make unseal"; else fine "vault-s unsealed"; fi
fi
up=0
for n in $VULT_CLUSTER_NODES; do
  if ! running "$(vault_container "$n")"; then
    fix "$n is not running" "make up"
    continue
  fi
  vault_node "$n"
  if vault_json 2>/dev/null | jq -e '.sealed | not' >/dev/null; then up=$((up + 1)); else fix "$n is sealed (its seal token, or vault-s?)" "make seal-token-status; podman logs $(vault_container "$n") | grep 403"; fi
done
[ "$up" = 3 ] && fine "three cluster nodes unsealed"
if running "$(vault_container vault-s)"; then
  vault_node vault-s
  bad=$("$VULT_ROOT/scripts/seal-token-status.sh" 2>/dev/null | awk 'NR>1 && ($3+0 < 604800 || $5 != "accepted") {print $1}' | paste -sd' ' -)
  [ -z "$bad" ] && fine "every node's seal token accepted, more than 7 days left" || fix "seal token(s) rejected or expiring within 7 days: $bad" "make seal-token-rotate NODE=<node>"
fi
for t in tf-seal ansible-seal tf-platform ansible-platform; do
  [ -s ".secrets/vault/tokens/$t" ] || fix "scoped token $t is missing" "make lab"
done
if jq -e 'has("root_token")' .secrets/vault/seal-init.json .secrets/vault/vault-init.json 2>/dev/null | grep -F true >/dev/null; then
  fix "an init file still holds a root token (bootstrap did not finish)" "make lab"
fi
compgen -G ".secrets/vault/root-*" >/dev/null && fix "a regenerated root token is lying around" "make root-revoke CLUSTER=seal|vault"
if [ "$up" -gt 0 ]; then
  vault_cluster
  for t in tf-platform ansible-platform; do
    ttl=$(api ".secrets/vault/tokens/$t" auth/token/lookup-self | jq -r '.data.ttl // empty')
    if [ -z "$ttl" ]; then fix "the $t token is rejected (unused for 32 days?)" "make root-regen CLUSTER=vault, VULT_ROOT_FILE=.secrets/vault/root-vault scripts/ansible.sh bootstrap, make root-revoke CLUSTER=vault"
    elif [ "$ttl" -lt 604800 ]; then fix "the $t token expires in $((ttl / 3600))h (it renews on use)" "make lab (every run renews it)"
    else fine "$t valid"; fi
  done
  lic=$(api .secrets/vault/tokens/ansible-platform sys/license/status | jq -r '.data.autoloaded.expiration_time // empty')
  if [ -n "$lic" ]; then
    d=$(days_left "$lic")
    [ "$d" -gt 30 ] && fine "licence valid for $d days" || fix "the licence expires in $d days" "renew VAULT_LICENSE in .env, then make license"
  fi
  voters=$(api .secrets/vault/tokens/ansible-platform sys/storage/raft/configuration | jq '[.data.config.servers[] | select(.voter)] | length')
  [ "${voters:-0}" = 3 ] && fine "three Raft voters" || fix "${voters:-0} Raft voters" "make vault-status; make up"
  ns=$(vult_conf VULT_NAMESPACE)
  # Act 1 activates Sync and Import and registers the app and both
  # destinations; before it, their absence is the before estate, not a fault.
  if [ "$(cat "$BUILD_DIR/act" 2>/dev/null || echo 0)" -ge 1 ]; then
    flags=$(api .secrets/vault/tokens/ansible-platform sys/activation-flags | jq -r '.data.activated // [] | join(" ")')
    for f in secrets-sync secrets-import; do
      [[ " $flags " == *" $f "* ]] && fine "$f activated" || fix "$f is not activated (every sys/sync call is 403)" "make stage-reset CONFIRM=yes, then make act-1"
    done
    fp=$(api .secrets/vault/tokens/ansible-platform "$ns/sys/sync/github-apps/$(vult_conf VULT_GITHUB_APP_NAME)" | jq -r '.data.fingerprint // empty')
    [ -n "$fp" ] && fine "the GitHub App is registered in $ns" || fix "the GitHub App is not registered" "make stage-reset CONFIRM=yes, then make act-1"
    for d in gh/tidewell-github aws-sm/tidewell-localstack; do
      api .secrets/vault/tokens/ansible-platform "$ns/sys/sync/destinations/$d" >/dev/null && fine "destination $d" || fix "destination $d is missing" "make stage-reset CONFIRM=yes, then make act-1"
    done
  else
    fine "act 0: Sync, the GitHub App and the destinations come with act 1"
  fi
fi

echo "cloud"
[ -n "$(vult_conf LOCALSTACK_AUTH_TOKEN)" ] || fix "LOCALSTACK_AUTH_TOKEN is empty in .env (LocalStack refuses to start)" "put your localstack.cloud auth token in .env"
if running vult-localstack; then
  [ "$(podman inspect -f "{{.State.Health.Status}}" vult-localstack 2>/dev/null)" = healthy ] && fine "LocalStack healthy" || fix "LocalStack is not healthy" "podman logs vult-localstack"
  n=$(curl -s --cacert vault-tls/ca-chain.pem -X POST "https://localhost:$(vult_conf VULT_PORT_LOCALSTACK)/" \
    -H 'X-Amz-Target: secretsmanager.ListSecrets' -H 'Content-Type: application/x-amz-json-1.1' \
    -H "Authorization: AWS4-HMAC-SHA256 Credential=test/20260101/$(vult_conf VULT_AWS_REGION)/secretsmanager/aws4_request, SignedHeaders=host, Signature=0" \
    --data '{"MaxResults":100}' | jq --argjson want "$(jq '[.legacy[].aws_name]' config/story.json)" '[.SecretList[]?.Name] as $have | [$want[] | select(. as $n | $have | index($n))] | length')
  # Act 1 brings the legacy secrets home and retires the originals on purpose.
  want=$([ "$(cat "$BUILD_DIR/act" 2>/dev/null || echo 0)" = 0 ] && jq '.legacy | length' config/story.json || echo 0)
  [ "${n:-0}" = "$want" ] && fine "the legacy store holds $n secrets (act $(cat "$BUILD_DIR/act" 2>/dev/null || echo 0) expects $want)" || fix "the legacy store holds ${n:-0} secrets, act $(cat "$BUILD_DIR/act" 2>/dev/null || echo 0) expects $want" "make up (LocalStack keeps nothing across a restart)"
else
  fix "vult-localstack is not running" "make up"
fi

echo "credentials"
for who in saskia teun; do [ -s ".secrets/people/$who" ] || fix "no password for $who" "make identity-up"; done
if out=$("$VULT_ROOT/scripts/github-installation.sh" 2>&1); then fine "the GitHub App is installed on $(vult_conf VULT_GITHUB_OWNER)/$(vult_conf VULT_GITHUB_REPO)"; else fix "the GitHub App installation: $(tail -1 <<<"$out")" "install VaultSyncDemo on the repository (GitHub settings; the lab never changes an app)"; fi
compgen -G ".secrets/github/*.pem" >/dev/null && fine "the GitHub App key is in .secrets/github/" ||
  fix "no GitHub App key (a rebuild cannot register the app)" "generate a private key for VaultSyncDemo in GitHub, put it in .secrets/github/"
gh auth status >/dev/null 2>&1 && fine "gh CLI signed in (make github-evidence)" || fix "the gh CLI is not signed in" "gh auth login"

echo "stacks"
for c in vult-openldap vult-keycloak vult-postgres vult-ollama vult-booking vult-tide_agent; do
  if running "$c"; then
    [ "$(podman inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" = healthy ] && fine "$c healthy" || fix "$c is not healthy" "podman logs $c, then make wake-up"
  else fix "$c is not running" "make up"; fi
done
if [ "$(cat "$BUILD_DIR/act" 2>/dev/null || echo 0)" -ge 2 ]; then
  running vult-booking_agent && [ "$(podman inspect -f '{{.State.Health.Status}}' vult-booking_agent 2>/dev/null)" = healthy ] && fine "Vault Agent healthy (act 2 on)" || fix "the booking app's Vault Agent is not healthy" "make wake-up (a fresh secret id: make agent)"
fi
running vult-ollama && { podman exec vult-ollama ollama list 2>/dev/null | grep -q "^$(vult_conf VULT_OLLAMA_MODEL)" && fine "Ollama has $(vult_conf VULT_OLLAMA_MODEL)" || fix "Ollama lacks $(vult_conf VULT_OLLAMA_MODEL)" "make models"; }

echo "app"
for c in vult-api vult-web; do running "$c" || fix "$c is not running" "make up"; done
curl -sf "http://127.0.0.1:$(vult_conf VULT_RUNNER_PORT)/healthz" >/dev/null && fine "the host runner answers" || fix "the host runner is not running (the console cannot run an act)" "make app-up"
if running vult-api; then
  curl -sf --cacert vault-tls/ca-chain.pem "https://localhost:$(vult_conf VULT_PORT_WEB)/api/healthz" >/dev/null && fine "the API answers" || fix "the API does not answer" "make app-logs"
fi
podman ps -a --filter name='^vult-' --format '{{.Names}}' | grep -E '_(init|bootstrap)$' >/dev/null && fix "a one-shot init or bootstrap container was left behind" "make up"

echo "drift"
if [ "$up" -gt 0 ]; then
  make -s tf-plan-all >/dev/null 2>&1 && fine "Terraform: every plan empty" || fix "Terraform drift" "make tf-plan-all, then make lab"
  out=$(TF_ONLY=0 "$VULT_ROOT/scripts/drift.sh" 2>&1 | grep -E 'ansible +(DRIFT|ERROR)' || true)
  [ -z "$out" ] && fine "Ansible: check mode changes nothing" || fix "Ansible drift: $out" "make lab"
fi

echo
if [ "$problems" -eq 0 ]; then echo "doctor: nothing wrong"; else echo "doctor: $problems problem(s)"; fi
[ "$problems" -eq 0 ]
