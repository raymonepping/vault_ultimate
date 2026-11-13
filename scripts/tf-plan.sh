#!/usr/bin/env bash
# scripts/tf-plan.sh [current|0..6] (make tf-plan ACT=...): Terraform's plan
# for an act, read-only. ACT=current must be empty (the drift gate); ACT=6
# shows what is left, saved to .build/terraform/whats-left.txt for the
# console (resource addresses and actions only; Terraform holds no value).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
act=${1:-current}
rc=0
out=$(ACT=$act ./scripts/tf.sh vault-platform plan -no-color -lock=false 2>&1) || rc=$?
# 0: no changes; 2: changes (tf.sh plans with -detailed-exitcode).
[ "$rc" = 0 ] || [ "$rc" = 2 ] || { printf '%s\n' "$out" >&2; die "tf-plan: plan failed"; }
summary=$(grep -E '^(Plan:|No changes)' <<<"$out" | head -1)
if [ "$act" = 6 ]; then
  mkdir -p "$BUILD_DIR/terraform"
  { echo "# What is left after act $(cat "$BUILD_DIR/act" 2>/dev/null || echo 0) (make tf-plan ACT=6, $(date -u +%Y-%m-%dT%H:%M:%SZ))"; grep -E '^\s+# .* will be|^Plan:|^No changes' <<<"$out"; } >"$BUILD_DIR/terraform/whats-left.txt"
fi
grep -E '^\s+# .* will be' <<<"$out" || true
echo "tf-plan ACT=$act: $summary"
