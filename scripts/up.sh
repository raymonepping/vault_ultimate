#!/usr/bin/env bash
# scripts/up.sh (make up): the daily start, and the Lab Index's Start button
# (it runs `make up RUNTIME=podman` with stdin closed). Idempotent; it never
# asks a question and never touches a volume.
#   - no licence installed: install it from .env, or stop with the instruction;
#   - never built (no cluster init file): make lab, the whole build;
#   - otherwise, from the bottom: clock, vault-s and vault-1..3 (Transit
#     auto-unseal, a leader), identity, data, ai, cloud (a LocalStack that
#     started empty gets its act's content back), the workload (a fresh
#     secret id for Vault Agent when it must log in again), the console.
# Each step says what it found and what it did ("kept" when nothing changed).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
t0=$(date +%s)
ts=$(date +%s)
step() { # each line says how long its step took
  printf '\033[1m%-10s\033[0m %s (%ss)\n' "$1" "$2" "$(($(date +%s) - ts))"
  ts=$(date +%s)
}
was() { vult_container_state "$1"; }
run() { # <name> <log> <command...>: quiet on success, the log's tail on failure
  local name=$1 log="$BUILD_DIR/up-$2.log"
  shift 2
  "$@" >"$log" 2>&1 || {
    tail -20 "$log" >&2
    die "up: $name failed ($log)"
  }
}

if [ ! -s "$VULT_STATE/vault.hclic" ]; then
  ./scripts/license.sh </dev/null || die "up: no Vault Enterprise licence. Put VAULT_LICENSE in .env (see .env.example), then make up again."
fi
[ -s vault-tls/vault.crt ] || ./scripts/gen-certs.sh
if [ ! -s "$VULT_STATE/vault-init.json" ]; then
  step build "this lab has never been built: make lab (about five minutes)"
  ./scripts/lab.sh
  step built "from nothing; make show-ready before a talk"
  exit 0
fi
act=$(cat "$BUILD_DIR/act" 2>/dev/null || echo 0)

step clock "$(./scripts/clock-sync.sh 2>&1 | tail -1 | sed 's/^clock-sync: //')"
before=$(was "$(vault_container vault-s)")
run "the Vault stacks" vault ./scripts/vault-up.sh
step vault "$([ "$before" = running ] && echo 'kept: ')$(tail -1 "$BUILD_DIR/up-vault.log" | sed 's/^vault-up: //')"

# identity, data, ai and cloud need Vault, not each other: in parallel
# (indexed arrays: macOS's bash 3.2 has no associative ones).
./scripts/network.sh # once: four parallel "create if missing" would race
stacks=(identity data ai cloud)
ctrs=(vult-keycloak vult-postgres vult-ollama vult-localstack)
pids=()
befores=()
for i in 0 1 2 3; do
  befores[i]=$(was "${ctrs[i]}")
  "./scripts/${stacks[i]}-up.sh" >"$BUILD_DIR/up-${stacks[i]}.log" 2>&1 &
  pids[i]=$!
done
for i in 0 1 2 3; do
  wait "${pids[i]}" || {
    tail -20 "$BUILD_DIR/up-${stacks[i]}.log" >&2
    die "up: the ${stacks[i]} stack failed ($BUILD_DIR/up-${stacks[i]}.log)"
  }
done
for i in 0 1 2; do
  printf '\033[1m%-10s\033[0m %s\n' "${stacks[i]}" "$([ "${befores[i]}" = running ] && echo "kept: ${ctrs[i]} running" || echo "${ctrs[i]} started (${befores[i]} before)")"
done
step stacks "identity, data, ai and cloud up, in parallel"
before=${befores[3]}
if [ "$before" = running ]; then
  step cloud "kept: localstack running"
elif [ "$act" = 0 ]; then
  # A fresh LocalStack is empty (the free licence keeps nothing): act 0's
  # legacy store and hand-made copy again.
  run "the before estate in LocalStack" before-estate ./scripts/ansible.sh before-estate
  step cloud "localstack started ($before before): the legacy store and the hand-made copy again"
else
  run "the LocalStack reconcile" reconcile ./scripts/ansible.sh reconcile-localstack
  step cloud "localstack started ($before before): Sync wrote the deploy token's copy back"
fi

before=$(was vult-booking)
agent_before=$(was vult-booking_agent)
run "the workload" workload ./scripts/workload-up.sh
if [ "$act" -ge 2 ] && { [ "$agent_before" != running ] || [ "$(podman inspect vult-booking_agent --format '{{.State.Health.Status}}' 2>/dev/null)" != healthy ]; }; then
  # A stopped Agent lost its tmpfs token and its secret id is spent (D9, D16).
  podman container exists vult-booking_agent && [ "$(podman inspect vult-booking_agent --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] ||
    run "Vault Agent's fresh login" agent ./scripts/ansible.sh agent
  step workload "booking ($before before) and Vault Agent: a fresh single-use secret id, logged in again"
else
  step workload "$([ "$before" = running ] && echo 'kept: booking and tide-agent running' || echo "booking and tide-agent started ($before before)")"
fi

before=$(was vult-api)
run "the console" app ./scripts/app-up.sh
step app "$([ "$before" = running ] && echo 'kept: ' )api and web; one-shot web-init removed"
echo "up: act $act, done in $(($(date +%s) - t0))s. make verify to check, make doctor if something looks wrong, make show-ready before a talk."
