#!/usr/bin/env bash
# scripts/probe-lib.sh: helpers for scripts/probe.sh. Source, do not execute.
# api <token|-> <METHOD> <path> [json body] [extra header]: sets ST (HTTP
# status), BODY (response) and ERR (Vault's errors[0], verbatim).
# Never prints a token.

# shellcheck disable=SC2034  # ST and ERR are read by the caller (probe.sh)
api() {
  local tok=$1 method=$2 path=$3 body=${4:-} hdr=${5:-} out args=()
  out=$(mktemp)
  args=(-sS -o "$out" -w '%{http_code}' --cacert "$VAULT_CACERT" -X "$method")
  [ -z "$hdr" ] || args+=(-H "$hdr")
  # The body goes through a file descriptor, never onto curl's command line:
  # some bodies carry a connection password or a private key.
  if [ -n "$body" ]; then
    ST=$(vcurl "$tok" "${args[@]}" -H 'Content-Type: application/json' --data-binary @<(printf '%s' "$body") "${PROBE_ADDR:-$VAULT_ADDR}/v1/$path" || echo 000)
  else
    ST=$(vcurl "$tok" "${args[@]}" "${PROBE_ADDR:-$VAULT_ADDR}/v1/$path" || echo 000)
  fi
  BODY=$(cat "$out")
  rm -f "$out"
  ERR=$(jq -r '.errors[0] // .data.error // empty' <<<"$BODY" 2>/dev/null | tr '\n\t' '  ' | tr -s ' ' | sed 's/ *$//' || true)
}

row() { # <case> <act> <call> <expected> <answer> <yes|no>
  printf '| %s | %s | `%s` | %s | %s | %s |\n' "$1" "$2" "$3" "$4" "$(tr '|\n\t' '/  ' <<<"$5" | cut -c1-220)" "$6" >>"$ROWS"
  if [ "$6" = yes ]; then
    pass=$((pass + 1))
    printf '  \033[32mPASS\033[0m %-4s %s (%s)\n' "$1" "$3" "$(cut -c1-110 <<<"$5")"
  else
    fail=$((fail + 1))
    printf '  \033[31mFAIL\033[0m %-4s %s (%s)\n' "$1" "$3" "$(cut -c1-160 <<<"$5")"
  fi
}
