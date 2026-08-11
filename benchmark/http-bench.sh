#!/usr/bin/env bash

# ──────────────────────────────────────────────
#  HTTP Framework Benchmark
#  Frameworks : diesel · hono · elysia · express · fastify · h3
#  Tools      : wrk · autocannon · oha
# ──────────────────────────────────────────────

set -euo pipefail

BENCH_PORT=${PORT:-3000}
BENCH_URL="http://127.0.0.1:${BENCH_PORT}"
DURATION=${DURATION:-3}
CONNECTIONS=${CONNECTIONS:-100}
WRK_THREADS=${WRK_THREADS:-4}
WARMUP=2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── colours ──────────────────────────────────
BOLD='\033[1m'; CYAN='\033[0;36m'; GREEN='\033[0;32m'
YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'

header()  { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════${RESET}"
            echo -e "${BOLD}${CYAN}  $1${RESET}"
            echo -e "${BOLD}${CYAN}══════════════════════════════════════════${RESET}"; }
section() { echo -e "\n${YELLOW}▶ $1${RESET}"; }
ok()      { echo -e "${GREEN}✔  $1${RESET}"; }
err()     { echo -e "${RED}✖  $1${RESET}"; }

# ── dependency check ─────────────────────────
check_deps() {
  local missing=()
  for cmd in wrk autocannon oha bun curl lsof; do
    command -v "$cmd" &>/dev/null || missing+=("$cmd")
  done
  if [ ${#missing[@]} -ne 0 ]; then
    err "Missing required tools: ${missing[*]}"
    echo "  brew install wrk oha && bun add -g autocannon"
    exit 1
  fi
}

# ── port helpers ──────────────────────────────
kill_port() {
  local pids
  pids=$(lsof -ti "tcp:${BENCH_PORT}" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    kill -9 $pids 2>/dev/null || true
    sleep 0.4
  fi
}

wait_for_server() {
  local attempts=0
  while ! curl -sf "${BENCH_URL}/" > /dev/null 2>&1; do
    sleep 0.25
    ((attempts++))
    if [ "$attempts" -ge 40 ]; then
      err "Server did not respond within 10s"
      return 1
    fi
  done
}

# ── benchmark one framework ───────────────────
run_benchmark() {
  local name="$1"
  local cmd="$2"

  header "Benchmarking: ${name}"
  echo -e "  cmd         : ${cmd}"
  echo -e "  url         : ${BENCH_URL}/"
  echo -e "  duration    : ${DURATION}s per tool"
  echo -e "  connections : ${CONNECTIONS}"

  kill_port

  PORT="${BENCH_PORT}" eval "${cmd}" > "/tmp/bench_${name}.log" 2>&1 &
  local server_pid=$!

  if ! wait_for_server; then
    err "Server failed — logs at /tmp/bench_${name}.log"
    cat "/tmp/bench_${name}.log" || true
    kill "${server_pid}" 2>/dev/null || true
    return 1
  fi

  ok "Server up (pid ${server_pid})"

  # warm-up
  section "Warm-up (${WARMUP}s)"
  wrk -t2 -c50 -d"${WARMUP}s" "${BENCH_URL}/" > /dev/null 2>&1 || true
  sleep 0.3

  # wrk
  section "wrk  (-t${WRK_THREADS} -c${CONNECTIONS} -d${DURATION}s --latency)"
  wrk -t"${WRK_THREADS}" -c"${CONNECTIONS}" -d"${DURATION}s" --latency "${BENCH_URL}/" || true

  # autocannon
  section "autocannon  (-c ${CONNECTIONS} -d ${DURATION})"
  autocannon --connections "${CONNECTIONS}" --duration "${DURATION}" "${BENCH_URL}/" || true

  # oha
  section "oha  (-c ${CONNECTIONS} -z ${DURATION}s)"
  oha --no-tui -c "${CONNECTIONS}" -z "${DURATION}s" "${BENCH_URL}/" || true

  kill "${server_pid}" 2>/dev/null || true
  wait "${server_pid}" 2>/dev/null || true
  kill_port
  ok "${name} done"
}

# ── framework list (parallel arrays, bash 3 compatible) ──
FW_NAMES=("diesel"  "hono"  "elysia"  "express"  "fastify"  "h3")
FW_CMDS=(
  "bun run ${SCRIPT_DIR}/src/diesel.ts"
  "bun run ${SCRIPT_DIR}/src/hono.ts"
  "bun run ${SCRIPT_DIR}/src/elysia.ts"
  "bun run ${SCRIPT_DIR}/src/express.ts"
  "bun run ${SCRIPT_DIR}/src/fastify.js"
  "bun run ${SCRIPT_DIR}/src/h3.ts"
)

# ── arg parsing ───────────────────────────────
SELECTED=()

usage() {
  echo "Usage: $0 [framework ...] [options]"
  echo ""
  echo "  Frameworks : ${FW_NAMES[*]}"
  echo "  (no args   → run all frameworks)"
  echo ""
  echo "  Options:"
  echo "    --duration    N   seconds per tool  (default: ${DURATION})"
  echo "    --connections N   concurrent conns  (default: ${CONNECTIONS})"
  echo "    --threads     N   wrk threads       (default: ${WRK_THREADS})"
  echo "    --port        N   server port       (default: ${BENCH_PORT})"
  exit 0
}

is_known_fw() {
  local fw="$1"
  for name in "${FW_NAMES[@]}"; do
    [ "$name" = "$fw" ] && return 0
  done
  return 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)     usage ;;
    --duration)    DURATION="$2";    shift 2 ;;
    --connections) CONNECTIONS="$2"; shift 2 ;;
    --threads)     WRK_THREADS="$2"; shift 2 ;;
    --port)        BENCH_PORT="$2"; BENCH_URL="http://127.0.0.1:${BENCH_PORT}"; shift 2 ;;
    -*)            err "Unknown flag: $1"; usage ;;
    *)
      if is_known_fw "$1"; then
        SELECTED+=("$1")
      else
        err "Unknown framework: $1  (known: ${FW_NAMES[*]})"
        exit 1
      fi
      shift ;;
  esac
done

[ ${#SELECTED[@]} -eq 0 ] && SELECTED=("${FW_NAMES[@]}")

# ── run ───────────────────────────────────────
check_deps

echo -e "\n${BOLD}HTTP Framework Benchmark${RESET}"
echo -e "  frameworks  : ${SELECTED[*]}"
echo -e "  port        : ${BENCH_PORT}"
echo -e "  duration    : ${DURATION}s per tool"
echo -e "  connections : ${CONNECTIONS}"
echo -e "  wrk threads : ${WRK_THREADS}"
echo -e "  tools       : wrk · autocannon · oha"

FAILED=()

for fw in "${SELECTED[@]}"; do
  # find matching index in FW_NAMES
  cmd=""
  for i in "${!FW_NAMES[@]}"; do
    if [ "${FW_NAMES[$i]}" = "$fw" ]; then
      cmd="${FW_CMDS[$i]}"
      break
    fi
  done
  run_benchmark "${fw}" "${cmd}" || FAILED+=("${fw}")
done

header "Benchmark Complete"
if [ ${#FAILED[@]} -ne 0 ]; then
  echo -e "  ${RED}Failed: ${FAILED[*]}${RESET}"
else
  echo -e "  ${GREEN}All frameworks completed successfully${RESET}"
fi
