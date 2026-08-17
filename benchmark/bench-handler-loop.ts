// bench-handler-loop.ts
//
// #execute_handlers (src/main.ts) and the generated pipeline handler
// (src/request_pipeline.ts) both run:
//
//   for (let i = 0; i < handlers.length; i++) {
//     const result = handlers[i](ctx);
//     finalResult = isPromise(result) ? await result : result;
//     if (finalResult) break;
//   }
//
// The overwhelming majority of routes register exactly ONE handler
// (`app.get("/x", handler)`), so this loop pays for i=0 bounds checking,
// increment, and array indexing on every single request just to call
// `handlers[0]` once. This benchmarks whether special-casing
// `handlers.length === 1` (call handlers[0] directly, no loop) is worth
// it, and whether it costs anything on the 2-3 handler path.
//
// Same no-server, in-process style as bench-app.ts: app.fetch is a plain
// (req: Request) => Response | Promise<Response> function, called in a
// tight concurrent loop, isolating router+pipeline overhead from any
// socket/HTTP-parsing cost.
//
// Usage:
//   bun run bench-handler-loop.ts
//   ITER=1000000 CONCURRENCY=64 ROUNDS=5 bun run bench-handler-loop.ts

import Diesel from "../src/main";
import type { Context } from "../src/ctx";

const ITER = Number(process.env.ITER) || 500_000;
const WARMUP = Number(process.env.WARMUP) || 100_000;
const CONCURRENCY = Number(process.env.CONCURRENCY) || 50;
const ROUNDS = Number(process.env.ROUNDS) || 5;

const app = new Diesel({ pipelineArchitecture: false });

// 1 handler — the common case
app.get("/one", (c: Context) => c.text("one"));

// 2 handlers — first is a pass-through middleware-style handler (no
// return -> falsy -> loop continues to the next one), like a real
// app.get(path, validateSomething, actualHandler) chain.
let hitCounter = 0;
app.get(
  "/two",
  (_c: Context) => {
    hitCounter++;
  },
  (c: Context) => c.text("two"),
);

// 3 handlers — same pattern, two pass-throughs then the real response
app.get(
  "/three",
  (_c: Context) => {
    hitCounter++;
  },
  (_c: Context) => {
    hitCounter++;
  },
  (c: Context) => c.text("three"),
);

const ROUTES: Record<string, string> = {
  one: "http://localhost/one",
  two: "http://localhost/two",
  three: "http://localhost/three",
};

const handler = app.fetch as any as (req: Request) => Response | Promise<Response>;

async function run(url: string, count: number) {
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

async function bench(label: string, url: string) {
  await run(url, WARMUP);
  global.gc?.();

  const msPerRound: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    const t1 = performance.now();
    await run(url, ITER);
    const t2 = performance.now();
    msPerRound.push(t2 - t1);
  }

  const { mean, min, max, stdev } = stats(msPerRound);
  const perCall = (mean / ITER) * 1000;
  const perSec = ITER / (mean / 1000);

  console.log(
    `${label.padEnd(14)} ${ITER.toLocaleString()} calls x${CONCURRENCY} concurrency x${ROUNDS} rounds  →  ` +
      `${perSec.toFixed(0)} calls/sec, ${perCall.toFixed(3)}µs/call  ` +
      `(mean ${mean.toFixed(2)}ms, min ${min.toFixed(2)}ms, max ${max.toFixed(2)}ms, stdev ${stdev.toFixed(2)}ms)`,
  );
}

console.log(
  `handler-loop benchmark — iter=${ITER}, concurrency=${CONCURRENCY}, rounds=${ROUNDS}, warmup=${WARMUP}\n`,
);

await bench("1 handler", ROUTES.one);
await bench("2 handlers", ROUTES.two);
await bench("3 handlers", ROUTES.three);

// -----------------------------------------------------------------------
// Isolated micro-benchmark of JUST the mechanism (direct call vs a
// length-1 loop), with no router/Context/Response overhead in the way.
// The full app.fetch numbers above are dominated by everything else the
// request pipeline does, so a few-percent difference from this one loop
// is invisible against that noise floor. This isolates the loop itself
// to see whether the mechanism has a real, measurable cost at all.
// -----------------------------------------------------------------------

console.log("\n--- isolated mechanism: loop vs direct call (no app.fetch involved) ---\n");

const MICRO_ITER = 20_000_000;
const MICRO_TRIALS = 9;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function microBench(name: string, fn: () => number) {
  const samples: number[] = [];
  let sink = 0;
  for (let t = 0; t < MICRO_TRIALS; t++) {
    const start = performance.now();
    sink += fn();
    samples.push(performance.now() - start);
  }
  const m = median(samples);
  console.log(
    `${name}: ${m.toFixed(2)} ms total, ${((m * 1_000_000) / MICRO_ITER).toFixed(3)} ns/call (median of ${MICRO_TRIALS}, sink=${sink})`,
  );
}

const oneHandlerArr = [(x: number) => x + 1];
const twoHandlerArr = [(x: number) => x, (x: number) => x + 1];

microBench("for-loop over handlers.length===1", () => {
  let acc = 0;
  for (let i = 0; i < MICRO_ITER; i++) {
    let result: number | undefined;
    for (let j = 0; j < oneHandlerArr.length; j++) {
      result = oneHandlerArr[j](i);
      if (result) break;
    }
    acc += result!;
  }
  return acc;
});

microBench("direct call, no loop (handlers.length===1)", () => {
  let acc = 0;
  for (let i = 0; i < MICRO_ITER; i++) {
    const result = oneHandlerArr[0](i);
    acc += result;
  }
  return acc;
});

microBench("for-loop over handlers.length===2 (unchanged path)", () => {
  let acc = 0;
  for (let i = 0; i < MICRO_ITER; i++) {
    let result: number | undefined;
    for (let j = 0; j < twoHandlerArr.length; j++) {
      result = twoHandlerArr[j](i);
      if (result) break;
    }
    acc += result!;
  }
  return acc;
});

console.log("\nDone.");
