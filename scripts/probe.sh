#!/usr/bin/env bash
# scripts/probe.sh (make probe): measure what Vault Enterprise 2.2.1 and the
# lab's targets actually do before prompts 04 to 07 build on them (prompt 03,
# questions 1 to 12 of prompts/00_brief.md). Scratch only: a namespace
# probe-<epoch> (database, approle, pki, ldap, jwt, kv, identity, the OAuth
# profile), its PostgreSQL roles and sessions, the LDAP entry cn=probe-bind, a
# scratch Keycloak realm probe-<epoch>, root-namespace sync objects probe-*, a
# disposable GitHub secret PROBE_*, LocalStack secrets probe*. All removed at
# the end, also on failure (KEEP=1 keeps them). Runs on the 4h probe token
# bootstrap minted, never a root token. Synthetic values only; no value, key,
# password or token is printed: values are compared as fingerprints.
# ONLY="Q2 Q4" runs a subset. Writes docs/capabilities.md (a full run only)
# and .build/probe/results.json.
set -euo pipefail
umask 077
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
# shellcheck source=scripts/probe-lib.sh
source "$VULT_ROOT/scripts/probe-lib.sh"
cd "$VULT_ROOT"

OUT="$VULT_ROOT/docs/capabilities.md"
ROWS=$(mktemp)
NOTES=$(mktemp)
WORK=$(mktemp -d)
pass=0
fail=0
T=$(cat "$VULT_STATE/tokens/probe" 2>/dev/null) || die "probe: no probe token (.secrets/vault/tokens/probe); bootstrap mints one"
vault_active
api "$T" GET auth/token/lookup-self
[ "$ST" = 200 ] || die "probe: the probe token is not accepted (expired after 4h?): HTTP $ST $ERR"
ACTIVE=$VAULT_ADDR
note() { printf -- '- %s\n' "$*" >>"$NOTES"; }
yes_if() { if eval "$1"; then echo yes; else echo no; fi; }
want() { [ -z "${ONLY:-}" ] || [[ " $ONLY " == *" $1 "* ]]; }
EPOCH=$(date +%s)
NS="probe-$EPOCH"
REALM="probe-$EPOCH"
OWNER=$(vult_conf VULT_GITHUB_OWNER)
REPO=$(vult_conf VULT_GITHUB_REPO)
APP_ID=$(vult_conf VULT_GITHUB_APP_ID)
INSTALL=$(vult_conf VULT_GITHUB_INSTALLATION_ID)
PEM=$(find "$VULT_ROOT/.secrets/github" -name '*.pem' -type f 2>/dev/null | head -1)
LS_IP=$(vult_conf VULT_LOCALSTACK_IP)
LS="https://localhost:$(vult_conf VULT_PORT_LOCALSTACK)"
KC="https://localhost:$(vult_conf VULT_PORT_KEYCLOAK)"
REGION=$(vult_conf VULT_AWS_REGION)
APP="probe-app-$EPOCH"
GH_DEST="probe-gh-$EPOCH"
AWS_DEST="probe-aws-$EPOCH"
KVS="e${EPOCH}-hand"
GH_NAME="PROBE_E${EPOCH}_HAND_VALUE"
AWS_NAME="probe${EPOCH}hand"
B="dc=tidewell,dc=lab"

aws_sm() { # <Action> <json> [access key]: sets AST, ABODY
  local out
  out=$(mktemp)
  AST=$(curl -sS -o "$out" -w '%{http_code}' --cacert "$VAULT_CACERT" -X POST "$LS/" \
    -H "X-Amz-Target: secretsmanager.$1" -H 'Content-Type: application/x-amz-json-1.1' \
    -H "Authorization: AWS4-HMAC-SHA256 Credential=${3:-test}/20260101/$REGION/secretsmanager/aws4_request, SignedHeaders=host, Signature=0" \
    --data-binary @<(printf '%s' "$2") || echo 000)
  ABODY=$(cat "$out")
  rm -f "$out"
}
fp() { printf '%s' "$1" | shasum -a 256 | cut -c1-8; }
gh_secrets() { gh secret list -R "$OWNER/$REPO" --json name,updatedAt 2>/dev/null || echo '[]'; }
pg() { podman exec vult-postgres gosu postgres psql -d tidewell -tAc "$1" 2>&1 | tr -d '\r'; }
sessions_of() { pg "select count(*) from pg_stat_activity where usename = '$1'"; }
# hold <user> <password>: keep one TLS session open as <user> for 5 minutes,
# inside vult-postgres (the password goes in through a pgpass file on stdin).
hold() {
  printf 'postgres:5432:tidewell:%s:%s\n' "$1" "$2" |
    podman exec -i vult-postgres sh -c "umask 077; cat >/tmp/probe-$1.pgpass"
  podman exec -d vult-postgres sh -c "PGPASSFILE=/tmp/probe-$1.pgpass PGSSLMODE=require psql -h postgres -U $1 -d tidewell -c 'select pg_sleep(300)'" >/dev/null
  HELD_PID=""
  for _ in $(seq 1 20); do
    HELD_PID=$(pg "select pid from pg_stat_activity where usename = '$1' limit 1")
    [ -n "$HELD_PID" ] && return 0
    sleep 0.5
  done
  return 1
}
# alive <pid>: 1 while that backend still exists (a dropped role's session
# has no usename any more, so it is followed by pid, not by name).
alive() { pg "select count(*) from pg_stat_activity where pid = ${1:-0}"; }
# login_as <user> <password>: one new TLS login; sets LOGIN (ok or the error).
login_as() {
  printf 'postgres:5432:tidewell:%s:%s\n' "$1" "$2" |
    podman exec -i vult-postgres sh -c "umask 077; cat >/tmp/probe-$1.try.pgpass"
  LOGIN=$(podman exec vult-postgres sh -c "PGPASSFILE=/tmp/probe-$1.try.pgpass PGSSLMODE=require psql -h postgres -U $1 -d tidewell -tAc 'select 1' 2>&1; rm -f /tmp/probe-$1.try.pgpass" | tr -d '\r' | head -1)
  [ "$LOGIN" = 1 ] && LOGIN=ok
  return 0
}
# ldap_bind <dn> <password>: sets BIND (ok or the error).
ldap_bind() {
  BIND=$(printf '%s' "$2" | podman exec -i vult-openldap sh -c "umask 077; cat >/tmp/.probe.pw; ldapwhoami -x -H ldap://localhost -D '$1' -y /tmp/.probe.pw 2>&1; rm -f /tmp/.probe.pw" | head -1)
  case "$BIND" in dn:*) BIND=ok ;; esac
  return 0
}
kc_admin() { # sets KAT (an admin access token for the master realm), or KERR
  local r
  r=$(jq -jn --rawfile p .secrets/identity/keycloak-admin-password '$p | rtrimstr("\n") | @uri "grant_type=password&client_id=admin-cli&username=admin&password=\(.)"' |
    curl -sS --cacert "$VAULT_CACERT" "$KC/realms/master/protocol/openid-connect/token" --data-binary @-)
  KAT=$(jq -r '.access_token // empty' <<<"$r")
  KERR=$(jq -c '{error, error_description}' <<<"$r" 2>/dev/null)
}
kcapi() { # <METHOD> <path> [json]: Keycloak admin REST; sets KST, KBODY
  local out
  out=$(mktemp)
  if [ -n "${3:-}" ]; then
    KST=$(curl -sS -o "$out" -w '%{http_code}' --cacert "$VAULT_CACERT" -X "$1" -K <(printf 'header = "Authorization: Bearer %s"\n' "$KAT") \
      -H 'Content-Type: application/json' --data-binary @<(printf '%s' "$3") "$KC/admin/realms$2" || echo 000)
  else
    KST=$(curl -sS -o "$out" -w '%{http_code}' --cacert "$VAULT_CACERT" -X "$1" -K <(printf 'header = "Authorization: Bearer %s"\n' "$KAT") "$KC/admin/realms$2" || echo 000)
  fi
  KBODY=$(cat "$out")
  rm -f "$out"
}
# person_jwt <user>: a Keycloak access token for <user> (lab-only client).
person_jwt() {
  jq -jn --rawfile p ".secrets/people/$1" --arg u "$1" '$p | rtrimstr("\n") | @uri "grant_type=password&client_id=tidewell-cli&username=\($u)&password=\(.)"' |
    curl -sS --cacert "$VAULT_CACERT" "$KC/realms/tidewell/protocol/openid-connect/token" --data-binary @- | jq -r '.access_token // empty'
}

