#!/usr/bin/env bash
# scripts/rehearsal.sh (make rehearsal): the four acts through the console
# (https, the lab CA, signed in as saskia on the form's API), each checked
# against what Vault, LocalStack and GitHub (gh, names and times only) say:
# import, push to both destinations, rotate and watch both copies follow,
# remove and see both copies gone. Then every way it must fail: no session,
# a step outside the allowlist, a path in the body, a foreign origin, a
# sign-in as someone else, Saskia's own token on a value she may not read, a
# destination's configuration, the GitHub App and a policy; and no value,
# token or key in any answer, event or log line. Starts and ends with make
# stage-reset. Never prints a token, password or value.
set -euo pipefail
# shellcheck source=scripts/common.sh
source "$(dirname -- "$0")/common.sh"
cd "$VULT_ROOT"
t_start=$(date +%s)
BASE="https://localhost:$(vult_conf VULT_PORT_WEB)"
NS=$(vult_conf VULT_NAMESPACE)
WORK=$(mktemp -d)
JAR="$WORK/jar"
ANSWERS="$WORK/answers"
mkdir -p "$ANSWERS"
trap 'rm -rf "$WORK"' EXIT
pass=0
fail=0
row() { # <id> <label> <yes|no> <detail>
  if [ "$3" = yes ]; then pass=$((pass + 1)); printf '  \033[32mPASS\033[0m %-4s %-66s %s\n' "$1" "$2" "$(cut -c1-90 <<<"$4")"
  else fail=$((fail + 1)); printf '  \033[31mFAIL\033[0m %-4s %-66s %s\n' "$1" "$2" "$(cut -c1-220 <<<"$4")"; fi
}
# api <METHOD> <path> [body] [extra curl args...]: body in $WORK/out (and kept
# for the leak check), the status echoed.
api() {
  local m=$1 p=$2 b=${3:-}
  shift 3 2>/dev/null || shift $#
  st=$(curl -sS -o "$WORK/out" -w '%{http_code}' -b "$JAR" -c "$JAR" --cacert vault-tls/ca-chain.pem -X "$m" \
    ${b:+-H 'content-type: application/json' -d "$b"} "$@" "$BASE$p" || echo 000)
  cp "$WORK/out" "$(mktemp "$ANSWERS/a.XXXXXX")" # unique: api also runs in subshells
  echo "$st"
}
is() { [ "$1" = "$2" ] && echo yes || echo no; }
jqt() { jq -e "$1" "$WORK/out" >/dev/null 2>&1 && echo yes || echo no; }
src() { api GET /api/sources >/dev/null; jq -c --arg k "$1" ".secrets[] | select(.kv_name == \$k) | $2" "$WORK/out"; }
srcis() { [ "$(src "$1" "$2")" = true ] && echo yes || echo no; } # <kv> <jq test> -> yes|no
# wait_for <tries> <jq on /api/sources>: poll until true.
wait_for() {
  local i
  for ((i = 0; i < $1; i++)); do
    api GET /api/sources >/dev/null
    jq -e "$2" "$WORK/out" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}
SECRET=$(jq -r .sync.secret config/story.json)
GHNAME="TIDEWELL_$(tr '/a-z-' '_A-Z_' <<<"$SECRET")_VALUE"
gh_at() { ./scripts/github-evidence.sh >/dev/null && jq -r --arg n "$GHNAME" '.secrets[] | select(.name == $n) | .updated_at' .build/github/evidence.json; }

echo "rehearsal: a fresh stage"
CONFIRM=yes ./scripts/stage-reset.sh >/dev/null

# ── Sign in through the console ───────────────────────────────────────────────
st=$(jq -n --rawfile p .secrets/people/saskia '{username: "saskia", password: ($p | rtrimstr("\n"))}' |
  curl -sS -o "$WORK/out" -w '%{http_code}' -c "$JAR" --cacert vault-tls/ca-chain.pem -H 'content-type: application/json' --data @- "$BASE/api/session")
row R0 "saskia signs in through the console form's API" "$(is "$st" 200)" "HTTP $st"
st=$(api GET /api/session)
row R0 "her session holds vult-presenter" "$(jqt '.policies | index("vult-presenter")')" "$(jq -c .policies "$WORK/out")"

