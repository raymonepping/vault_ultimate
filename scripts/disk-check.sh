#!/usr/bin/env bash
# scripts/disk-check.sh [--before-pull|--before-build]: the disk gate (D20).
# Read-only: reports the Mac's free space and the Podman VM's. Before a pull
# (--before-pull: ai-up) it exits 1 below VULT_DISK_MIN_GIB, before a build
# on local base images (--before-build: app-build) below VULT_DISK_BUILD_GIB; in
# make lab's first phase, which may pull nothing, it warns below that and
# exits 1 only below VULT_DISK_FLOOR_GIB (a full Mac disk breaks the VM). The lab never prunes or removes anything to make
# room; reclaiming space is the operator's call (Personal/docker_inventory).
set -euo pipefail
# shellcheck source=scripts/common.sh
. "$(dirname "$0")/common.sh"

min=$(vult_conf VULT_DISK_MIN_GIB)
min=${min:-20}
floor=$(vult_conf VULT_DISK_FLOOR_GIB)
floor=${floor:-8}
strict=0
[ "${1:-}" = --before-pull ] && strict=1
# A build on local base images needs far less than a multi-GB pull.
if [ "${1:-}" = --before-build ]; then
  strict=1
  min=$(vult_conf VULT_DISK_BUILD_GIB)
  min=${min:-12}
fi

# The Podman VM's disk is a sparse file under the home folder, so the home
# filesystem is the one a pull or a build fills up.
mac_free_k=$(df -Pk "$HOME" | awk 'NR == 2 { print $4 }')
mac_free_gib=$((mac_free_k / 1024 / 1024))
echo "disk-check: Mac ${mac_free_gib} GiB free on $(df -P "$HOME" | awk 'NR == 2 { print $6 }') (need ${min})"

if vm=$(podman machine ssh df -Pk /var 2>/dev/null | awk 'NR == 2 { print $4 }') && [ -n "$vm" ]; then
  echo "disk-check: Podman VM $((vm / 1024 / 1024)) GiB free on /var"
else
  echo "disk-check: Podman VM free space unknown (machine not reachable)"
fi

if [ "$strict" = 0 ] && [ "$mac_free_gib" -ge "$floor" ]; then
  [ "$mac_free_gib" -ge "$min" ] || echo "disk-check: warning: below ${min} GiB; a pull or build will stop until space is reclaimed (docker_inventory)" >&2
  exit 0
fi
if [ "$mac_free_gib" -lt "$( [ "$strict" = 1 ] && echo "$min" || echo "$floor")" ]; then
  cat >&2 <<EOF
disk-check: the Mac has ${mac_free_gib} GiB free, below what this step needs
(${min} GiB before a pull or build, ${floor} GiB to run at all). Nothing was removed. Reclaim space with
Personal/docker_inventory (make ledger, make orphans-peek, approve a review,
make orphans-remove REVIEW=... ARGS=--execute, then make reclaim-host
ARGS=--execute so fstrim returns the VM's freed blocks to the Mac), and rerun.
EOF
  exit 1
fi
