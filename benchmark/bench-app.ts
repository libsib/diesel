// bench-app.ts
//
// Benchmarks each framework's own request-handling pipeline — router match,
// middleware, ctx creation, response serialization — with NO http server,
// NO sockets, NO network stack involved. `app.fetch` (diesel) / `app.fetch`
// (hono) are both plain `(req: Request) => Response | Promise<Response>`
// functions, so we call them directly in a tight loop. This isolates each
// framework's own overhead from wrk/autocannon/oha's HTTP-parsing + TCP
// overhead, which dominates the numbers in http-bench.sh.
//
// Load is applied in CONCURRENCY-wide batches (Promise.all) rather than one
// call at a time, so the event loop actually has overlapping in-flight
// requests to schedule — closer to real concurrent traffic than a serial
// await loop. Each config runs ROUNDS times so the printed mean/min/max/stdev
// reflect run-to-run variance instead of a single sample.
//
// Usage:
//   bun run bench-app.ts                    # diesel + hono, static + param path
//   ITER=2000000 bun run bench-app.ts        # calls per round
//   CONCURRENCY=256 bun run bench-app.ts     # in-flight requests per batch
//   ROUNDS=10 bun run bench-app.ts           # measured rounds per config
//   FRAMEWORK=hono bun run bench-app.ts      # only run one framework
//   PATH_TYPE=param bun run bench-app.ts     # only run one path type (static | param)

import Diesel from "../src/main";
import type { Context } from "../src/ctx";
import { Hono } from "hono";
import { H3 } from "h3";

const ITER = Number(process.env.ITER) || 5_000_00;
const WARMUP = Number(process.env.WARMUP) || 100_000;
const CONCURRENCY = Number(process.env.CONCURRENCY) || 50;
const ROUNDS = Number(process.env.ROUNDS) || 1;
const FRAMEWORKS = process.env.FRAMEWORK
  ? [process.env.FRAMEWORK.toLowerCase()]
  : ["diesel", "hono", "h3"];
const PATH_TYPES = process.env.PATH_TYPE
  ? [process.env.PATH_TYPE.toLowerCase()]
  : ["static", "param"];

const ROUTES: Record<string, { path: string; url: string }> = {
  static: { path: "/", url: "http://localhost/" },
  param: { path: "/user/:id", url: "http://localhost/user/123" },
};

const dieselApp = new Diesel({ pipelineArchitecture: false });
dieselApp.get("/", (c: Context) => c.json({ message: "Hi there!", framework: "diesel" }));
dieselApp.get("/user/:id", (c: Context) => c.text("from id " + c.params.id));

const honoApp = new Hono();
honoApp.get("/", (c) => c.json({ message: "Hello Hono!", framework: "hono" }));
honoApp.get("/user/:id", (c) => c.text("from id " + c.req.param("id")));

const h3App = new H3();
h3App.get("/", () => ({ message: "Hello H3!", framework: "h3" }));
h3App.get("/user/:id", (event: any) => "from id " + event.context.params.id);

const HANDLERS: Record<string, (req: Request) => Response | Promise<Response>> = {
  diesel: dieselApp.fetch as any,
  hono: honoApp.fetch as any,
  h3: h3App.fetch as any,
};

// Fires `count` calls in batches of CONCURRENCY concurrent in-flight requests.
async function run(handler: (req: Request) => Response | Promise<Response>, url: string, count: number) {
  let done = 0;
  while (done < count) {
    const batch = Math.min(CONCURRENCY, count - done);
    const calls = new Array(batch);
    for (let i = 0; i < batch; i++) {
      calls[i] = Promise.resolve(handler(new Request(url))).then((res) => res.text());
    }
    await Promise.all(calls);
    done += batch;
  }
}

function stats(samples: number[]) {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  return {
    mean,
    min: Math.min(...samples),
    max: Math.max(...samples),
    stdev: Math.sqrt(variance),
  };
}

async function bench(framework: string, pathType: string) {
  const handler = HANDLERS[framework];
  const { path, url } = ROUTES[pathType];

  await run(handler, url, WARMUP); // let the JIT warm up before we start the clock
  global.gc?.();

  const msPerRound: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    const t1 = performance.now();
    await run(handler, url, ITER);
    const t2 = performance.now();
    msPerRound.push(t2 - t1);
  }

  const { mean, min, max, stdev } = stats(msPerRound);
  const perCall = (mean / ITER) * 1000;
  const perSec = ITER / (mean / 1000);

  console.log(
    `${framework.padEnd(7)} ${pathType.padEnd(6)} ${path.padEnd(12)} ` +
      `${ITER.toLocaleString()} calls x${CONCURRENCY} concurrency x${ROUNDS} rounds  →  ` +
      `${perSec.toFixed(0)} calls/sec, ${perCall.toFixed(3)}µs/call  ` +
      `(mean ${mean.toFixed(2)}ms, min ${min.toFixed(2)}ms, max ${max.toFixed(2)}ms, stdev ${stdev.toFixed(2)}ms)`
  );
}

console.log(
  `in-process stress benchmark (no server) — frameworks=${FRAMEWORKS.join(",")}, paths=${PATH_TYPES.join(",")}, ` +
    `iter=${ITER}, concurrency=${CONCURRENCY}, rounds=${ROUNDS}, warmup=${WARMUP}\n`
);

for (const framework of FRAMEWORKS) {
  for (const pathType of PATH_TYPES) {
    await bench(framework, pathType);
  }
  console.log();
}
