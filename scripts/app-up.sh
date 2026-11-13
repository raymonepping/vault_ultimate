#!/usr/bin/env bash
# scripts/app-up.sh (make app-up): the console. Build images if missing, start
# the host runner (runner/server.js: the waves run on the host), the app
# stack, and wait until the API answers.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"

prefix=$(vult_conf VULT_IMAGE_PREFIX)
tag=$(vult_conf VULT_IMAGE_TAG)
for t in api web; do
  [ -f "$VULT_ROOT/$t/Containerfile" ] || continue
  if ! podman image exists "$prefix/$t:$tag"; then
    echo "app-up: $prefix/$t:$tag not found, building"
    "$VULT_ROOT/scripts/app-build.sh" "$t"
  fi
done
mkdir -p "$BUILD_DIR/github" # make github-evidence fills it
"$VULT_ROOT/scripts/runner.sh" start
"$VULT_ROOT/scripts/compose.sh" app up -d
for _ in $(seq 1 40); do
  curl -sf --cacert "$VULT_ROOT/vault-tls/ca-chain.pem" "https://localhost:$(vult_conf VULT_PORT_WEB)/api/healthz" >/dev/null 2>&1 && break
  sleep 3
done
curl -sf --cacert "$VULT_ROOT/vault-tls/ca-chain.pem" "https://localhost:$(vult_conf VULT_PORT_WEB)/api/healthz" >/dev/null || die "app-up: the API is not healthy behind the console (make app-logs)"
# Only reached after a successful start: one-shot init containers go (compose
# recreates them on the next up). A failed start keeps them and their logs.
"$VULT_ROOT/scripts/compose.sh" app rm -f web-init >/dev/null 2>&1 || true
echo "app-up: stack started, the API answers; one-shot web-init removed"
echo "  Console: https://localhost:$(vult_conf VULT_PORT_WEB)/   (lab CA; make trust-root to trust it)"
echo "  API:     https://localhost:$(vult_conf VULT_PORT_WEB)/api/healthz (behind the console; not published on its own)"
