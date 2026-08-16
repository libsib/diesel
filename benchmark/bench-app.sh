#!/usr/bin/env bash
# Diesel — in-process app.fetch() stress benchmark (no http server, no sockets)
# Wraps bench-app.ts with heavier defaults. Any env var it reads (ITER,
# WARMUP, CONCURRENCY, ROUNDS, FRAMEWORK, PATH_TYPE) can still be overridden
# by exporting it before calling this script.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUN=$(which bun || echo "$HOME/.bun/bin/bun")

export ITER="${ITER:-500000}"
export WARMUP="${WARMUP:-100000}"
export CONCURRENCY="${CONCURRENCY:-50}"
export ROUNDS="${ROUNDS:-1}"

echo "Diesel — app.fetch() stress benchmark"
echo "  iter        : ${ITER}"
echo "  warmup      : ${WARMUP}"
echo "  concurrency : ${CONCURRENCY}"
echo "  rounds      : ${ROUNDS}"
echo ""

"$BUN" run "$DIR/bench-app.ts" "$@"
