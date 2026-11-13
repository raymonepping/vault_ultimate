#!/usr/bin/env bash
# scripts/cloud-up.sh (make cloud-up): LocalStack on vult-internal, then
# wait until its Secrets Manager answers. The auth token is checked for
# presence only (never printed); compose hands it to the container. The
# one-shot cert-init is removed after a good start (kept on failure).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
[ -n "$(vult_conf LOCALSTACK_AUTH_TOKEN | tr -d '[:space:]')" ] ||
  die "cloud-up: put LOCALSTACK_AUTH_TOKEN in .env (a free LocalStack account; lstk login shows it)"
./scripts/network.sh
./scripts/compose.sh cloud up -d >/dev/null
for _ in $(seq 1 60); do
  [ "$(podman inspect vult-localstack --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && break
  sleep 3
done
[ "$(podman inspect vult-localstack --format '{{.State.Health.Status}}')" = healthy ] ||
  die "cloud-up: vult-localstack is not healthy (podman logs vult-localstack)"
./scripts/compose.sh cloud rm -f cert-init >/dev/null 2>&1 || true
echo "cloud-up: LocalStack healthy at https://localstack:4566 inside, https://localhost:$(vult_conf VULT_PORT_LOCALSTACK) on the host"
