#!/usr/bin/env bash
# scripts/timeline.sh (make timeline): act 6's timeline, evidence panel and
# cited summary (api/lib/timeline.js) from the drill's records in
# .build/act6/raw.json into .build/act6/timeline.json. Runs in a throwaway
# container on vult-internal (Ollama is not published). Read-only: it reads
# records and asks Ollama; it changes nothing in the lab.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
[ -s "$BUILD_DIR/act6/raw.json" ] || die "timeline: no drill records yet (make act-6)"
podman run --rm --name vult-timeline --network vult-internal \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  -e OLLAMA_MODEL="$(vult_conf VULT_OLLAMA_MODEL)" -e OLLAMA_TIMEOUT_MS="$(vult_conf VULT_OLLAMA_SUMMARY_TIMEOUT_MS)" \
  -v "$VULT_ROOT/api:/app:ro" -v "$BUILD_DIR/act6:/out" \
  -w /app "$(vult_conf NODE_IMAGE)" node bin/timeline.js
