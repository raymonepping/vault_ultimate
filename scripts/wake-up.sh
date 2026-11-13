#!/usr/bin/env bash
# scripts/wake-up.sh (make wake-up, D16): after the Mac slept. Observe, let
# scripts/wake-decide.js decide (unit-tested), repair, then one screen of
# what it found and what it fixed. A fast no-op when nothing was wrong.
#
#   clock      the VM clock against the Mac's (skew before and after)
#   Vault      wait on state: vault-s and vault-1..3 unsealed, a leader
#   containers an exited or unhealthy vult- service restarted through its
#              stack (compose.sh <stack> up -d <service>), never a one-shot
#   Agent      from act 2: gone, unhealthy, or the app off its lease means a
#              fresh wrapped secret id (make agent); a used one never works
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
t0=$(date +%s)
skew() { echo $(($(date +%s) - $(podman machine ssh date +%s 2>/dev/null | tr -d '\r' | tail -1))); }
fixed=()
failed=0

before=$(skew 2>/dev/null || echo 0)
act=$(cat "$BUILD_DIR/act" 2>/dev/null || echo 0)
containers=$(podman ps -a --filter name='^vult-' --format json | jq -c '[.[] | {name: .Names[0], state: .State,
  health: (if (.Status | test("\\(unhealthy\\)")) then "unhealthy" elif (.Status | test("\\(healthy\\)")) then "healthy" else null end),
  stack: ((.Labels["com.docker.compose.project"] // "") | sub("^vult-"; "") | select(. != "")),
  service: .Labels["com.docker.compose.service"]}]')
agent=$(echo "$containers" | jq -c '[.[] | select(.name == "vult-booking_agent")][0] // null')
booking=$(curl -s --max-time 4 --cacert vault-tls/ca-chain.pem "https://localhost:$(vult_conf VULT_PORT_BOOKING)/healthz" | jq -c '{database, credential}' 2>/dev/null || echo null)
observed=$(jq -n --argjson skew "$before" --argjson act "$act" --argjson c "$containers" --argjson a "$agent" --argjson b "${booking:-null}" \
  '{skew: $skew, act: $act, containers: $c, agent: $a, booking: $b}')
actions=$(node scripts/wake-decide.js "$observed")

if jq -e 'any(.[]; .do == "clock-sync")' <<<"$actions" >/dev/null; then
  ./scripts/clock-sync.sh >/dev/null || true
  fixed+=("clock: ${before}s off, now $(skew)s")
fi
while IFS=$'\t' read -r stack service why; do
  [ -n "$stack" ] || continue
    if ./scripts/compose.sh "$stack" up -d "$service" >/dev/null 2>&1; then fixed+=("restarted $service ($why)")
  else
    fixed+=("could not restart $service ($why): podman logs vult-${service//-/_}")
    failed=1
  fi
done < <(jq -r '.[] | select(.do == "restart") | [.stack, .service, .why] | @tsv' <<<"$actions")

# Vault: wait on state, never on a fixed sleep (a restarted node unseals
# through Transit; the cluster elects a leader).
vault_ready() { # every node unsealed (sys/health: 200 active, 429/473 standby), and a leader
  local p code
  for p in 19700 19701 19702 19703; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 --cacert vault-tls/ca-chain.pem "https://127.0.0.1:$p/v1/sys/health?standbyok=true&perfstandbyok=true")
    [ "$code" = 200 ] || [ "$code" = 429 ] || [ "$code" = 473 ] || return 1
  done
  curl -s --max-time 3 --cacert vault-tls/ca-chain.pem https://127.0.0.1:19701/v1/sys/leader | jq -e '.leader_address != ""' >/dev/null
}
vault_ok=no
for _ in $(seq 1 30); do
  if vault_ready; then vault_ok=yes; break; fi
  sleep 2
done

if jq -e 'any(.[]; .do == "agent")' <<<"$actions" >/dev/null; then
  why=$(jq -r '[.[] | select(.do == "agent")][0].why' <<<"$actions")
  if ./scripts/ansible.sh agent >"$BUILD_DIR/wake-up-agent.log" 2>&1; then fixed+=("Vault Agent logged in again with a fresh secret id ($why)")
  else
    fixed+=("Vault Agent did not come back ($why): $BUILD_DIR/wake-up-agent.log")
    failed=1
  fi
fi

after=$(skew 2>/dev/null || echo "?")
echo "wake-up: act $act, clock ${before}s then ${after}s, Vault $( [ "$vault_ok" = yes ] && echo 'unsealed with a leader' || echo 'NOT ready (make vault-status)')"
if [ "${#fixed[@]}" -eq 0 ]; then
  echo "wake-up: nothing was wrong; nothing changed ($(($(date +%s) - t0))s)"
else
  printf 'wake-up: %s\n' "${fixed[@]}"
  echo "wake-up: ${#fixed[@]} repair(s) in $(($(date +%s) - t0))s"
fi
[ "$vault_ok" = yes ] && [ "$failed" = 0 ]
