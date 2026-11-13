#!/usr/bin/env bash
# scripts/clean-models.sh (make clean-models CONFIRM=yes): DESTRUCTIVE. Stops
# vult-ollama and removes the models volume vult-ollama_models, which make
# clean-slate keeps on purpose (D8). The next make ai-up and make lab pull the
# models again (several GB).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
[ "${CONFIRM:-}" = yes ] || die "clean-models: removes the Ollama models (several GB to pull again); run with CONFIRM=yes"
./scripts/compose.sh ai down >/dev/null 2>&1 || true
podman volume exists vult-ollama_models && podman volume rm vult-ollama_models >/dev/null
echo "clean-models: vult-ollama_models removed; make ai-up and the models phase pull them again"
