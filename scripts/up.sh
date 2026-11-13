#!/usr/bin/env bash
# scripts/up.sh (make up, D17): the daily start, and the Lab Index's Start
# button (it runs `make up RUNTIME=podman` with stdin closed). Idempotent:
#   - no licence installed: install it from .env, or stop with the instruction;
#   - never built (no cluster init file): run make lab, the whole build;
#   - otherwise: clock, vault-s up and unsealed, vault-1..3 (Transit
#     auto-unseal) and a leader, LocalStack, the presenter's login checked
#     (make people), the app; then the one-shot init container goes.
# Each step says what it found and what it did ("kept" when nothing had to
# change). Volumes are never touched. It never asks a question.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
step() { printf '\033[1m%-12s\033[0m %s\n' "$1" "$2"; }
was() { vult_container_state "$1"; }

if [ ! -s "$VULT_STATE/vault.hclic" ]; then
  ./scripts/license.sh </dev/null || die "up: no Vault Enterprise licence. Put VAULT_LICENSE in .env (see .env.example), then make up again."
fi
[ -s vault-tls/vault.crt ] || ./scripts/gen-certs.sh
if [ ! -s "$VULT_STATE/vault-init.json" ]; then
  step build "this lab has never been built: make lab (about two minutes)"
  ./scripts/lab.sh
  step built "from nothing; make show-ready before a talk"
  exit 0
fi

step clock-sync "$("$VULT_ROOT/scripts/clock-sync.sh" 2>&1 | tail -1)"
before=$(was "$(vault_container vault-s)")
"$VULT_ROOT/scripts/vault-up.sh" >"$BUILD_DIR/up-vault.log" 2>&1 || {
  cat "$BUILD_DIR/up-vault.log" >&2
  die "up: the Vault stacks did not come up (make vault-status, make vault-logs)"
}
step vault "$( [ "$before" = running ] && echo "kept: " )$(tail -1 "$BUILD_DIR/up-vault.log" | sed 's/^vault-up: //')"
before=$(was vult-localstack)
"$VULT_ROOT/scripts/cloud-up.sh" >"$BUILD_DIR/up-cloud.log" 2>&1 || {
  cat "$BUILD_DIR/up-cloud.log" >&2
  die "up: LocalStack did not come up (podman logs vult-localstack)"
}
if [ "$before" = running ]; then
  step cloud "kept: localstack running"
else
  # A fresh LocalStack is empty (no persistence on the free licence): the
  # legacy store again, and the AWS destination reconciled with it.
  for p in seed destinations; do
    "$VULT_ROOT/scripts/ansible.sh" "$p" >"$BUILD_DIR/up-$p.log" 2>&1 || {
      tail -20 "$BUILD_DIR/up-$p.log" >&2
      die "up: LocalStack started empty and ansible $p failed (make $p)"
    }
  done
  step cloud "localstack started ($before before), legacy store seeded, AWS destination reconciled"
fi
"$VULT_ROOT/scripts/ansible.sh" people >"$BUILD_DIR/up-people.log" 2>&1 || {
  tail -20 "$BUILD_DIR/up-people.log" >&2
  die "up: the credentials could not be checked (make people)"
}
step credentials "$(jq -r 'if .changed_total == 0 then "kept: Saskia'"'"'s login as declared" else "set \(.changed_total) (was not as declared)" end' "$BUILD_DIR/ansible-stats/people.json")"
before=$(was vult-api)
ids() { podman inspect --format '{{.Id}}' vult-api vult-web 2>/dev/null | paste -sd' ' -; }
ids_before=$(ids)
"$VULT_ROOT/scripts/app-up.sh" >"$BUILD_DIR/up-app.log" 2>&1 || {
  cat "$BUILD_DIR/up-app.log" >&2
  die "up: the app did not come up (make app-logs)"
}
# Compose recreates a container whose image was rebuilt: say so, not "kept".
if [ "$before" != running ]; then step app "api, web started ($before before)"
elif [ "$(ids)" != "$ids_before" ]; then step app "recreated: api or web had a new image or settings"
else step app "kept: api, web running"; fi
step init "one-shot web-init removed after a successful start"
echo "up: done. make verify to check, make doctor if something looks wrong, make show-ready before a talk."
