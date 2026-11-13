#!/usr/bin/env bash
# scripts/github-installation.sh (make github-installation): the GitHub App's
# installation on the lab's repository (its id, repository selection and
# permissions), for VULT_GITHUB_INSTALLATION_ID in config/defaults.conf.
# Identifiers only: the app JWT is signed in memory and never printed.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
pem=$(find "$VULT_ROOT/.secrets/github" -name '*.pem' -type f 2>/dev/null | head -1)
[ -n "$pem" ] || die "github-installation: no private key in .secrets/github/ (generate one in the app's settings)"
node "$VULT_ROOT/scripts/github-installation.js" "$pem" "$(vult_conf VULT_GITHUB_APP_ID)" \
  "$(vult_conf VULT_GITHUB_OWNER)" "$(vult_conf VULT_GITHUB_REPO)"
