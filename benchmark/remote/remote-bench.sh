#!/usr/bin/env bash

# ──────────────────────────────────────────────
#  Remote framework benchmark — diesel vs hono, over the real network
#
#  Runs a concurrency sweep against a VPS, one framework at a time, and
#  verifies the expected server is actually live before each run (both apps
#  report their name at GET /).
#
#  Same port for both (restart the server in between):
#    ./remote-bench.sh --host 139.99.91.212 --port 3000
#
#  Different ports (no restart needed):
#    ./remote-bench.sh --host 139.99.91.212 --diesel-port 3000 --hono-port 3001
# ──────────────────────────────────────────────

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"
K6_SCRIPT="${SCRIPT_DIR}/k6-http.js"

HOST=${HOST:-"139.99.91.212"}
DIESEL_PORT=""
HONO_PORT=""
PORT=${PORT:-3000}
CONNS=${CONNS:-"25 50 100 200 400"}
DURATION=${DURATION:-20s}
ROUTE=${ROUTE:-/user/123}
FRAMEWORKS=()
SKIP_BASELINE=0
WAIT_TIMEOUT=${WAIT_TIMEOUT:-300}

BOLD='\033[1m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; RED='\033[0;31m'; DIM='\033[2m'; RESET='\033[0m'

header()  { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════════════════${RESET}"
            echo -e "${BOLD}${CYAN}  $1${RESET}"
            echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${RESET}"; }
info()    { echo -e "${DIM}  $1${RESET}"; }
ok()      { echo -e "${GREEN}✔  $1${RESET}"; }
warn()    { echo -e "${YELLOW}⚠  $1${RESET}"; }
err()     { echo -e "${RED}✖  $1${RESET}"; }

usage() {
  cat <<USAGE
Usage: $0 [framework ...] [options]

  Frameworks : diesel  hono     (no args → both, diesel first)

  Options:
    --host        HOST   VPS address          (default: ${HOST})
    --port        N      port both apps use   (default: ${PORT})
    --diesel-port N      diesel's port        (overrides --port)
    --hono-port   N      hono's port          (overrides --port)
    --conns      "A B C" concurrency sweep    (default: ${CONNS})
    --duration    T      per-level duration   (default: ${DURATION})
    --route       PATH   route to hit, or "mix"  (default: ${ROUTE})
    --no-baseline        skip the 1-connection RTT baseline
    --wait-timeout N     seconds to wait for a server (default: ${WAIT_TIMEOUT})

  Results are written to ${RESULTS_DIR}/ and compared at the end.
USAGE
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)      usage ;;
    --host)         HOST="$2"; shift 2 ;;
    --port)         PORT="$2"; shift 2 ;;
    --diesel-port)  DIESEL_PORT="$2"; shift 2 ;;
    --hono-port)    HONO_PORT="$2"; shift 2 ;;
    --conns)        CONNS="$2"; shift 2 ;;
    --duration)     DURATION="$2"; shift 2 ;;
    --route)        ROUTE="$2"; shift 2 ;;
    --no-baseline)  SKIP_BASELINE=1; shift ;;
    --wait-timeout) WAIT_TIMEOUT="$2"; shift 2 ;;
    diesel|hono)    FRAMEWORKS+=("$1"); shift ;;
    *)              err "unknown argument: $1"; usage ;;
  esac
done

