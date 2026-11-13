#!/usr/bin/env bash
# scripts/network.sh: create the shared network if it does not exist, on the
# fixed subnet of config/defaults.conf (Vault reaches LocalStack at a known
# address, so the sync destination's network allowlist can name one /32).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
podman network exists vult-internal ||
  podman network create --label io.vult.project=vault_ultimate --subnet "$(vult_conf VULT_SUBNET)" vult-internal >/dev/null
