#!/usr/bin/env bash
# Diesel — Pipeline vs No-Pipeline benchmark

BUN=$(which bun || echo "$HOME/.bun/bin/bun")
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=3001
URL="http://127.0.0.1:${PORT}"
DURATION=${DURATION:-4}
CONNS=${CONNECTIONS:-100}

kill_port() {
  lsof -ti "tcp:${PORT}" 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 0.3
}

wait_ready() {
  local n=0
  until curl -sf "${URL}/" > /dev/null 2>&1; do
    sleep 0.2; n=$((n+1))
    [ $n -ge 30 ] && echo "Server failed to start" && exit 1
  done
}

bench() {
  local label="$1" script="$2"
  echo ""
  echo "=== $label ==="
  kill_port
  PORT=${PORT} "$BUN" run "$script" > /dev/null 2>&1 &
  local pid=$!
  wait_ready
  for route in "/" "/user/42" "/users/alice" "/user/7/post/99"; do
    echo "  $route"
    wrk -t4 -c${CONNS} -d${DURATION}s "${URL}${route}" 2>/dev/null | grep "Requests/sec" | sed 's/^/    /'
  done
  kill $pid 2>/dev/null || true
  wait $pid 2>/dev/null || true
  kill_port
}

echo "Diesel: Pipeline vs No-Pipeline (${DURATION}s per route, ${CONNS} conns)"
bench "pipelineArchitecture: true"  "$DIR/src/diesel-pipeline.ts"
bench "pipelineArchitecture: false" "$DIR/src/diesel-no-pipeline.ts"
echo ""
echo "done."
