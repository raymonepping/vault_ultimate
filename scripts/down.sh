#!/usr/bin/env bash
# scripts/down.sh (make down, and the Lab Index's Stop): stop the console's
# runner, then the stacks from the top (app, workload, ai, cloud, data,
# identity, the cluster, vault-s). Containers and volumes are kept. It says it stopped
# only when podman shows no running vult- container; otherwise it names what
# still runs and fails (the Lab Index then shows a failed stop, not a false one).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
podman info >/dev/null 2>&1 || die "down: Podman does not answer (is the machine running?); nothing was stopped"
"$VULT_ROOT/scripts/runner.sh" stop >/dev/null || true
for stack in app workload ai cloud data identity vault seal; do
  "$VULT_ROOT/scripts/compose.sh" "$stack" stop >/dev/null 2>&1 || true
done
left=$(podman ps --filter name=^vult- --filter status=running --format '{{.Names}}' | paste -sd' ' -)
[ -z "$left" ] || die "down: still running: $left (podman logs <name>, then make down again)"
echo "down: the runner and every vult- stack stopped; every vult- volume kept (make up starts it again)"