PG_USERS=()
cleanup() {
  set +e
  if [ "${KEEP:-0}" = 1 ]; then
    echo "probe: KEEP=1, scratch objects kept"
  else
    for u in "${PG_USERS[@]}"; do
      pg "select pg_terminate_backend(pid) from pg_stat_activity where usename = '$u'" >/dev/null
      pg "drop role if exists \"$u\"" >/dev/null
    done
    podman exec vult-postgres sh -c 'rm -f /tmp/probe-*.pgpass' >/dev/null 2>&1
    api "$T" POST "sys/sync/destinations/gh/$GH_DEST/associations/remove" "$(jq -n --arg s "$KVS" '{mount: "probe-kv", secret_name: $s}')"
    api "$T" POST "sys/sync/destinations/aws-sm/$AWS_DEST/associations/remove" "$(jq -n --arg s "$AWS_NAME" '{mount: "probe-kv", secret_name: $s}')"
    sleep 3
    api "$T" DELETE "sys/sync/destinations/gh/$GH_DEST"
    api "$T" DELETE "sys/sync/destinations/aws-sm/$AWS_DEST"
    api "$T" DELETE "sys/sync/github-apps/$APP"
    api "$T" DELETE sys/mounts/probe-kv
    api "$T" DELETE "sys/namespaces/$NS"
    api "$T" LIST sys/namespaces
    for old in $(jq -r '.data.keys[]? | rtrimstr("/") | select(startswith("probe-"))' <<<"$BODY"); do api "$T" DELETE "sys/namespaces/$old"; done
    gh secret delete "$GH_NAME" -R "$OWNER/$REPO" >/dev/null 2>&1
    aws_sm ListSecrets '{"MaxResults":100}'
    for n in $(jq -r --arg p "probe$EPOCH" '.SecretList[]?.Name | select(contains($p))' <<<"$ABODY" 2>/dev/null); do
      aws_sm DeleteSecret "$(jq -n --arg n "$n" '{SecretId: $n, ForceDeleteWithoutRecovery: true}')"
    done
    [ -z "${KAT:-}" ] || kcapi DELETE "/$REALM"
  fi
  set -e
}
trap 'cleanup; rm -rf "$ROWS" "$NOTES" "$WORK"' EXIT

started=$(date +%s)
echo "probe: scratch namespace $NS, realm $REALM, sync objects probe-*-$EPOCH"
api "$T" POST "sys/namespaces/$NS" '{}'
[ "$ST" = 200 ] || die "probe: cannot create the scratch namespace: HTTP $ST $ERR"
P="$NS/"
pol() { api "$T" PUT "${P}sys/policies/acl/$1" "$(jq -n --arg p "$2" '{policy: $p}')"; }

# ── Q1: the licence ───────────────────────────────────────────────────────────
if want Q1; then
  api "$T" GET sys/license/status
  feats=$(jq -c '.data.autoloaded.features // []' <<<"$BODY")
  note "Licence features (2026-11-13): $(jq -r 'join(", ")' <<<"$feats")."
  for f in "Secrets Sync" "Secrets Import" "Namespaces"; do
    if jq -e --arg f "$f" 'index($f)' <<<"$feats" >/dev/null; then row P01 Q1 "licence lists $f" listed listed yes
    else row P01 Q1 "licence lists $f" listed missing no; fi
  done
  agentic=$(jq -r 'map(select(test("agent|oauth|ai"; "i"))) | join(", ")' <<<"$feats")
  row P01 Q1 "licence names an Agentic IAM feature" recorded "${agentic:-no feature named agent/oauth/ai (vault_identity saw the same)}" yes
fi

