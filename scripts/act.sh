#!/usr/bin/env bash
# scripts/act.sh <N> (make act-N): one act's wave (D10). Refuses unless the
# lab is at act N-1. Terraform declares act N, then ansible/act-N.yml does
# the runtime steps, and only then .build/act becomes N, so a failed wave
# leaves the lab at the act it had.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
n=${1:?Usage: act.sh <1..6>}
[[ "$n" =~ ^[1-6]$ ]] || die "act: N is 1 to 6"
now=$(cat "$BUILD_DIR/act" 2>/dev/null || echo 0)
[ "$now" = $((n - 1)) ] || die "act $n: the lab is at act $now; run the acts in order (or make stage-reset CONFIRM=yes)"
t0=$(date +%s)
ACT=$n ./scripts/tf.sh vault-platform apply -no-color >"$BUILD_DIR/act-$n.tf.log" 2>&1 ||
  die "act $n: Terraform failed ($BUILD_DIR/act-$n.tf.log)"
[ ! -f "ansible/act-$n.yml" ] || ./scripts/ansible.sh "act-$n" || die "act $n: the wave failed; the lab stays at act $now"
printf '%s\n' "$n" >"$BUILD_DIR/act.tmp" && mv "$BUILD_DIR/act.tmp" "$BUILD_DIR/act"
mkdir -p "$BUILD_DIR/acts"
jq -n --argjson n "$n" --argjson s "$(($(date +%s) - t0))" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{act: $n, seconds: $s, at: $at}' >"$BUILD_DIR/acts/act-$n.json"
info "act $n done in $(($(date +%s) - t0))s"
