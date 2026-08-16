#!/usr/bin/env bash

set -e  # stop on error

echo "=============================="
echo " Running Context Benchmark"
echo "=============================="
bun run bench-ctx.ts
echo ""

echo "=============================="
echo " running Router Test "
bun run router/bench.ts
echo ""


# echo "=============================="
# echo " Running V8 Class Test"
# echo "=============================="
# bun run v8class.ts
# echo ""

echo "=============================="
echo " All tests finished"
echo "=============================="