# ── Q2: PostgreSQL leases and open sessions ──────────────────────────────────
if want Q2; then
  api "$T" POST "${P}sys/mounts/database" '{"type": "database"}'
  conn=$(jq -n --rawfile pw .secrets/data/pg-bootstrap '{plugin_name: "postgresql-database-plugin",
    connection_url: "postgresql://{{username}}:{{password}}@postgres:5432/tidewell?sslmode=verify-full&sslrootcert=/vault/config/tls/ca-chain.pem",
    username: "postgres", password: ($pw | rtrimstr("\n")), allowed_roles: ["probe-*"], verify_connection: true}')
  api "$T" POST "${P}database/config/probe" "$conn"
  row P02 Q2 "database/config with TLS verify-full to postgres" 204 "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 204 ]')"
  create='CREATE ROLE "{{name}}" WITH LOGIN PASSWORD '"'"'{{password}}'"'"' VALID UNTIL '"'"'{{expiration}}'"'"'; GRANT CONNECT ON DATABASE tidewell TO "{{name}}";'
  kill='SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '"'"'{{name}}'"'"';'
  drop='REVOKE ALL PRIVILEGES ON DATABASE tidewell FROM "{{name}}"; DROP ROLE IF EXISTS "{{name}}";'
  api "$T" POST "${P}database/roles/probe-kill" "$(jq -n --arg c "$create" --arg r "$kill $drop" '{db_name: "probe", creation_statements: [$c], revocation_statements: [$r], default_ttl: "25s", max_ttl: "5m"}')"
  api "$T" POST "${P}database/roles/probe-plain" "$(jq -n --arg c "$create" --arg r "$drop" '{db_name: "probe", creation_statements: [$c], revocation_statements: [$r], default_ttl: "5m", max_ttl: "5m"}')"
  for role in probe-kill probe-plain; do
    api "$T" GET "${P}database/creds/$role"
    u=$(jq -r '.data.username' <<<"$BODY")
    pw=$(jq -r '.data.password' <<<"$BODY")
    lease=$(jq -r '.lease_id' <<<"$BODY")
    PG_USERS+=("$u")
    if hold "$u" "$pw"; then held=yes; else held=no; fi
    row P03 Q2 "$role: a dynamic credential holds an open TLS session" "1 session" "sessions=$(sessions_of "$u")" "$held"
    t0=$(date +%s)
    api "$T" PUT "${P}sys/leases/revoke" "$(jq -n --arg l "$lease" '{lease_id: $l}')"
    rv=$ST
    left=1
    for _ in $(seq 1 20); do left=$(alive "$HELD_PID"); [ "$left" = 0 ] && break; sleep 0.5; done
    secs=$(($(date +%s) - t0))
    login_as "$u" "$pw"
    if [ "$role" = probe-kill ]; then
      row P04 Q2 "revoke with pg_terminate_backend in the revocation statements" "session gone, new login refused" "revoke HTTP $rv; sessions=$left after ${secs}s; new login: $LOGIN" "$(yes_if '[ "$left" = 0 ] && [ "$LOGIN" != ok ]')"
    else
      row P05 Q2 "revoke with REVOKE + DROP ROLE only (vault_identity's finding)" "recorded" "revoke HTTP $rv; sessions=$left after ${secs}s; new login: $LOGIN" yes
      [ -z "$HELD_PID" ] || pg "select pg_terminate_backend($HELD_PID)" >/dev/null
    fi
    unset pw
  done
  # Expiry: the TTL ends the lease, and the revocation statements run.
  api "$T" GET "${P}database/creds/probe-kill"
  u=$(jq -r '.data.username' <<<"$BODY"); pw=$(jq -r '.data.password' <<<"$BODY"); ttl=$(jq -r '.lease_duration' <<<"$BODY")
  PG_USERS+=("$u")
  hold "$u" "$pw" || true
  t0=$(date +%s)
  left=1
  for _ in $(seq 1 90); do left=$(alive "$HELD_PID"); [ "$left" = 0 ] && break; sleep 1; done
  secs=$(($(date +%s) - t0))
  row P06 Q2 "lease expiry (TTL ${ttl}s) ends the open session" "session gone near the TTL" "sessions=$left after ${secs}s" "$(yes_if '[ "$left" = 0 ]')"
  unset pw
  logs=$(podman exec vult-postgres sh -c "grep -h '$u' /var/log/postgresql/postgresql.json" 2>/dev/null | jq -r '.message' | sed -E 's/session time: [0-9:.]+/session time: <t>/' | sort -u | head -6 | paste -sd ';' -)
  row P07 Q2 "jsonlog lines for that role (connection, termination, disconnection)" recorded "${logs:-none}" yes
fi

# ── Q3: AppRole with a response-wrapped single-use secret id ─────────────────
if want Q3; then
  api "$T" POST "${P}sys/auth/approle" '{"type": "approle"}'
  pol p-app 'path "kv/data/app/*" { capabilities = ["read"] }'
  api "$T" POST "${P}auth/approle/role/probe" '{"token_policies": ["p-app"], "secret_id_num_uses": 1, "secret_id_ttl": "10m", "token_ttl": "5m", "token_max_ttl": "15m"}'
  api "$T" GET "${P}auth/approle/role/probe/role-id"
  role_id=$(jq -r '.data.role_id' <<<"$BODY")
  api "$T" POST "${P}auth/approle/role/probe/secret-id" '{}' "X-Vault-Wrap-TTL: 60s"
  wrap=$(jq -r '.wrap_info.token // empty' <<<"$BODY")
  row P08 Q3 "secret-id with X-Vault-Wrap-TTL: 60s" "a wrapping token" "HTTP $ST; wrap ttl $(jq -r '.wrap_info.ttl' <<<"$BODY")s, creation path $(jq -r '.wrap_info.creation_path' <<<"$BODY")" "$(yes_if '[ -n "$wrap" ]')"
  api "$wrap" POST sys/wrapping/unwrap '{}'
  sid=$(jq -r '.data.secret_id // empty' <<<"$BODY")
  row P09 Q3 "unwrap once" "the secret id" "HTTP $ST" "$(yes_if '[ -n "$sid" ]')"
  api "$wrap" POST sys/wrapping/unwrap '{}'
  row P10 Q3 "unwrap the same wrapping token again" refused "HTTP $ST: $ERR" "$(yes_if '[[ "$ST" =~ ^4 ]]')"
  login() { api - POST "${P}auth/approle/login" "$(S="$sid" jq -n --arg r "$role_id" '{role_id: $r, secret_id: env.S}')"; }
  login
  # shellcheck disable=SC2034  # read by the yes_if string below, when it is evaluated
  apptok=$(jq -r '.auth.client_token // empty' <<<"$BODY")
  row P11 Q3 "AppRole login with the unwrapped secret id" "a token, ttl 5m" "HTTP $ST; ttl $(jq -r '.auth.lease_duration' <<<"$BODY")s" "$(yes_if '[ -n "$apptok" ]')"
  login
  row P12 Q3 "a second login with the same secret id (secret_id_num_uses=1)" refused "HTTP $ST: $ERR" "$(yes_if '[[ "$ST" =~ ^4 ]]')"
  unset sid wrap apptok
fi

