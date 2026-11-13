#!/usr/bin/env bash
# scripts/boundary-check.sh (make boundary): prove the Terraform/Ansible
# boundary Vault enforces (golden_ticket's format). Each scoped token asks
# sys/capabilities-self what it may do on paths it must and must not touch.
# Never prints a token. Rows: token|vault|path|allow:cap or deny:cap.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"

checks=(
  # vault-s (prompt 02)
  "tf-seal|seal|sys/mounts/transit|allow:create"
  "tf-seal|seal|auth/token/roles/autounseal|allow:update"
  "tf-seal|seal|sys/audit/file|allow:sudo"
  "tf-seal|seal|auth/token/create/autounseal|deny:update"
  "tf-seal|seal|sys/policies/acl/vult-tf-seal|deny:update"
  "ansible-seal|seal|auth/token/create/autounseal|allow:update"
  "ansible-seal|seal|auth/token/roles/autounseal|deny:update"
  "ansible-seal|seal|sys/policies/acl/autounseal|deny:update"
  "ansible-seal|seal|sys/mounts/transit|deny:create"
  "ansible-seal|seal|sys/policies/acl/vult-ansible-seal|deny:update"
  # the cluster: tool tokens (prompt 02). A root-namespace token reaches
  # namespace tidewell through tidewell/ paths.
  "tf-platform|vault|sys/namespaces/tidewell|allow:create"
  "tf-platform|vault|sys/audit/file|allow:sudo"
  "tf-platform|vault|tidewell/sys/mounts/database|allow:create"
  "tf-platform|vault|tidewell/sys/mounts/pki|allow:create"
  "tf-platform|vault|tidewell/sys/mounts/ldap|allow:create"
  "tf-platform|vault|tidewell/sys/auth/approle|allow:sudo"
  "tf-platform|vault|tidewell/sys/auth/jwt|allow:sudo"
  "tf-platform|vault|tidewell/database/roles/booking|allow:create"
  "tf-platform|vault|tidewell/pki/roles/booking|allow:create"
  "tf-platform|vault|tidewell/auth/approle/role/booking|allow:create"
  "tf-platform|vault|tidewell/sys/config/oauth-resource-server/tidewell|allow:sudo"
  "tf-platform|vault|tidewell/sys/policies/acl/vult-presenter|allow:update"
  "tf-platform|vault|tidewell/kv/data/ci/deploy-token|deny:read"
  "tf-platform|vault|tidewell/database/config/tidewell|deny:update"
  "tf-platform|vault|tidewell/database/creds/booking|deny:read"
  "tf-platform|vault|tidewell/ldap/static-cred/keycloak-bind|deny:read"
  "tf-platform|vault|tidewell/pki/issue/booking|deny:update"
  "tf-platform|vault|tidewell/auth/approle/role/booking/secret-id|deny:update"
  "tf-platform|vault|tidewell/sys/leases/revoke-prefix/database|deny:update"
  "tf-platform|vault|sys/sync/destinations/gh/tidewell-github|deny:update"
  "tf-platform|vault|tidewell/auth/token/create/vult-presenter|deny:update"
  "tf-platform|vault|sys/policies/acl/vult-tf-platform|deny:update"
  "ansible-platform|vault|sys/sync/github-apps/vaultsyncdemo|allow:update"
  "ansible-platform|vault|sys/sync/destinations/gh/tidewell-github|allow:update"
  "ansible-platform|vault|sys/activation-flags/secrets-import/activate|allow:update"
  "ansible-platform|vault|tidewell/kv/data/ops/harbour-feed|allow:create"
  "ansible-platform|vault|tidewell/kv/data/ops/harbour-feed|deny:read"
  "ansible-platform|vault|tidewell/kv/data/ci/deploy-token|allow:read"
  "ansible-platform|vault|tidewell/database/config/tidewell|allow:update"
  "ansible-platform|vault|tidewell/database/creds/booking|deny:read"
  "ansible-platform|vault|tidewell/auth/approle/role/booking/secret-id|allow:update"
  "ansible-platform|vault|tidewell/pki/issue/booking-year|allow:update"
  "ansible-platform|vault|tidewell/pki/revoke|allow:update"
  "ansible-platform|vault|tidewell/ldap/static-cred/keycloak-bind|allow:read"
  "ansible-platform|vault|tidewell/ldap/static-cred/other|deny:read"
  "ansible-platform|vault|tidewell/sys/leases/revoke-prefix/database/creds/booking|allow:update"
  "ansible-platform|vault|tidewell/sys/mounts/kv|deny:create"
  "ansible-platform|vault|tidewell/sys/auth/approle|deny:update"
  "ansible-platform|vault|tidewell/sys/policies/acl/vult-presenter|deny:update"
  "ansible-platform|vault|sys/policies/acl/vult-ansible-platform|deny:update"
)

