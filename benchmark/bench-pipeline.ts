// bench-pipeline.ts
//
// One-off: diesel `pipelineArchitecture: true` vs `false`, in-process
// (no server, no sockets) — same call-in-a-loop technique as bench-app.ts,
// but this time with a hook/middleware chain in front of the route, since
// pipelineArchitecture only precompiles that chain. A bare route with zero
// middleware degenerates to the same dispatch path either way (see
// bench-app.ts results), so this uses the same onRequest/preHandler/onSend
// hooks + global middleware shape as src/diesel-pipeline.ts /
// src/diesel-no-pipeline.ts to actually exercise the thing that differs.
//
// Usage:
//   bun run bench-pipeline.ts
//   ITER=2000000 CONCURRENCY=256 ROUNDS=10 bun run bench-pipeline.ts

import Diesel from "../src/main";
import type { Context } from "../src/ctx";

const ITER = Number(process.env.ITER) || 1_000_000;
const WARMUP = Number(process.env.WARMUP) || 100_000;
const CONCURRENCY = Number(process.env.CONCURRENCY) || 128;
const ROUNDS = Number(process.env.ROUNDS) || 5;
const PATH_TYPES = process.env.PATH_TYPE
  ? [process.env.PATH_TYPE.toLowerCase()]
  : ["static", "param"];

const ROUTES: Record<string, { path: string; url: string }> = {
  static: { path: "/", url: "http://localhost/" },
  param: { path: "/user/:id", url: "http://localhost/user/123" },
};

function buildApp(pipelineArchitecture: boolean) {
  const app = new Diesel({ pipelineArchitecture });

  app.addHooks("onRequest", (ctx: Context) => {
    const _ = ctx.req.headers.get("x-request-id") ?? "none";
  });
  app.addHooks("preHandler", (ctx: Context) => {
    ctx.set("startTime", Date.now());
  });
  app.addHooks("onSend", (ctx: Context, result: any) => {
    const _ = Date.now() - (ctx.get("startTime") ?? 0);
  });
  app.use((ctx: Context) => {
    const _ = ctx.req.method;
  });

  app.get("/", (c: Context) => c.json({ message: "Hi there!", arch: pipelineArchitecture ? "pipeline" : "no-pipeline" }));
  app.get("/user/:id", (c: Context) => c.text("from id " + c.params.id));

  return app;
}

const APPS: Record<string, ReturnType<typeof buildApp>> = {
  "pipeline:false": buildApp(false),
  "pipeline:true": buildApp(true),
};

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
  return { mean, min: Math.min(...samples), max: Math.max(...samples), stdev: Math.sqrt(variance) };
}

async function bench(label: string, app: ReturnType<typeof buildApp>, pathType: string) {
  const handler = app.fetch as any;
  const { path, url } = ROUTES[pathType];

  await run(handler, url, WARMUP);
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
    `${label.padEnd(14)} ${pathType.padEnd(6)} ${path.padEnd(12)} ` +
      `${ITER.toLocaleString()} calls x${CONCURRENCY} concurrency x${ROUNDS} rounds  →  ` +
      `${perSec.toFixed(0)} calls/sec, ${perCall.toFixed(3)}µs/call  ` +
      `(mean ${mean.toFixed(2)}ms, min ${min.toFixed(2)}ms, max ${max.toFixed(2)}ms, stdev ${stdev.toFixed(2)}ms)`
  );
}

console.log(
  `diesel pipelineArchitecture true vs false — with onRequest/preHandler/onSend hooks + 1 global middleware, ` +
    `iter=${ITER}, concurrency=${CONCURRENCY}, rounds=${ROUNDS}, warmup=${WARMUP}\n`
);

for (const pathType of PATH_TYPES) {
  for (const label of Object.keys(APPS)) {
    await bench(label, APPS[label], pathType);
  }
  console.log();
}
