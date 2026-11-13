#!/usr/bin/env bash
# scripts/ai-up.sh (make ai-up): Ollama (D8). Creates the external models
# volume once, checks the disk gate before a first pull of the image, starts
# the container and checks that the image is arm64 (an amd64 tag would run
# under emulation and starve the VM).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
image=$(vult_conf OLLAMA_IMAGE)
podman volume exists vult-ollama_models ||
  podman volume create --label io.vult.models=true vult-ollama_models >/dev/null
if ! podman image exists "$image"; then
  ./scripts/disk-check.sh --before-pull
  podman pull --platform linux/arm64 "$image" >/dev/null
fi
arch=$(podman image inspect "$image" --format '{{.Architecture}}')
[ "$arch" = arm64 ] || die "ai-up: $image is $arch, not arm64 (re-pull with --platform linux/arm64)"
./scripts/network.sh
./scripts/compose.sh ai up -d >/dev/null
for _ in $(seq 1 60); do
  [ "$(podman inspect vult-ollama --format '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && break
  sleep 2
done
[ "$(podman inspect vult-ollama --format '{{.State.Health.Status}}')" = healthy ] ||
  die "ai-up: vult-ollama is not healthy (podman logs vult-ollama)"
echo "ai-up: Ollama $(podman exec vult-ollama ollama --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1) healthy, internal only (http://ollama:11434), $(vult_conf VULT_OLLAMA_CPUS) CPUs, $(vult_conf VULT_OLLAMA_MEMORY)"