fails=0
checked=0
skipped=0
for check in "${checks[@]}"; do
  IFS='|' read -r name cluster path expect <<<"$check"
  file="$VULT_STATE/tokens/$name"
  if [ ! -s "$file" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  if [ "$cluster" = seal ]; then vault_node vault-s; else vault_cluster; fi
  caps=$(vcurl "$(cat "$file")" -sS --cacert "$VAULT_CACERT" \
    -X POST -d "{\"paths\":[\"$path\"]}" "$VAULT_ADDR/v1/sys/capabilities-self" |
    jq -r --arg p "$path" 'if .errors then "ERROR" else ((.data // .)[$p] // [] | join(",")) end')
  mode=${expect%%:*}
  cap=${expect#*:}
  if [ "$caps" = ERROR ]; then
    # A refused question proves nothing, also not a deny.
    printf '  \033[31mFAIL\033[0m %-17s %-5s %-6s %s (capabilities-self refused)\n' "${who:-$name}" "$mode" "$cap" "$path"
    fails=$((fails + 1))
    checked=$((checked + 1))
    continue
  fi
  has=no
  [[ ",$caps," == *",$cap,"* || ",$caps," == *",root,"* ]] && has=yes
  if { [ "$mode" = allow ] && [ "$has" = yes ]; } || { [ "$mode" = deny ] && [ "$has" = no ]; }; then
    printf '  \033[32mok\033[0m   %-17s %-5s %-6s %s\n' "$name" "$mode" "$cap" "$path"
  else
    printf '  \033[31mFAIL\033[0m %-17s %-5s %-6s %s (has: %s)\n' "$name" "$mode" "$cap" "$path" "${caps:-none}"
    fails=$((fails + 1))
  fi
  checked=$((checked + 1))
done
# ── The presenter in namespace tidewell (D13) ───────────────────────────────────
# who|path|allow:cap or deny:cap. Saskia writes values and never reads one,
# moves only the lab's two destinations, never touches the app or a policy.
ns=$(vult_conf VULT_NAMESPACE)
people_checks=(
  "saskia|kv/data/parcel/delivery-api|allow:create"
  "saskia|kv/data/parcel/delivery-api|allow:update"
  "saskia|kv/data/parcel/delivery-api|allow:read"
  "saskia|kv/data/parcel/smtp-relay|deny:read"
  "saskia|kv/data/parcel/label-printer|deny:read"
  "saskia|kv/data/other/x|deny:create"
  "saskia|kv/metadata/parcel/delivery-api|allow:read"
  "saskia|kv/metadata/parcel/delivery-api|deny:delete"
  "saskia|sys/sync/destinations/gh/tidewell-github/associations/set|allow:update"
  "saskia|sys/sync/destinations/aws-sm/tidewell-localstack/associations/remove|allow:update"
  "saskia|sys/sync/destinations/gh/tidewell-github|deny:update"
  "saskia|sys/sync/destinations/gh/tidewell-github|deny:delete"
  "saskia|sys/sync/destinations/gh/other/associations/set|deny:update"
  "saskia|sys/sync/github-apps/vaultsyncdemo|deny:read"
  "saskia|sys/policies/acl/vult-presenter|deny:update"
  "saskia|auth/userpass/users/saskia|deny:update"
)
vault_cluster
for check in "${people_checks[@]}"; do
  IFS='|' read -r who path expect <<<"$check"
  # The presenter's Vault login (Keycloak -> jwt) arrives with the people
  # phase, which writes .build/people.json; until then these rows are skipped.
  if [ ! -s "$BUILD_DIR/people.json" ] || [ ! -s "$VULT_ROOT/.secrets/people/$who" ]; then skipped=$((skipped + 1)); continue; fi
  person_login "$who" || { fails=$((fails + 1)); checked=$((checked + 1)); continue; }
  tok=$VAULT_TOKEN
  unset VAULT_TOKEN
  caps=$(vcurl "$tok" -sS --cacert "$VAULT_CACERT" -H "X-Vault-Namespace: $ns" \
    -X POST -d "{\"paths\":[\"$path\"]}" "$VAULT_ADDR/v1/sys/capabilities-self" |
    jq -r --arg p "$path" 'if .errors then "ERROR" else ((.data // .)[$p] // [] | join(",")) end')
  vcurl "$tok" -sS -o /dev/null --cacert "$VAULT_CACERT" -H "X-Vault-Namespace: $ns" \
    -X POST "$VAULT_ADDR/v1/auth/token/revoke-self" || true
  unset tok
  mode=${expect%%:*}
  cap=${expect#*:}
  if [ "$caps" = ERROR ]; then
    # A refused question proves nothing, also not a deny.
    printf '  \033[31mFAIL\033[0m %-17s %-5s %-6s %s (capabilities-self refused)\n' "${who:-$name}" "$mode" "$cap" "$path"
    fails=$((fails + 1))
    checked=$((checked + 1))
    continue
  fi
  has=no
  [[ ",$caps," == *",$cap,"* || ",$caps," == *",root,"* ]] && has=yes
  if { [ "$mode" = allow ] && [ "$has" = yes ]; } || { [ "$mode" = deny ] && [ "$has" = no ]; }; then
    printf '  \033[32mok\033[0m   %-17s %-5s %-6s %s\n' "$who" "$mode" "$cap" "$path"
  else
    printf '  \033[31mFAIL\033[0m %-17s %-5s %-6s %s (has: %s)\n' "$who" "$mode" "$cap" "$path" "${caps:-none}"
    fails=$((fails + 1))
  fi
  checked=$((checked + 1))
done
mkdir -p "$BUILD_DIR/gates"
jq -n --arg result "$([ "$fails" -eq 0 ] && echo pass || echo fail)" --argjson checked "$checked" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{gate: "boundary", result: $result, checks: $checked, at: $at}' >"$BUILD_DIR/gates/boundary.json"
[ "$fails" -eq 0 ] || die "$fails boundary check(s) failed."
[ "$checked" -gt 0 ] || die "no scoped token found: run make lab"
note=""
[ "$skipped" -eq 0 ] || note=", $skipped skipped: token not issued yet"
info "Token boundary holds ($checked checks$note)"
