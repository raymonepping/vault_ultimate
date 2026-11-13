#!/usr/bin/env bash
# scripts/github-forget-key.sh (make github-forget-key CONFIRM=yes, D10): move
# the GitHub App's private key out of .secrets/github/ to
# .secrets/legacy/<date>/. Vault keeps its registered copy; a rebuild from
# nothing then stops and asks for a new key generated in GitHub.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
[ "${CONFIRM:-}" = yes ] || die "github-forget-key: a rebuild then needs a new key from GitHub; run with CONFIRM=yes"
shopt -s nullglob
keys=("$VULT_ROOT"/.secrets/github/*.pem)
[ ${#keys[@]} -gt 0 ] || die "github-forget-key: no key in .secrets/github/"
dest="$VULT_ROOT/.secrets/legacy/$(date -u +%Y-%m-%d)"
mkdir -p "$dest"
chmod 700 "$VULT_ROOT/.secrets/legacy" "$dest"
mv "${keys[@]}" "$dest/"
echo "github-forget-key: ${#keys[@]} key(s) moved to .secrets/legacy/$(basename "$dest")/ (delete them there, and revoke the key in GitHub's App settings)"
