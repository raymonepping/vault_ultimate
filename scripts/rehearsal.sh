#!/usr/bin/env bash
# scripts/rehearsal.sh (make rehearsal): the show, end to end, through the
# console API as Saskia (scripts/rehearsal.mjs): act 0's baseline, acts 1 to
# 6 with the witness numbers, bookings during each wave and Vault's answers,
# act 6's revocation, rotation, timeline and summary, every negative, and no
# value anywhere. Starts and ends with make stage-reset: act 0 again.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
t0=$(date +%s)
# Everything it prints is also kept in .build/rehearsal.log (no value is ever printed).
exec > >(tee "$BUILD_DIR/rehearsal.log") 2>&1
echo "stage-reset (before)"
CONFIRM=yes ./scripts/stage-reset.sh | sed 's/^/  /'
rc=0
NODE_EXTRA_CA_CERTS="$VULT_ROOT/vault-tls/ca-chain.pem" node scripts/rehearsal.mjs "$VULT_ROOT" || rc=$?
echo "stage-reset (after)"
CONFIRM=yes ./scripts/stage-reset.sh | sed 's/^/  /' || rc=1
echo "rehearsal: $(($(date +%s) - t0))s"
exit "$rc"