# ── Q4: PKI, revocation, OCSP and CRL ────────────────────────────────────────
if want Q4; then
  api "$T" POST "${P}sys/mounts/pki" '{"type": "pki", "config": {"max_lease_ttl": "87600h"}}'
  api "$T" POST "${P}pki/root/generate/internal" '{"common_name": "Tidewell Probe Root", "ttl": "87600h", "key_type": "ec", "key_bits": 256}'
  jq -r '.data.certificate' <<<"$BODY" >"$WORK/ca.pem"
  base="https://vault-1:8200/v1/${NS}/pki"
  api "$T" POST "${P}pki/config/urls" "$(jq -n --arg b "$base" '{issuing_certificates: [$b + "/ca"], crl_distribution_points: [$b + "/crl"], ocsp_servers: [$b + "/ocsp"]}')"
  api "$T" POST "${P}pki/roles/probe" '{"allowed_domains": ["booking"], "allow_bare_domains": true, "max_ttl": "8760h", "key_type": "ec", "key_bits": 256}'
  api "$T" POST "${P}pki/issue/probe" '{"common_name": "booking", "ttl": "8760h"}'
  [ "$ST" = 200 ] || note "Q4: the year-long issue answered HTTP $ST: $ERR"
  jq -r '.data.certificate' <<<"$BODY" >"$WORK/year.pem"
  serial=$(jq -r '.data.serial_number' <<<"$BODY")
  api "$T" POST "${P}pki/issue/probe" '{"common_name": "booking", "ttl": "1h"}'
  jq -r '.data.certificate' <<<"$BODY" >"$WORK/hour.pem"
  row P13 Q4 "issue a year-long and a one-hour certificate for booking" "both" "year notAfter $(openssl x509 -in "$WORK/year.pem" -noout -enddate | cut -d= -f2); hour notAfter $(openssl x509 -in "$WORK/hour.pem" -noout -enddate | cut -d= -f2)" yes
  api "$T" POST "${P}pki/revoke" "$(jq -n --arg s "$serial" '{serial_number: $s}')"
  row P14 Q4 "revoke the year-long certificate" 200 "HTTP $ST; revocation_time $(jq -r '.data.revocation_time_rfc3339 // .data.revocation_time' <<<"$BODY")" "$(yes_if '[ "$ST" = 200 ]')"
  ocsp() { # <cert file>: the OCSP answer's status line
    openssl ocsp -issuer "$WORK/ca.pem" -cert "$1" -no_nonce -reqout "$WORK/req.der" >/dev/null 2>&1
    curl -sS --cacert "$VAULT_CACERT" -H 'Content-Type: application/ocsp-request' --data-binary @"$WORK/req.der" \
      "$ACTIVE/v1/$NS/pki/ocsp" -o "$WORK/resp.der"
    openssl ocsp -respin "$WORK/resp.der" -issuer "$WORK/ca.pem" -VAfile "$WORK/ca.pem" -resp_text 2>/dev/null | grep -m1 'Cert Status' | sed 's/^ *//'
  }
  y=$(ocsp "$WORK/year.pem"); h=$(ocsp "$WORK/hour.pem")
  row P15 Q4 "OCSP (pki/ocsp) for the revoked year-long certificate" "Cert Status: revoked" "$y" "$(yes_if '[[ "$y" == *revoked* ]]')"
  row P16 Q4 "OCSP for the one-hour certificate" "Cert Status: good" "$h" "$(yes_if '[[ "$h" == *good* ]]')"
  curl -sS --cacert "$VAULT_CACERT" "$ACTIVE/v1/$NS/pki/crl/pem" -o "$WORK/crl.pem"
  hex=$(tr -d ':' <<<"$serial" | tr '[:lower:]' '[:upper:]')
  listed=$(openssl crl -in "$WORK/crl.pem" -noout -text 2>/dev/null | tr -d ' ' | grep -c "SerialNumber:$hex" || true)
  row P17 Q4 "the CRL lists the revoked serial" listed "matches=$listed" "$(yes_if '[ "$listed" -ge 1 ]')"
fi

