#!/usr/bin/env bash
# scripts/tf.sh <root> <init|plan|apply|output|state-list|destroy> [terraform args...]
#
# The only supported way to run Terraform here. Each root runs on its own
# scoped token (D7), exported for this process only: vault-seal → tf-seal on
# vault-s, vault-platform → tf-platform on the cluster. State and the data
# dir live in .secrets/terraform/<root>/ (0600 after every run). Writes the
# non-secret evidence file .build/terraform/<root>.json. Never echoes a token.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"

usage="Usage: tf.sh <root> <init|plan|apply|output|state-list|destroy> [args]"
root=${1:?$usage}
action=${2:?$usage}
shift 2
dir="$VULT_ROOT/terraform/$root"
[ -f "$dir/versions.tf" ] || die "tf: unknown root '$root'"

case "$root" in
vault-seal) node=vault-s token=tf-seal ;;
vault-platform) node=cluster token=tf-platform ;;
*) die "tf: no token mapped for root '$root'" ;;
esac
if [ "$node" = cluster ]; then vault_cluster; else vault_node "$node"; fi
if [ "$action" != output ] && [ "$action" != state-list ]; then vault_token "$token"; fi
export VAULT_ADDR VAULT_CACERT
export TF_VAR_vault_addr="$VAULT_ADDR" TF_VAR_vault_cacert="$VAULT_CACERT"
case "$root" in
vault-platform)
  TF_VAR_namespace=$(vult_conf VULT_NAMESPACE)
  TF_VAR_sync_secret=$(jq -r .sync.secret "$VULT_ROOT/config/story.json")
  # D10: the act Terraform declares. ACT=current (or unset) is the act the
  # last wave reached (.build/act, 0 before act 1 and after a stage reset).
  act=${ACT:-current}
  [ "$act" != current ] || act=$(cat "$BUILD_DIR/act" 2>/dev/null || echo 0)
  [[ "$act" =~ ^[0-6]$ ]] || die "tf: ACT must be current or 0..6 (got $act)"
  TF_VAR_act=$act
  # Vault reads TTLs back in seconds (a "1h" would be a permanent diff).
  secs() { case "$1" in *h) echo $((${1%h} * 3600)) ;; *m) echo $((${1%m} * 60)) ;; *s) echo "${1%s}" ;; *) die "tf: $1 is not a duration like 15m, 1h or 60s" ;; esac; }
  TF_VAR_cert_ttl=$(secs "$(vult_conf VULT_CERT_TTL)")
  TF_VAR_lease_ttl=$(secs "$(vult_conf VULT_LEASE_TTL)")
  TF_VAR_booking_ip=$(vult_conf VULT_BOOKING_IP)
  export TF_VAR_namespace TF_VAR_sync_secret TF_VAR_act TF_VAR_cert_ttl TF_VAR_lease_ttl TF_VAR_booking_ip
  ;;
esac

state_dir="$VULT_ROOT/.secrets/terraform/$root"
mkdir -p "$state_dir" "$BUILD_DIR/terraform"
chmod 700 "$VULT_ROOT/.secrets/terraform" "$state_dir"
export TF_DATA_DIR="$state_dir/.terraform"
state="$state_dir/terraform.tfstate"
lock_down() { find "$state_dir" -maxdepth 1 -name '*.tfstate*' -exec chmod 600 {} + 2>/dev/null || true; }
trap lock_down EXIT

cd "$dir"
terraform init -input=false -backend-config="path=$state" >/dev/null

evidence() { # field value
  local f="$BUILD_DIR/terraform/$root.json" cur='{}'
  [ -s "$f" ] && cur=$(cat "$f")
  count=$(terraform state list 2>/dev/null | grep -cv '^data\.' || true)
  jq --arg k "$1" --argjson v "$2" --argjson c "${count:-0}" --arg root "$root" \
    '.root = $root | .[$k] = $v | .resources = $c' <<<"$cur" >"$f.tmp" && mv "$f.tmp" "$f"
}
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

rc=0
case "$action" in
init) ;;
plan)
  terraform plan -input=false -detailed-exitcode -lock-timeout=60s "$@" || rc=$?
  [ "$rc" -le 2 ] && evidence last_plan "$(jq -n --arg at "$(now)" --argjson rc "$rc" '{at: $at, exit: $rc, changes: ($rc == 2)}')"
  ;;
apply)
  terraform apply -input=false -auto-approve -lock-timeout=60s "$@" || rc=$?
  [ "$rc" -eq 0 ] && evidence last_apply "$(jq -n --arg at "$(now)" '{at: $at}')"
  ;;
destroy) terraform destroy -input=false -auto-approve "$@" || rc=$? ;;
output) terraform output "$@" || rc=$? ;;
state-list) terraform state list "$@" || rc=$? ;;
*) die "tf: unknown action '$action'" ;;
esac
exit "$rc"
