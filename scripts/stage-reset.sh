#!/usr/bin/env bash
# scripts/stage-reset.sh (make stage-reset CONFIRM=yes, D17): back to act 0 on
# purpose, static password and all, then prove it: the witness must count
# the act 0 baseline (every inventory credential standing, every copy
# unmanaged).
#
#   1. ansible stage-reset    the acts in reverse up to Terraform (the app back
#                             on booking.env, Agent gone, associations and KV
#                             paths removed, the act 0 note deleted)
#   2. Terraform ACT=0        database/ and approle/ unmounted (every lease
#                             revoked, its sessions ended), booking-year back
#   3. before-estate, canary  with VULT_RESET=1: a new year-long certificate,
#                             the legacy store, the hand-made copies, the note,
#                             .build/act = 0
#   4. the witness history is archived (a new leak window starts), then a run
# Vault's audit files are never edited.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
answer=${CONFIRM:-}
if [ "$answer" != yes ]; then
  printf 'This puts every standing secret back (act 0) and removes the synced copies. Type yes: '
  read -r answer
fi
[ "$answer" = yes ] || {
  echo "Aborted."
  exit 1
}
t0=$(date +%s)
step() { # name, command...
  local name=$1
  shift
  "$@" >"$BUILD_DIR/stage-reset-$name.log" 2>&1 || {
    tail -40 "$BUILD_DIR/stage-reset-$name.log" >&2
    die "stage-reset: $name failed ($BUILD_DIR/stage-reset-$name.log)"
  }
}
step undo ./scripts/ansible.sh stage-reset
step terraform env ACT=0 ./scripts/tf.sh vault-platform apply -no-color
export VULT_RESET=1
step before-estate ./scripts/ansible.sh before-estate
step canary ./scripts/ansible.sh canary
unset VULT_RESET
rm -f "$BUILD_DIR"/acts/act-*.json

if [ -d "$BUILD_DIR/witness/history" ]; then
  mkdir -p "$BUILD_DIR/witness/archive"
  mv "$BUILD_DIR/witness/history" "$BUILD_DIR/witness/archive/$(date -u +%Y%m%dT%H%M%SZ)"
fi
if [ "$(vult_container_state vult-api)" = running ]; then
  podman kill --signal USR2 vult-api >/dev/null || echo "stage-reset: the API could not clear its event list (podman logs vult-api)" >&2
fi

./scripts/witness.sh >"$BUILD_DIR/stage-reset-witness.log" 2>&1 || {
  cat "$BUILD_DIR/stage-reset-witness.log" >&2
  die "stage-reset: the witness did not run"
}
w="$BUILD_DIR/witness/latest.json"
want_s=$(jq '.credentials | length' config/inventory.json)
want_u=$(jq '.copies | length' config/inventory.json)
got_s=$(jq .standing "$w")
got_u=$(jq .unmanaged "$w")
if [ "$got_s" != "$want_s" ] || [ "$got_u" != "$want_u" ]; then
  cat "$BUILD_DIR/stage-reset-witness.log" >&2
  die "stage-reset: the witness counts standing $got_s/$want_s, unmanaged $got_u/$want_u: not the act 0 baseline"
fi
echo "stage-reset: act 0 in $(($(date +%s) - t0))s; the witness counts the baseline (standing $got_s, unmanaged copies $got_u, longest $(jq -r 'if .longest.never then "never" else .longest.seconds end' "$w"))"