# ── Act 1: bring them home ────────────────────────────────────────────────────
st=$(api POST /api/acts/out/github)
row A1 "pushing before the import is refused" "$(is "$st" 409)" "HTTP $st $(jq -r .error "$WORK/out")"
st=$(api POST /api/acts/home/plan)
row A1 "the import plan lists the three legacy secrets" "$([ "$st" = 200 ] && jq -e '.event.ok and (.event.output | test("tidewell-legacy/delivery-api") and test("tidewell-legacy/label-printer") and test("tidewell-legacy/smtp-relay"))' "$WORK/out" >/dev/null && echo yes || echo no)" "HTTP $st $(jq -r '.event.summary // .error' "$WORK/out")"
api GET /api/sources >/dev/null
row A1 "the plan wrote nothing" "$(jqt '[.secrets[].vault.exists] | all(. == false)')" "$(jq -c '[.secrets[].vault.exists]' "$WORK/out")"
st=$(api POST /api/acts/home/apply)
row A1 "the import writes all three" "$([ "$st" = 200 ] && jqt '.event.ok')" "HTTP $st $(jq -r '.event.summary // .error' "$WORK/out")"
api GET /api/sources >/dev/null
row A1 "each is version 1 with Import's labels and the legacy tags" "$(jqt '[.secrets[].vault | .current_version == 1 and .labels["import-source"] == "aws-sm" and .labels.operation == "import" and (.labels.owner | length > 0)] | all')" "$(jq -c '[.secrets[].vault.current_version]' "$WORK/out")"
row A1 "Vault holds the legacy value (fingerprints equal)" "$(jqt '[.secrets[] | .vault.fingerprint == .legacy.fingerprint and .vault.fingerprint != null] | all')" "$(jq -c '[.secrets[] | .vault.fingerprint]' "$WORK/out")"
st=$(api POST /api/acts/home/apply)
row A1 "a second import is refused (it would write version 2)" "$(is "$st" 409)" "HTTP $st"

# ── Act 2: send them out ──────────────────────────────────────────────────────
st=$(api POST /api/acts/out/localstack)
row A2 "push $SECRET to the AWS copy" "$([ "$st" = 200 ] && jqt '.event.ok')" "HTTP $st $(jq -r '.event.summary // .error' "$WORK/out")"
st=$(api POST /api/acts/out/github)
row A2 "push $SECRET to GitHub Actions" "$([ "$st" = 200 ] && jqt '.event.ok')" "HTTP $st $(jq -r '.event.summary // .error' "$WORK/out")"
ok=no
for _ in $(seq 1 20); do
  api GET /api/sync >/dev/null
  jq -e --arg s "$SECRET" '[.destinations[].associations[] | select(.secret_name == $s) | .sync_status] == ["SYNCED", "SYNCED"]' "$WORK/out" >/dev/null && { ok=yes; break; }
  sleep 2
done
row A2 "Vault reports both SYNCED" "$ok" "$(jq -c '[.destinations[].associations[] | .sync_status]' "$WORK/out")"
wait_for 15 ".secrets[] | select(.kv_name == \"$SECRET\") | .localstack_copy.fingerprint == .vault.fingerprint" && ok=yes || ok=no
row A2 "the AWS copy holds Vault's value (fingerprint)" "$ok" "$(src "$SECRET" '.localstack_copy')"
row A2 "the AWS copy is named by the template" "$(srcis "$SECRET" ".localstack_copy.name == \"vault/tidewell/$SECRET\"")" "$(src "$SECRET" '.localstack_copy.name')"
gh1=$(gh_at)
row A2 "GitHub lists $GHNAME (gh secret list)" "$([ -n "$gh1" ] && echo yes || echo no)" "updated ${gh1:-never}"
row A2 "the console shows GitHub's record as present" "$(srcis "$SECRET" '.github.state == "present"')" "$(src "$SECRET" '.github.state')"