# ── Q5: LDAP static role and the push into Keycloak ─────────────────────────
if want Q5; then
  api "$T" POST "${P}sys/mounts/ldap" '{"type": "ldap"}'
  cfg=$(jq -n --rawfile pw .secrets/identity/system/vault-rotator --arg b "$B" '{binddn: ("cn=vault-rotator,ou=system," + $b), bindpass: ($pw | rtrimstr("\n")), url: "ldap://openldap", schema: "openldap", userdn: ("ou=system," + $b)}')
  api "$T" POST "${P}ldap/config" "$cfg"
  row P18 Q5 "ldap/config as cn=vault-rotator (schema openldap)" 204 "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 204 ]')"
  api "$T" POST "${P}ldap/static-role/probe-bind" "$(jq -n --arg b "$B" '{dn: ("cn=probe-bind,ou=system," + $b), username: "probe-bind", rotation_period: "24h"}')"
  row P19 Q5 "static role for cn=probe-bind (Vault rotates it at creation)" 204 "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 204 ]')"
  api "$T" GET "${P}ldap/static-cred/probe-bind"
  p1=$(jq -r '.data.password' <<<"$BODY")
  ldap_bind "cn=probe-bind,ou=system,$B" "$p1"
  row P20 Q5 "bind with the password Vault set" ok "$BIND" "$(yes_if '[ "$BIND" = ok ]')"
  # Keycloak: a scratch realm whose federation binds as probe-bind.
  kc_admin
  row P21z Q5 "Keycloak admin token (master realm, admin-cli)" token "$([ -n "$KAT" ] && echo token || echo "$KERR")" "$(yes_if '[ -n "$KAT" ]')"
  kcapi POST "" "$(jq -n --arg r "$REALM" '{realm: $r, enabled: true}')"
  row P21a Q5 "a scratch Keycloak realm" 201 "HTTP $KST $(jq -r '.errorMessage // .error // empty' <<<"$KBODY" 2>/dev/null)" "$(yes_if '[ "$KST" = 201 ]')"
  kcomp=$(PW="$p1" jq -n --arg b "$B" '{name: "probe-ldap", providerId: "ldap", providerType: "org.keycloak.storage.UserStorageProvider",
    config: {enabled: ["true"], vendor: ["other"], usernameLDAPAttribute: ["uid"], rdnLDAPAttribute: ["uid"], uuidLDAPAttribute: ["entryUUID"],
      userObjectClasses: ["inetOrgPerson"], connectionUrl: ["ldap://openldap:389"], usersDn: ["ou=people," + $b],
      bindDn: ["cn=probe-bind,ou=system," + $b], bindCredential: [env.PW], editMode: ["READ_ONLY"], authType: ["simple"]}}')
  kcapi POST "/$REALM/components" "$kcomp"
  row P21b Q5 "a federation in it binding as probe-bind" 201 "HTTP $KST $(jq -r '.errorMessage // .error // empty' <<<"$KBODY" 2>/dev/null)" "$(yes_if '[ "$KST" = 201 ]')"
  kcapi GET "/$REALM/components?name=probe-ldap"
  cid=$(jq -r 'if type == "array" then (.[0].id // empty) else empty end' <<<"$KBODY")
  ktest() { kcapi POST "/$REALM/testLDAPConnection" "$(jq -n --arg c "$cid" --arg b "$B" '{action: "testAuthentication", componentId: $c, connectionUrl: "ldap://openldap:389", authType: "simple", bindDn: ("cn=probe-bind,ou=system," + $b), bindCredential: "**********", useTruststoreSpi: "always", startTls: "false"}')"; }
  ktest
  row P21 Q5 "Keycloak's federation binds with the stored password" 204 "HTTP $KST${KBODY:+: $(jq -r '.errorMessage // .error // empty' <<<"$KBODY" 2>/dev/null)}" "$(yes_if '[ "$KST" = 204 ]')"
  api "$T" POST "${P}ldap/rotate-role/probe-bind" '{}'
  api "$T" GET "${P}ldap/static-cred/probe-bind"
  p2=$(jq -r '.data.password' <<<"$BODY")
  ldap_bind "cn=probe-bind,ou=system,$B" "$p1"
  row P22 Q5 "after rotate-role: the old password binds" refused "$BIND" "$(yes_if '[ "$BIND" != ok ]')"
  ktest
  row P23 Q5 "after rotate-role: Keycloak's stored (old) password" refused "HTTP $KST: $(jq -r '.errorMessage // .error // empty' <<<"$KBODY" 2>/dev/null)" "$(yes_if '[ "$KST" != 204 ]')"
  t0=$(date +%s)
  kcapi GET "/$REALM/components/$cid"
  kcapi PUT "/$REALM/components/$cid" "$(PW="$p2" jq '.config.bindCredential = [env.PW]' <<<"$KBODY")"
  ktest
  row P24 Q5 "push the new password into Keycloak (admin REST), then test" "204 within seconds" "HTTP $KST after $(($(date +%s) - t0))s" "$(yes_if '[ "$KST" = 204 ]')"
  unset p1 p2
fi

# ── Q6: Agentic IAM: a delegation token from Vault's own identity OIDC ──────
if want Q6; then
  # Teun and the agent as named entities; Teun's group carries his policy.
  pol p-teun 'path "kv/data/permits/rebook/*" { capabilities = ["read"] }
path "kv/data/permits/cancel/*" { capabilities = ["read"] }
path "identity/oidc/token/obo-*" { capabilities = ["read"] }'
  pol p-agent-ceiling 'path "kv/data/permits/rebook/*" { capabilities = ["read"] }'
  api "$T" POST "${P}sys/mounts/kv" '{"type": "kv", "options": {"version": "2"}}'
  for path in rebook/day1-1100 cancel/day1-1100; do api "$T" POST "${P}kv/data/permits/$path" '{"data": {"permit": "synthetic-demo"}}'; done
  api "$T" POST "${P}identity/entity" '{"name": "teun", "policies": ["p-teun"]}'
  E_TEUN=$(jq -r '.data.id' <<<"$BODY")
  api "$T" POST "${P}identity/entity" '{"name": "tide-agent"}'
  E_AGENT=$(jq -r '.data.id' <<<"$BODY")
  # Teun signs in to Vault with his Keycloak token (jwt auth, JWKS over TLS).
  api "$T" POST "${P}sys/auth/jwt" '{"type": "jwt"}'
  api "$T" GET "${P}sys/auth"
  JWT_ACC=$(jq -r '.data["jwt/"].accessor // ."jwt/".accessor' <<<"$BODY")
  api "$T" POST "${P}auth/jwt/config" "$(jq -n --rawfile ca "$VAULT_CACERT" '{jwks_url: "https://keycloak:8443/realms/tidewell/protocol/openid-connect/certs", jwks_ca_pem: $ca, bound_issuer: "https://localhost:14203/realms/tidewell"}')"
  row P25 Q6 "jwt auth trusts Keycloak (JWKS over TLS, frontend issuer)" 204 "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 204 ]')"
  api "$T" POST "${P}auth/jwt/role/person" '{"role_type": "jwt", "user_claim": "preferred_username", "bound_audiences": ["tidewell-vault"], "groups_claim": "groups", "token_ttl": "5m", "token_max_ttl": "15m"}'
  api "$T" POST "${P}identity/entity-alias" "$(jq -n --arg c "$E_TEUN" --arg a "$JWT_ACC" '{name: "teun", canonical_id: $c, mount_accessor: $a}')"
  kt=$(person_jwt teun)
  api - POST "${P}auth/jwt/login" "$(J="$kt" jq -n '{role: "person", jwt: env.J}')"
  TT=$(jq -r '.auth.client_token // empty' <<<"$BODY")
  row P26 Q6 "Teun's Keycloak token logs in to Vault as entity teun" "entity teun" "HTTP $ST; entity $( [ "$(jq -r '.auth.entity_id' <<<"$BODY")" = "$E_TEUN" ] && echo teun || echo other); policies $(jq -c '.auth.identity_policies // []' <<<"$BODY"); ttl $(jq -r '.auth.lease_duration' <<<"$BODY")s" "$(yes_if '[ -n "$TT" ]')"
  # Vault's identity OIDC mints the delegation token (ES256, act, RAR).
  api "$T" POST "${P}identity/oidc/key/probe-key" '{"algorithm": "ES256", "allowed_client_ids": ["*"], "rotation_period": "24h", "verification_ttl": "24h"}'
  # Placeholders are unquoted: Vault substitutes them as JSON values.
  tmpl() { printf '{"user": {{identity.entity.name}}, "jti": {{time.now}}, "act": {"sub": "tide-agent"}, "authorization_details": [{"type": "vault:path_access", "path": "%s", "capabilities": ["read"]}]}' "$1"; }
  api "$T" POST "${P}identity/oidc/role/obo-rebook" "$(jq -n --arg t "$(tmpl kv/data/permits/rebook/day1-1100)" '{key: "probe-key", ttl: "5m", template: $t}')"
  row P27 Q6 "identity/oidc role with act + authorization_details in its template" 204 "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[[ "$ST" =~ ^20 ]]')"
  api "$T" POST "${P}identity/oidc/role/obo-cancel" "$(jq -n --arg t "$(tmpl kv/data/permits/cancel/day1-1100)" '{key: "probe-key", ttl: "5m", template: $t}')"
  CIDS=()
  for r in obo-rebook obo-cancel; do api "$T" GET "${P}identity/oidc/role/$r"; CIDS+=("$(jq -r '.data.client_id' <<<"$BODY")"); done
  api "$TT" GET "${P}identity/oidc/token/obo-rebook"
  OBO=$(jq -r '.data.token // empty' <<<"$BODY")
  claims=$(cut -d. -f2 <<<"$OBO" | tr '_-' '/+' | awk '{ while (length($0) % 4) $0 = $0 "="; print }' | base64 -d 2>/dev/null)
  hdr=$(cut -d. -f1 <<<"$OBO" | tr '_-' '/+' | awk '{ while (length($0) % 4) $0 = $0 "="; print }' | base64 -d 2>/dev/null)
  ISS=$(jq -r '.iss' <<<"$claims")
  row P28 Q6 "Teun's own token asks Vault for the delegation token" "a JWT" "HTTP $ST; header $(jq -c '{alg, typ}' <<<"$hdr"); claims $(jq -c '{iss, aud, user, act, authorization_details, has_jti: (has("jti")), ttl: (.exp - .iat)}' <<<"$claims")" "$(yes_if '[ -n "$OBO" ]')"
  # The profile trusts Vault's own key (static, from the keys endpoint).
  curl -sS --cacert "$VAULT_CACERT" "$ACTIVE/v1/$NS/identity/oidc/.well-known/keys" >"$WORK/jwks.json"
  node -e 'const c=require("node:crypto");const k=JSON.parse(require("node:fs").readFileSync(process.argv[1])).keys;for(const j of k.filter(x=>x.kty==="EC"))process.stdout.write(JSON.stringify({key_id:j.kid,pem:c.createPublicKey({key:j,format:"jwk"}).export({type:"spki",format:"pem"})})+"\n")' "$WORK/jwks.json" | jq -s . >"$WORK/pubs.json"
  prof=$(jq -n --arg iss "$ISS" --slurpfile pk "$WORK/pubs.json" --argjson aud "$(printf '%s\n' "${CIDS[@]}" | jq -R . | jq -s .)" '{issuer_id: $iss, use_jwks: false, public_keys: $pk[0], audiences: $aud, supported_algorithms: ["ES256"], user_claim: "user", actor_claim: "act.sub"}')
  api "$T" POST "${P}sys/config/oauth-resource-server/vault-obo" "$prof"
  row P29 Q6 "OAuth resource server profile trusting Vault's own identity issuer" 200 "HTTP $ST${ERR:+: $ERR}; warnings $(jq -c '.warnings // []' <<<"$BODY")" "$(yes_if '[[ "$ST" =~ ^20 ]]')"
  api "$T" GET "${P}sys/config/oauth-resource-server/vault-obo"
  note "Profile read: $(jq -c '.data | {issuer_id, user_claim, actor_claim, unique_id_claim, jwt_type, optional_authorization_details}' <<<"$BODY")."
  for who in "teun:$E_TEUN" "tide-agent:$E_AGENT"; do
    api "$T" POST "${P}identity/entity-alias" "$(jq -n --arg n "${who%%:*}" --arg c "${who#*:}" '{name: $n, canonical_id: $c, profile_name: "vault-obo", external_id: $n}')"
  done
  api "$T" POST "${P}agent-registry/register" "$(jq -n --arg e "$E_AGENT" '{display_name: "tide-agent", entity_id: $e, owner: "bookings", ceiling_policies: ["p-agent-ceiling"]}')"
  row P30 Q6 "agent-registry: tide-agent with ceiling p-agent-ceiling" 200 "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[[ "$ST" =~ ^20 ]]')"
  api "$OBO" GET "${P}kv/data/permits/rebook/day1-1100"
  row P31 Q6 "a Vault identity token as the delegation token (no typ header)" "recorded (a finding: Vault does not take it for an OAuth JWT)" "HTTP $ST${ERR:+: $ERR}" yes
  OBO_ST=$ST
  if [ "$ST" != 200 ]; then
    aud=$(for n in vault_1 vault_2 vault_3; do podman exec "vult-$n" sh -c 'grep -h "permits/rebook" /vault/audit/audit.log 2>/dev/null | tail -1'; done | jq -c 'select(.type == "response") | {error, auth_display_name: .auth.display_name}' 2>/dev/null | tail -1)
    note "Q6: a Vault identity token (no typ header) is not taken for an OAuth JWT: the refused read's audit entry has no auth block: ${aud:-none}. Only one profile may name an issuer (duplicate issuer_id refused)."
    # Variant: the booking app as issuer, its key in Vault Transit (not exportable).
    api "$T" POST "${P}sys/mounts/transit" '{"type": "transit"}'
    api "$T" POST "${P}transit/keys/obo" '{"type": "ecdsa-p256", "exportable": false}'
    api "$T" GET "${P}transit/keys/obo"
    jq -r '.data.keys["1"].public_key' <<<"$BODY" >"$WORK/obo.pub.pem"
    TISS="https://booking.tidewell.example"
    api "$T" POST "${P}sys/config/oauth-resource-server/booking-obo" "$(jq -n --arg iss "$TISS" --rawfile pem "$WORK/obo.pub.pem" '{issuer_id: $iss, use_jwks: false, public_keys: [{key_id: "obo-1", pem: $pem}], audiences: ["https://vault.tidewell.example"], supported_algorithms: ["ES256"], user_claim: "sub", actor_claim: "act.sub"}')"
    tp_st=$ST tp_err=$ERR
    for who in "teun:$E_TEUN" "tide-agent:$E_AGENT"; do
      api "$T" POST "${P}identity/entity-alias" "$(jq -n --arg n "${who%%:*}" --arg c "${who#*:}" '{name: $n, canonical_id: $c, profile_name: "booking-obo", external_id: $n}')"
    done
    b64u() { base64 | tr -d '=\n' | tr '/+' '_-'; }
    sign() { # <rar path>: a JWT signed by Transit (jws marshaling = raw r||s)
      local h c in sig now
      now=$(date +%s)
      h=$(jq -cn '{alg: "ES256", typ: "at+jwt", kid: "obo-1"}' | b64u)
      c=$(jq -cn --arg iss "$TISS" --arg p "$1" --argjson now "$now" --arg jti "$(uuidgen)" '{iss: $iss, aud: "https://vault.tidewell.example", sub: "teun", act: {sub: "tide-agent"}, jti: $jti, iat: $now, exp: ($now + 300), authorization_details: [{type: "vault:path_access", path: $p, capabilities: ["read"]}]}' | b64u)
      in=$(printf '%s.%s' "$h" "$c" | base64 | tr -d '\n')
      api "$T" POST "${P}transit/sign/obo" "$(jq -n --arg i "$in" '{input: $i, hash_algorithm: "sha2-256", marshaling_algorithm: "jws"}')"
      sig=$(jq -r '.data.signature' <<<"$BODY" | sed 's/^vault:v1://')
      printf '%s.%s.%s' "$h" "$c" "$sig"
    }
    OBO=$(sign kv/data/permits/rebook/day1-1100)
    api "$OBO" GET "${P}kv/data/permits/rebook/day1-1100"
    row P31b Q6 "variant: the booking app as issuer, key in Vault Transit, typ at+jwt" 200 "profile HTTP $tp_st${tp_err:+: $tp_err}; rebook read HTTP $ST${ERR:+: $ERR}" "$(yes_if '[ "$ST" = 200 ]')"
    if [ "$ST" = 200 ]; then
      OBO_ST=200
      OBO2=$(sign kv/data/permits/cancel/day1-1100)
      api "$OBO2" GET "${P}kv/data/permits/cancel/day1-1100"
      row P33b Q6 "variant: a Transit-signed cancel token for the agent" "refused by the ceiling" "HTTP $ST: $ERR" "$(yes_if '[ "$ST" = 403 ]')"
    fi
  fi
  api "$OBO" GET "${P}kv/data/permits/cancel/day1-1100"
  row P32 Q6 "the same token on the cancel permit (RAR does not match)" refused "HTTP $ST: $ERR" "$(yes_if '[ "$ST" = 403 ]')"
  api "$TT" GET "${P}identity/oidc/token/obo-cancel"
  OBO2=$(jq -r '.data.token // empty' <<<"$BODY")
  api "$OBO2" GET "${P}kv/data/permits/cancel/day1-1100"
  row P33 Q6 "a cancel token for the agent (Teun allows, the ceiling does not)" "refused by the ceiling" "HTTP $ST: $ERR" "$(yes_if '[ "$ST" = 403 ]')"
  # Keycloak's own token exchange (the alternative issuer).
  kx=$(S="$kt" jq -rn '@uri "grant_type=urn:ietf:params:oauth:grant-type:token-exchange&client_id=tidewell-cli&subject_token=\(env.S)&subject_token_type=urn:ietf:params:oauth:token-type:access_token&requested_token_type=urn:ietf:params:oauth:token-type:access_token"' |
    curl -sS --cacert "$VAULT_CACERT" "$KC/realms/tidewell/protocol/openid-connect/token" --data-binary @- | jq -c '{error, error_description, has_token: has("access_token")}')
  row P34 Q6 "Keycloak token exchange as the delegation issuer (public client)" recorded "$kx" yes
  [ "$OBO_ST" = 200 ] && note "Q6 answered: a delegation token works when the booking app signs it with a non-exportable Vault Transit key (typ at+jwt); no signing key exists outside Vault." || note "Q6: no delegation token authenticated; fall back to vault_identity's issuer key (a residual)."
  unset TT OBO OBO2 kt
fi

# ── Q7: client authentication without a standing secret ─────────────────────
if want Q7; then
  [ -n "${KAT:-}" ] || kc_admin
  kcapi GET "/tidewell/authentication/client-authenticator-providers"
  row P35 Q7 "Keycloak's client authenticators" recorded "$(jq -c '[.[].id]' <<<"$KBODY" 2>/dev/null)" yes
  note "Q7: Keycloak 26.8 also lists federated-jwt: a client may authenticate with a JWT from a trusted issuer; a Vault identity token (short-lived, from the app's own Vault login) could replace the booking client secret. client-x509 (mTLS with a Vault PKI certificate) needs Keycloak restarted with Vault's issuing CA in its truststore and HTTPS client auth on; that is built and measured in prompt 07. Until proven there, the booking client secret stays a residual."
fi

# ── Q8: Secrets Sync over a hand-made copy with the same name ───────────────
if want Q8; then
  [ -s "$PEM" ] || die "probe: no GitHub App key in .secrets/github/ (make github-key)"
  api "$T" PUT sys/activation-flags/secrets-sync/activate '{}'
  api "$T" POST sys/mounts/probe-kv '{"type": "kv", "options": {"version": "2"}}'
  api "$T" POST "probe-kv/data/$KVS" '{"data": {"value": "vault-probe-demo-0001"}}'
  printf '%s' "hand-probe-demo-0000" | gh secret set "$GH_NAME" -R "$OWNER/$REPO" >/dev/null
  before=$(gh_secrets | jq -r --arg n "$GH_NAME" '.[] | select(.name == $n) | .updatedAt')
  api "$T" POST "sys/sync/github-apps/$APP" "$(jq -n --arg id "$APP_ID" --rawfile k "$PEM" '{app_id: ($id | tonumber), private_key: $k}')"
  api "$T" POST "sys/sync/destinations/gh/$GH_DEST" "$(jq -n --arg a "$APP" --arg i "$INSTALL" --arg o "$OWNER" --arg r "$REPO" \
    '{app_name: $a, installation_id: ($i | tonumber), repository_owner: $o, repository_name: $r, secret_name_template: "PROBE_{{ .SecretPath | uppercase }}_{{ .SecretKey | uppercase }}"}')"
  row P36 Q8 "gh destination through the app on vault_ultimate" 200 "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[[ "$ST" =~ ^20 ]]')"
  # The template turns e<epoch>-hand into PROBE_E<epoch>_HAND_VALUE: the hand copy's name.
  sleep 2
  api "$T" POST "sys/sync/destinations/gh/$GH_DEST/associations/set" "$(jq -n --arg s "$KVS" '{mount: "probe-kv", secret_name: $s}')"
  set_st=$ST set_err=$ERR
  sleep 4
  api "$T" GET "sys/sync/destinations/gh/$GH_DEST/associations"
  status=$(jq -r '[.data.associated_secrets // {} | to_entries[] | .value.sync_status] | first // "absent"' <<<"$BODY")
  names=$(gh_secrets | jq -c --arg e "$EPOCH" '[.[] | select(.name | contains($e)) | {name, updatedAt}]')
  row P37 Q8 "associate under the hand-made GitHub secret's name" recorded "set HTTP $set_st${set_err:+: $set_err}; status $status; GitHub: $names (hand copy updatedAt $before)" yes
  # LocalStack: a hand-made secret, then a destination whose template gives that name.
  aws_sm CreateSecret "$(jq -n --arg n "$AWS_NAME" --arg t "$(uuidgen)" '{Name: $n, SecretString: "hand-probe-demo-0000", ClientRequestToken: $t}')"
  api "$T" POST "sys/sync/destinations/aws-sm/$AWS_DEST" "$(jq -n --arg r "$REGION" --arg ip "$LS_IP/32" \
    '{access_key_id: "test", secret_access_key: "test", region: $r, allowed_ipv4_addresses: [$ip], allowed_ports: [4566], secret_name_template: "{{ .SecretPath }}", granularity: "secret-path"}')"
  row P38a Q8 "aws-sm destination, template {{ .SecretPath }} (a constant name is refused)" 200 "HTTP $ST${ERR:+: $ERR}" "$(yes_if '[[ "$ST" =~ ^20 ]]')"
  api "$T" POST "probe-kv/data/$AWS_NAME" '{"data": {"value": "vault-probe-demo-0002"}}'
  api "$T" POST "sys/sync/destinations/aws-sm/$AWS_DEST/associations/set" "$(jq -n --arg s "$AWS_NAME" '{mount: "probe-kv", secret_name: $s}')"
  set_st=$ST set_err=$ERR
  sleep 4
  api "$T" GET "sys/sync/destinations/aws-sm/$AWS_DEST/associations"
  status=$(jq -r '[.data.associated_secrets // {} | to_entries[] | .value.sync_status] | first // "absent"' <<<"$BODY")
  serr=$(jq -r '[.data.associated_secrets // {} | to_entries[] | .value.sync_error // empty] | first // ""' <<<"$BODY")
  aws_sm GetSecretValue "$(jq -n --arg n "$AWS_NAME" '{SecretId: $n}')"
  now=$(jq -r '.SecretString // empty' <<<"$ABODY")
  aws_sm DescribeSecret "$(jq -n --arg n "$AWS_NAME" '{SecretId: $n}')"
  row P38 Q8 "associate over a hand-made LocalStack secret of the same name" recorded "set HTTP $set_st${set_err:+: $set_err}; status $status${serr:+ ($serr)}; value now fp $(fp "$now") (hand fp $(fp hand-probe-demo-0000), Vault fp $(fp '{"value":"vault-probe-demo-0002"}')); tags $(jq -c '[.Tags[]?.Key]' <<<"$ABODY")" yes
fi

# ── Q9: does LocalStack check access keys? ───────────────────────────────────
if want Q9; then
  aws_sm ListSecrets '{"MaxResults": 1}' "AKIAPROBEREVOKED000$EPOCH"
  row P39 Q9 "LocalStack ListSecrets with an access key that was never issued" "recorded (D12: 200 means no IAM enforcement)" "HTTP $AST $(jq -r '.__type // empty' <<<"$ABODY")" yes
  [ "$AST" = 200 ] && note "Q9: LocalStack accepts any access key on this token: it is a place (a copy, a Sync target), never a credential test (D12 holds)."
fi

# ── Q10: Ollama under D8's limits ────────────────────────────────────────────
if want Q10; then
  models="$(vult_conf VULT_OLLAMA_MODEL) $(vult_conf VULT_OLLAMA_CANDIDATES)"
  # shellcheck disable=SC2086  # the model list is meant to split
  podman run --rm --name vult-probe_ollama --network vult-internal -v "$VULT_ROOT/scripts/probe-ollama.mjs:/p.mjs:ro" \
    "$(vult_conf NODE_IMAGE)" node /p.mjs $models >"$WORK/ollama.json" 2>/dev/null || echo '{}' >"$WORK/ollama.json"
  for m in $models; do
    r=$(jq -c --arg m "$m" '.[$m] // {error: "no answer"}' "$WORK/ollama.json")
    ok=$(jq -r 'if .error then "no" elif .warm_first_token_ms < 3000 then "yes" else "no" end' <<<"$r")
    row P40 Q10 "Ollama $m, 4 CPUs, 6 GiB (3 warm runs)" "first token under 3 s warm" "$r" "$([ "$m" = "$(vult_conf VULT_OLLAMA_MODEL)" ] && echo "$ok" || echo yes)"
  done
  mkdir -p "$BUILD_DIR/probe" && cp "$WORK/ollama.json" "$BUILD_DIR/probe/ollama.json"
fi

# ── Q11 and Q12 are answered by the rows above and the policy design ────────
note "Q11: the capabilities each step needs are the rows above (database creds, wrapped secret-id, pki issue and revoke, ldap static-cred and rotate-role, identity/oidc/token, kv read under RAR) plus the bootstrap policies in vault/policies/bootstrap/; make boundary proves them per token."
note "Q12: every refusal above is quoted verbatim in its row."

# ── Write the results ────────────────────────────────────────────────────────
mkdir -p "$BUILD_DIR/probe"
jq -n --argjson pass "$pass" --argjson fail "$fail" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson seconds "$(($(date +%s) - started))" --arg only "${ONLY:-all}" \
  '{pass: $pass, fail: $fail, at: $at, seconds: $seconds, questions: $only}' >"$BUILD_DIR/probe/results.json"
if [ -z "${ONLY:-}" ]; then
  {
    echo '<!-- Generated by make probe. The table and the notes quote Vault, Keycloak,'
    echo '     PostgreSQL, OpenLDAP, GitHub and LocalStack verbatim (long lines, JSON). -->'
    echo '<!-- markdownlint-disable MD004 MD013 MD033 MD034 MD037 MD060 -->'
    echo
    echo '# Capabilities (measured)'
    echo
    echo "Measured by \`make probe\` on $(date -u +%Y-%m-%d) against Vault $(curl -sS --cacert "$VAULT_CACERT" "$ACTIVE/v1/sys/seal-status" | jq -r .version), in a scratch namespace that the run removed. $pass rows match, $fail do not. Questions are the brief's (\`prompts/00_brief.md\`)."
    echo
    echo '| Case | Question | Call | Expected | Answer | Match |'
    echo '| --- | --- | --- | --- | --- | --- |'
    cat "$ROWS"
    echo
    echo '## Notes'
    echo
    cat "$NOTES"
  } >"$OUT"
fi
echo "probe: $pass match, $fail differ, $(($(date +%s) - started))s${ONLY:+ (ONLY=$ONLY)}"
[ "$fail" -eq 0 ]
