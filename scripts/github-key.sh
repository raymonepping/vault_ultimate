#!/usr/bin/env bash
# scripts/github-key.sh (make github-key): copy the VaultSyncDemo App's private
# key from ../vault_sync/.secrets/github/ into this lab's .secrets/github/
# (0600), by path, once (D13). The key is never printed or read into output;
# only its public-key fingerprint is shown. Keep it: a rebuild from nothing
# registers the app again (vault_sync D10).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
umask 077
dst="$VULT_ROOT/.secrets/github"
mkdir -p "$dst"
if compgen -G "$dst/*.pem" >/dev/null; then
  pem=$(find "$dst" -name '*.pem' -type f | head -1)
else
  src=$(find "$VULT_ROOT/../vault_sync/.secrets/github" -maxdepth 1 -name '*.pem' -type f 2>/dev/null | head -1)
  [ -n "$src" ] || die "github-key: no key in ../vault_sync/.secrets/github/ (generate one in the app's GitHub settings, save it in .secrets/github/)"
  pem="$dst/$(basename "$src")"
  cp "$src" "$pem"
  chmod 600 "$pem"
fi
fp=$(openssl pkey -in "$pem" -pubout -outform DER 2>/dev/null | shasum -a 256 | cut -c1-8)
echo "github-key: .secrets/github/$(basename "$pem") present (public key fingerprint $fp)"
