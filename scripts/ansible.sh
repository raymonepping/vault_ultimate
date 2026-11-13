#!/usr/bin/env bash
# scripts/ansible.sh <playbook> [--check] [ansible-playbook args...]
# scripts/ansible.sh --version-check
#
# The only supported way to run Ansible here. Runs from the repo root with
# ansible.cfg. Ansible refuses non-blocking stdio (agent shells, some CI), so
# stdin comes from /dev/null and output goes through cat. Passes token file
# PATHS (vult_tokens_dir), never a token, plus the non-secret lab settings in
# .build/ansible-vars.json. The vult_stats callback writes the play recap
# counts to .build/ansible-stats/<playbook>[.check].json.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
export ANSIBLE_CONFIG="$VULT_ROOT/ansible.cfg"

if [ "${1:-}" = --version-check ]; then
  v=$(ansible-playbook --version </dev/null 2>&1 | cat | head -1)
  echo "$v"
  [[ "$v" == *"core 2.2"[1-9]* ]] || die "ansible-core 2.21 or later is required"
  exit 0
fi

playbook=${1:?Usage: ansible.sh <playbook> [--check] [args]}
shift
playbook=${playbook%.yml}
[ -f "ansible/$playbook.yml" ] || die "ansible: unknown playbook ansible/$playbook.yml"

mkdir -p "$BUILD_DIR/ansible-stats"
jq -n \
  --arg root "$VULT_ROOT" \
  --arg tokens "$VULT_STATE/tokens" \
  --arg state "$VULT_STATE" \
  --arg ca "$VAULT_CACERT" \
  --arg seal "https://127.0.0.1:$(vult_conf VULT_PORT_VAULT_S)" \
  --argjson nodes "$(for n in vault-1 vault-2 vault-3; do jq -n --arg n "$n" --arg a "https://127.0.0.1:$(vault_port_of "$n")" '{($n): $a}'; done | jq -s add)" \
  --arg web "https://localhost:$(vult_conf VULT_PORT_WEB)" \
  --arg namespace "$(vult_conf VULT_NAMESPACE)" \
  --argjson session_idle "$(vult_conf VULT_SESSION_IDLE)" \
  --arg gh_owner "$(vult_conf VULT_GITHUB_OWNER)" --arg gh_repo "$(vult_conf VULT_GITHUB_REPO)" \
  --arg gh_app_id "$(vult_conf VULT_GITHUB_APP_ID)" --arg gh_app "$(vult_conf VULT_GITHUB_APP_NAME)" \
  --arg gh_install "$(vult_conf VULT_GITHUB_INSTALLATION_ID)" \
  --arg ls_url "https://localhost:$(vult_conf VULT_PORT_LOCALSTACK)" --arg ls_ip "$(vult_conf VULT_LOCALSTACK_IP)" \
  --arg region "$(vult_conf VULT_AWS_REGION)" \
  --arg ol_model "$(vult_conf VULT_OLLAMA_MODEL)" --arg ol_cand "$(vult_conf VULT_OLLAMA_CANDIDATES)" \
  --arg kc "https://localhost:$(vult_conf VULT_PORT_KEYCLOAK)" --arg booking "https://localhost:$(vult_conf VULT_PORT_BOOKING)" \
  --arg pg_ip "$(vult_conf VULT_POSTGRES_IP)" --arg booking_ip "$(vult_conf VULT_BOOKING_IP)" \
  --arg lease_ttl "$(vult_conf VULT_LEASE_TTL)" --arg cert_ttl "$(vult_conf VULT_CERT_TTL)" --arg wrap_ttl "$(vult_conf VULT_WRAP_TTL)" \
  '{vult_root: $root, vult_tokens_dir: $tokens, vult_state_dir: $state, vult_ca: $ca,
    vult_seal_addr: $seal, vult_node_addrs: $nodes, vult_cluster_addr: $nodes["vault-1"],
    vult_web_url: $web, vult_namespace: $namespace,
    vult_session_idle: $session_idle,
    vult_github: {owner: $gh_owner, repo: $gh_repo, app_id: $gh_app_id, app: $gh_app, installation_id: $gh_install},
    vult_localstack: {url: $ls_url, ip: $ls_ip, region: $region},
    vult_ollama: {model: $ol_model, candidates: ($ol_cand | split(" ") | map(select(length > 0)))},
    vult_keycloak_url: $kc, vult_booking_url: $booking,
    vult_ips: {postgres: $pg_ip, booking: $booking_ip},
    vult_ttl: {lease: $lease_ttl, cert: $cert_ttl, wrap: $wrap_ttl}}' >"$BUILD_DIR/ansible-vars.json"

# A user-run make root-regen leaves a root token file; bootstrap phases may
# use it (never revoke it: make root-revoke does) to re-apply a policy change.
if [ -n "${VULT_ROOT_FILE:-}" ]; then
  [ -s "$VULT_ROOT_FILE" ] || die "VULT_ROOT_FILE=$VULT_ROOT_FILE is not a file"
  jq --arg f "$(cd "$(dirname "$VULT_ROOT_FILE")" && pwd)/$(basename "$VULT_ROOT_FILE")" '. + {vult_root_file: $f}' \
    "$BUILD_DIR/ansible-vars.json" >"$BUILD_DIR/ansible-vars.json.tmp" && mv "$BUILD_DIR/ansible-vars.json.tmp" "$BUILD_DIR/ansible-vars.json"
fi

export VULT_PHASE="$playbook" VULT_STATS_DIR="$BUILD_DIR/ansible-stats"
set -o pipefail
ansible-playbook "ansible/$playbook.yml" -e "@$BUILD_DIR/ansible-vars.json" "$@" </dev/null 2>&1 | cat
