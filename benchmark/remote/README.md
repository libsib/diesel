# Remote benchmark — diesel vs hono over a real network

Drives load at a running VPS and reports whether the numbers actually say
anything about the frameworks.

## Files

| file              | what it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `k6-http.js`      | the k6 script — one framework, one concurrency level, one route      |
| `remote-bench.sh` | runs a concurrency sweep for each framework, then compares          |
| `compare.ts`      | reads `results/*.json`, prints the tables and the validity verdict   |

## Run it

Both apps on the VPS, on separate ports:

```bash
# on the VPS
cd ~/diesel/benchmark
PORT=3000 bun run src/diesel.ts &
PORT=3001 bun run src/hono.ts &
```

```bash
# from your machine (~2 min)
./remote-bench.sh --host 139.99.91.212 --diesel-port 3000 --hono-port 3001 \
  --conns "50 200 800" --duration 10s
```

Same port for both instead, restarting in between — the script waits and
detects the swap automatically by reading the `framework` field from `GET /`:

```bash
./remote-bench.sh --host 139.99.91.212 --port 3000
```

Options: `--conns`, `--duration`, `--route` (a path or `mix`), `--no-baseline`,
`--wait-timeout`. One framework only: `./remote-bench.sh diesel`.

Re-print the last comparison without re-running: `bun run compare.ts`.

## Reading the verdict column

Each level is labelled, because most remote levels cannot see the framework:

- **rtt-bound** — median latency is basically the ping time. Both frameworks
  finished long before the packet got back; req/s here is `connections / RTT`
  and nothing else.
- **saturated** — errors, dropped iterations, or TCP connect times blowing up.
  The client or the link gave out, not the server.
- **usable** — latency rose above pure RTT without anything breaking. Only
  these levels are compared head to head.

## Measuring the frameworks

At ~50ms RTT a connection carries ~20 req/s, so the link caps out thousands of
req/s below what either framework does. To compare the code, remove the network
by driving load from inside the VPS:

```bash
# on the VPS: brew/apt install k6, then
for fw in diesel:3000 hono:3001; do
  TARGET=http://127.0.0.1:${fw#*:} FRAMEWORK=${fw%:*} \
  MODE=vus VUS=100 DURATION=20s OUT=results/${fw%:*}-c100.json \
    k6 run --quiet k6-http.js
done
bun run compare.ts results
```

Use the remote test for the thing it is genuinely good at: confirming both
stacks serve every route correctly and stay stable for real clients at real
latency.

## Modes

`MODE` on `k6-http.js` directly:

- `vus` (default) — `VUS` connections flat out for `DURATION`; capacity at that concurrency.
- `latency` — 1 connection, serial; the round-trip floor.
- `ramp` — arrival-rate ramp to `RATE_MAX` req/s; finds where it stops keeping up.
- `smoke` — 5 VUs, 10s; correctness check.
