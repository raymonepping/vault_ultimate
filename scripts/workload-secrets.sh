#!/usr/bin/env bash
# scripts/workload-secrets.sh: the before estate's own secrets, generated
# into .secrets/workload/ (0600), create-only: an existing file is never
# replaced (stage-reset puts the same values back on purpose). Never prints a
# value. Ansible renders booking.env and tide-agent.env from these (D15).
#
#   booking-db-password   booking_app's static PostgreSQL password (act 2 removes it)
#   deploy-token          the CI deploy token (a residual: GitHub cannot reach Vault)
#   agent-api-key         tide-agent's static key for the booking API (act 5 removes it)
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
umask 077
dir="$VULT_ROOT/.secrets/workload"
mkdir -p "$dir/tls"
made=0
gen() {
  [ -s "$1" ] && return 0
  printf '%s' "$(openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"$2")" >"$1.tmp"
  mv "$1.tmp" "$1"
  made=$((made + 1))
}
gen "$dir/booking-db-password" 32
gen "$dir/deploy-token" 40
gen "$dir/agent-api-key" 40
echo "workload-secrets: $made new, the rest kept (.secrets/workload, 0600; never printed)"