[ ${#FRAMEWORKS[@]} -eq 0 ] && FRAMEWORKS=("diesel" "hono")
[ -z "$DIESEL_PORT" ] && DIESEL_PORT="$PORT"
[ -z "$HONO_PORT" ] && HONO_PORT="$PORT"

port_for() { [ "$1" = "diesel" ] && echo "$DIESEL_PORT" || echo "$HONO_PORT"; }

# ── preflight ─────────────────────────────────
command -v k6 >/dev/null 2>&1 || { err "k6 not found — brew install k6"; exit 1; }
command -v curl >/dev/null 2>&1 || { err "curl not found"; exit 1; }
[ -f "$K6_SCRIPT" ] || { err "missing $K6_SCRIPT"; exit 1; }
mkdir -p "$RESULTS_DIR"

# the load generator needs a socket per connection, plus headroom
MAX_CONN=0
for c in $CONNS; do [ "$c" -gt "$MAX_CONN" ] && MAX_CONN=$c; done
FD_LIMIT=$(ulimit -n)
if [ "$FD_LIMIT" != "unlimited" ] && [ "$FD_LIMIT" -lt $((MAX_CONN * 4)) ]; then
  warn "ulimit -n is ${FD_LIMIT}, low for ${MAX_CONN} connections."
  warn "run:  ulimit -n $((MAX_CONN * 8))   (this shell only) before benchmarking"
fi

# ── wait until the expected framework answers ─
wait_for_framework() {
  local fw="$1" url="$2" waited=0 body=""

  body=$(curl -s --max-time 3 "$url/" 2>/dev/null || true)
  if [[ "$body" == *"\"framework\":\"$fw\""* ]]; then
    ok "$fw is live at $url"
    return 0
  fi

  echo ""
  if [ -z "$body" ]; then
    warn "nothing answering at $url"
  else
    warn "$url is answering, but not $fw:  ${body:0:100}"
  fi
  echo -e "${BOLD}  start $fw on the VPS:${RESET}"
  echo -e "      cd ~/diesel/benchmark && PORT=$(port_for "$fw") bun run src/${fw}.ts"
  echo -e "${DIM}  waiting up to ${WAIT_TIMEOUT}s — polling every 2s…${RESET}"

  while [ "$waited" -lt "$WAIT_TIMEOUT" ]; do
    sleep 2
    waited=$((waited + 2))
    body=$(curl -s --max-time 3 "$url/" 2>/dev/null || true)
    if [[ "$body" == *"\"framework\":\"$fw\""* ]]; then
      echo ""
      ok "$fw is live at $url (after ${waited}s)"
      return 0
    fi
    printf "."
  done

  echo ""
  err "$fw never came up at $url"
  return 1
}

# ── verify every route responds before loading it ──
verify_routes() {
  local url="$1" failed=0
  for path in "/" "/user/123" "/users/pradeep" "/user/123/post/456"; do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${url}${path}" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
      info "200  ${path}"
    else
      err "${code}  ${path}"
      failed=1
    fi
  done
  return $failed
}

run_k6() {
  local fw="$1" url="$2" mode="$3" vus="$4" dur="$5" out="$6"
  MODE="$mode" VUS="$vus" DURATION="$dur" TARGET="$url" \
  FRAMEWORK="$fw" ROUTE="$ROUTE" OUT="$out" \
    k6 run --quiet "$K6_SCRIPT"
  local code=$?
  # 99 = a threshold failed (e.g. errors crept in); the numbers are still valid
  if [ $code -eq 99 ]; then
    warn "thresholds failed for $fw (errors above 1%) — see 'failed' above"
  elif [ $code -ne 0 ]; then
    err "k6 exited with $code for $fw"
    return 1
  fi
  return 0
}

bench_framework() {
  local fw="$1"
  local port; port=$(port_for "$fw")
  local url="http://${HOST}:${port}"

  header "${fw}  →  ${url}"

  wait_for_framework "$fw" "$url" || return 1

  echo ""
  info "checking routes…"
  verify_routes "$url" || { err "some routes are broken on $fw — fix before benchmarking"; return 1; }

  if [ "$SKIP_BASELINE" -eq 0 ]; then
    echo -e "\n${YELLOW}▶ baseline — 1 connection, serial (network round-trip floor)${RESET}"
    run_k6 "$fw" "$url" latency 1 10s "${RESULTS_DIR}/${fw}-baseline.json"
  fi

  for c in $CONNS; do
    echo -e "\n${YELLOW}▶ ${fw} — ${c} connections for ${DURATION}${RESET}"
    run_k6 "$fw" "$url" vus "$c" "$DURATION" "${RESULTS_DIR}/${fw}-c${c}.json"
    # let the server's sockets drain before the next level
    sleep 3
  done

  ok "${fw} sweep complete"
}

# ── go ────────────────────────────────────────
header "Remote benchmark — real network"
info "host        : ${HOST}"
info "frameworks  : ${FRAMEWORKS[*]}"
for fw in "${FRAMEWORKS[@]}"; do info "  ${fw} port : $(port_for "$fw")"; done
info "route       : ${ROUTE}"
info "sweep       : ${CONNS} connections"
info "duration    : ${DURATION} per level"
info "results     : ${RESULTS_DIR}"

if [ "$DIESEL_PORT" = "$HONO_PORT" ] && [ ${#FRAMEWORKS[@]} -gt 1 ]; then
  echo ""
  warn "both frameworks share port ${DIESEL_PORT} — you'll be prompted to restart"
  warn "the server between them (the script waits and detects it automatically)."
fi

FAILED=()
for fw in "${FRAMEWORKS[@]}"; do
  bench_framework "$fw" || FAILED+=("$fw")
done

header "Comparison"
if command -v bun >/dev/null 2>&1; then
  bun run "${SCRIPT_DIR}/compare.ts" "$RESULTS_DIR"
else
  warn "bun not found — raw results are in ${RESULTS_DIR}"
fi

if [ ${#FAILED[@]} -ne 0 ]; then
  err "failed: ${FAILED[*]}"
  exit 1
fi