# ── Act 3: change once ────────────────────────────────────────────────────────
before=$(src "$SECRET" '.vault.fingerprint')
sleep 1
st=$(api POST /api/acts/change/rotate)
row A3 "rotate $SECRET (a value generated in the API)" "$([ "$st" = 200 ] && jqt '.event.ok and (.event.summary | test("version 2"))')" "HTTP $st $(jq -r '.event.summary // .error' "$WORK/out")"
after=$(src "$SECRET" '.vault.fingerprint')
row A3 "Vault's fingerprint changed, labelled by saskia" "$([ "$after" != "$before" ] && [ "$(src "$SECRET" '.vault.labels.rotated_by')" = '"saskia"' ] && echo yes || echo no)" "$before -> $after"
t0=$(date +%s)
wait_for 20 ".secrets[] | select(.kv_name == \"$SECRET\") | .localstack_copy.fingerprint == .vault.fingerprint" && ok=yes || ok=no
row A3 "the AWS copy follows" "$ok" "$(src "$SECRET" '.localstack_copy.fingerprint') after $(($(date +%s) - t0)) s"
row A3 "GitHub's old record is now stale in the console" "$(srcis "$SECRET" '.github.state == "stale"')" "$(src "$SECRET" '.github.state')"
gh2=$gh1
for _ in $(seq 1 15); do
  gh2=$(gh_at)
  [ -n "$gh2" ] && [ "$gh2" != "$gh1" ] && break
  sleep 2
