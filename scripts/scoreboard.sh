#!/usr/bin/env bash
# scripts/scoreboard.sh (make scoreboard): read-only. The four numbers of D4
# from the witness history (api/lib/scoreboard.js wrote
# .build/witness/scoreboard.json on the last make witness), each with the
# runs and rows it rests on, and the residuals with their reason.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
f="$BUILD_DIR/witness/scoreboard.json"
[ -s "$f" ] || die "scoreboard: no witness run yet (make witness)"
jq -r '
  "act \(.act), witness run \(.at)",
  "  standing secrets     \(.standing.value)   (\([.standing.evidence[].id] | join(", ")))",
  "  longest lifetime     \(if .longest.never then "never (\(.longest.id))" elif .longest.value == null then "unknown" else "\(.longest.value)s (\(.longest.id // "none")\(if .longest.replacement then ", what replaced it" else "" end))" end)",
  "  unmanaged copies     \(.unmanaged.value)   (\([.unmanaged.evidence[].id] | join(", ")))",
  (.leak_windows[] | "  leak window \(.canary)      \(if .open then "open, \(.seconds // 0)s so far" else "\(.seconds)s, closed \(.closed_at)" end)"),
  (.residuals[] | "  residual \(.id): \(.why)")' "$f"
