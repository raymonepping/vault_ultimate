#!/usr/bin/env bash
# scripts/workload-up.sh (make workload-up): Tidewell's booking app and the AI
# agent. Builds the two images if missing, copies the before estate's files
# onto their volumes (booking-init), starts both and waits until healthy. The
# one-shot booking-init is removed after a good start, kept on failure.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
prefix=$(vult_conf VULT_IMAGE_PREFIX)
tag=$(vult_conf VULT_IMAGE_TAG)
for t in booking tide-agent; do
  podman image exists "$prefix/$t:$tag" || ./scripts/app-build.sh "$t"
done
./scripts/network.sh
# Vault Agent (act 2 on) lives in the booking container's network namespace:
# when booking must be recreated, Agent goes first and gets a fresh secret id
# after (a used one never works again).
redeliver=0
if podman container exists vult-booking_agent && podman container exists vult-booking; then
  want=$(./scripts/compose.sh workload config --hash booking | awk '{print $2}')
  have=$(podman inspect vult-booking --format '{{index .Config.Labels "com.docker.compose.config-hash"}}')
  img_want=$(podman image inspect "$prefix/booking:$tag" --format '{{.Id}}')
  img_have=$(podman inspect vult-booking --format '{{.Image}}')
  if [ "$want" != "$have" ] || [ "$img_want" != "$img_have" ]; then
    ./scripts/compose.sh workload --profile act2 rm -sf booking-agent >/dev/null
    redeliver=1
  fi
fi
./scripts/compose.sh workload up -d >/dev/null
for c in vult-booking vult-tide_agent; do
  for _ in $(seq 1 60); do
    [ "$(podman inspect "$c" --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && break
    sleep 2
  done
  [ "$(podman inspect "$c" --format '{{.State.Health.Status}}')" = healthy ] || die "workload-up: $c is not healthy (podman logs $c)"
done
./scripts/compose.sh workload rm -f booking-init >/dev/null 2>&1 || true
act=$(cat "$BUILD_DIR/act" 2>/dev/null || echo 0)
if [ "$act" -ge 2 ] && { [ "$redeliver" = 1 ] || ! podman container exists vult-booking_agent; }; then
  ./scripts/ansible.sh agent || die "workload-up: Vault Agent did not come back (ansible/agent.yml)"
fi
echo "workload-up: booking https://localhost:$(vult_conf VULT_PORT_BOOKING) ($(curl -sS --cacert vault-tls/ca-chain.pem "https://localhost:$(vult_conf VULT_PORT_BOOKING)/healthz" | jq -c '{database, credential, tls}')), tide-agent internal"