done
row A3 "GitHub's own update time moved" "$([ -n "$gh2" ] && [ "$gh2" != "$gh1" ] && echo yes || echo no)" "$gh1 -> $gh2 ($(($(date +%s) - t0)) s)"
row A3 "fresh evidence is present again" "$(srcis "$SECRET" '.github.state == "present"')" "$(src "$SECRET" '.github.state')"
row A3 "the other secrets did not move" "$(api GET /api/sources >/dev/null; jqt "[.secrets[] | select(.kv_name != \"$SECRET\") | .vault.current_version] | all(. == 1)")" ""

# ── Act 4: let go ─────────────────────────────────────────────────────────────
for d in localstack github; do
  st=$(api POST "/api/acts/letgo/$d")
  row A4 "remove the $d association" "$([ "$st" = 200 ] && jqt '.event.ok')" "HTTP $st $(jq -r '.event.summary // .error' "$WORK/out")"
done
wait_for 20 ".secrets[] | select(.kv_name == \"$SECRET\") | .localstack_copy.exists == false" && ok=yes || ok=no
row A4 "Vault deleted the AWS copy" "$ok" "$(src "$SECRET" '.localstack_copy.exists')"
gone=no
for _ in $(seq 1 15); do
  [ -z "$(gh_at)" ] && { gone=yes; break; }
  sleep 2
done
row A4 "Vault deleted the GitHub secret (gh secret list)" "$gone" ""
row A4 "Vault still holds the secret (version 2)" "$(srcis "$SECRET" '.vault.current_version == 2')" "$(src "$SECRET" '.vault.current_version')"
st=$(api GET /api/events)
row A4 "every step that ran is an event: saskia, a correlation id (refusals are answers, not events)" "$(jqt '(.events | length) >= 7 and ([.events[] | .who == "saskia" and (.id | test("^vult-"))] | all)')" "$(jq '.events | length' "$WORK/out") events"

# ── Every way it must fail ────────────────────────────────────────────────────
st=$(api POST /api/acts/home/destroy)
row N1 "a step outside the allowlist" "$(is "$st" 404)" "HTTP $st"
st=$(api POST /api/acts/out/github '{"secret_name":"parcel/smtp-relay","mount":"kv"}')
row N2 "a step with a path in the body" "$(is "$st" 400)" "HTTP $st $(jq -r .error "$WORK/out")"
st=$(api POST /api/acts/change/rotate "" -H "Origin: https://localhost:9999")
row N3 "a write from a foreign origin" "$(is "$st" 403)" "HTTP $st"
st=$(api POST /api/acts/change/rotate "" -H "Sec-Fetch-Site: cross-site")
row N3 "a write marked cross-site" "$(is "$st" 403)" "HTTP $st"
st=$(api POST /api/session '{"username":"mallory","password":"not-a-real-password"}')
row N4 "a sign-in as someone else" "$(is "$st" 403)" "HTTP $st"
st=$(api POST /api/session/end)
row N5 "sign out" "$(is "$st" 200)" "HTTP $st"
for p in /api/sources /api/sync /api/events /api/story; do
  st=$(api GET "$p")
  row N5 "$p without a session" "$(is "$st" 401)" "HTTP $st"
done
st=$(api POST /api/acts/change/rotate)
row N5 "a step without a session" "$(is "$st" 401)" "HTTP $st"

# Saskia's own token, straight at Vault: what the API could never do for her.
vault_cluster
person_login saskia
tok=$VAULT_TOKEN
unset VAULT_TOKEN
vault_as() { # <METHOD> <path> [body]
  vcurl "$tok" -sS -o "$WORK/vault" -w '%{http_code}' --cacert "$VAULT_CACERT" -X "$1" ${3:+-d "$3"} "$VAULT_ADDR/v1/$NS/$2" || echo 000
}
st=$(vault_as GET kv/data/parcel/smtp-relay)
row N6 "Saskia reads a secret she does not sync" "$(is "$st" 403)" "HTTP $st $(jq -r '.errors[0]' "$WORK/vault" 2>/dev/null)"
st=$(vault_as POST sys/sync/destinations/gh/tidewell-github '{"repository_name":"other"}')
row N6 "Saskia changes a destination's configuration" "$(is "$st" 403)" "HTTP $st"
st=$(vault_as GET "sys/sync/github-apps/$(vult_conf VULT_GITHUB_APP_NAME)")
row N6 "Saskia reads the GitHub App" "$(is "$st" 403)" "HTTP $st"
st=$(vault_as PUT sys/policies/acl/vult-presenter '{"policy":"path \"*\" { capabilities = [\"sudo\"] }"}')
row N6 "Saskia rewrites her own policy" "$(is "$st" 403)" "HTTP $st"
st=$(vault_as POST sys/sync/destinations/gh/tidewell-github/associations/set '{"mount":"kv","secret_name":"parcel/smtp-relay"}')
row N6 "Saskia pushes a secret she may not read" "$(is "$st" 403)" "HTTP $st $(jq -r '.errors[0]' "$WORK/vault" 2>/dev/null | cut -c1-60)"
vcurl "$tok" -sS -o /dev/null --cacert "$VAULT_CACERT" -X POST "$VAULT_ADDR/v1/$NS/auth/token/revoke-self" || true
unset tok

# No value, token or key anywhere: every answer this run got, the API's and
# web's logs. Known values are compared in memory, never printed.
podman logs --since 15m vult-api >"$WORK/api.log" 2>&1 || true
podman logs --since 15m vult-web >"$WORK/web.log" 2>&1 || true
leaks=0
while IFS= read -r v; do
  grep -rqF -- "$v" "$ANSWERS" "$WORK/api.log" "$WORK/web.log" && leaks=$((leaks + 1))
done < <(jq -r '.legacy[].value' config/story.json; tr -d '\n' <.secrets/people/saskia; echo)
grep -rqE 'tidewell-rotated-demo-[0-9a-f]{24}|hv[sbr]\.[A-Za-z0-9_-]{20,}|PRIVATE KEY' "$ANSWERS" "$WORK/api.log" "$WORK/web.log" && leaks=$((leaks + 1))
row N7 "no value, password, token or key in $(find "$ANSWERS" -type f | wc -l | tr -d ' ') answers or the logs" "$(is "$leaks" 0)" "$leaks finding(s)"

echo "rehearsal: a fresh stage again"
CONFIRM=yes ./scripts/stage-reset.sh >/dev/null
gone=$([ -z "$(gh_at)" ] && echo yes || echo no)
row Z "the stage is back: nothing synced, nothing imported" "$([ "$gone" = yes ] && jq -e '.imported == [] and ([.associations[]] | all(. == 0))' .build/stage/stage.json >/dev/null && echo yes || echo no)" "$(jq -c . .build/stage/stage.json | cut -c1-120)"

took=$(($(date +%s) - t_start))
mkdir -p "$BUILD_DIR/gates"
jq -n --argjson pass "$pass" --argjson fail "$fail" --argjson s "$took" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{gate: "rehearsal", pass: $pass, fail: $fail, seconds: $s, at: $at}' >"$BUILD_DIR/gates/rehearsal.json"
echo "rehearsal: $pass passed, $fail failed in ${took}s"
[ "$fail" -eq 0 ]
