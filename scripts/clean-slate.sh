#!/usr/bin/env bash
# scripts/clean-slate.sh: DESTRUCTIVE. Removes this lab's containers and
# volumes (vult- only) and moves its Vault credentials, Terraform state and
# the people's passwords aside to .secrets/legacy/<timestamp>/. Keeps the lab
# CA, the GitHub App key (D13), the licence, the images and the Ollama models
# volume (D8: make clean-models removes it on purpose). First removes the
# story's associations while Vault still runs, so no TIDEWELL_ secret outlives
# the cluster in GitHub. Type DELETE (or CONFIRM=DELETE).
# Back up first (make backup).
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"

answer=${CONFIRM:-}
if [ "$answer" != DELETE ]; then
  printf 'This removes every vult- container and volume (Vault data, audit logs) and moves credentials aside. Type DELETE: '
  read -r answer
fi
[ "$answer" = DELETE ] || {
  echo "Aborted."
  exit 1
}
# GitHub keeps a synced copy until Vault removes the association.
if [ -s .secrets/vault/tokens/ansible-platform ] && [ "$(vult_container_state "$(vault_container vault-1)")" = running ]; then
  ./scripts/ansible.sh stage-reset >"$BUILD_DIR/clean-slate-unsync.log" 2>&1 ||
    echo "clean-slate: could not remove the associations (.build/clean-slate-unsync.log); check GitHub for TIDEWELL_ secrets"
fi
for stack in app workload cloud ai data identity vault seal; do
  # ai's models volume is external, so down -v leaves it in place.
  "$VULT_ROOT/scripts/compose.sh" "$stack" down -v --remove-orphans 2>/dev/null || true
done
# Anything left with the prefix (one-shot containers, external volumes).
podman ps -a --filter name=^vult- --format '{{.Names}}' | xargs -r podman rm -f >/dev/null
podman volume ls -q --filter name=^vult- | { grep -vx vult-ollama_models || true; } | xargs -r podman volume rm -f >/dev/null
podman network exists vult-internal && podman network rm vult-internal >/dev/null
legacy=".secrets/legacy/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$legacy"
for p in .secrets/vault/seal-init.json .secrets/vault/vault-init.json .secrets/vault/seal .secrets/vault/tokens \
  .secrets/terraform .secrets/people; do
  [ -e "$p" ] && mv "$p" "$legacy/"
done
echo "clean-slate: containers, volumes and network removed; credentials moved to $legacy"
echo "clean-slate: start again with make lab"
