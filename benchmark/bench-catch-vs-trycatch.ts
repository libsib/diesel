// bench-catch-vs-trycatch.ts
//
// #handleRequests / #buildFetchHandler / cfFetch all currently do:
//
//   return this.#execute_handlers(ctx, matchedRouteHandler).catch((err) =>
//     this.handleError(err, ctx),
//   );
//
// i.e. chain `.catch()` externally onto the promise returned by an async
// method. The alternative is to make the caller itself `async` and wrap
// the `await` in a try/catch:
//
//   try {
//     return await this.#execute_handlers(ctx, matchedRouteHandler);
//   } catch (err) {
//     return this.handleError(err, ctx);
//   }
//
// `.catch(fn)` is sugar for `.then(undefined, fn)`, which allocates a
// SEPARATE promise on top of the one the async method already returns.
// An isolated microbenchmark of just that mechanism (see
// bench-undefined-check.ts-style probes) shows ~20ns/call in favor of
// try/catch. This benchmark checks whether that survives contact with
// the real, whole `app.fetch` pipeline (routing, Context creation,
// response building) rather than a toy function.
//
// This needs TWO actual builds of Diesel that differ ONLY in this one
// pattern, so `../src/main.ts` (this repo, `main` branch — `.catch()`)
// is compared against a sibling git worktree
// (`../../trycatch-experiment/src/main.ts`, branch
// `experiment/trycatch-vs-catch` — internal try/catch). Every other line
// of the two files is identical (the worktree was seeded as a copy of
// this repo's current working tree before applying only the catch-vs-
// try/catch edit), so the ONLY variable being measured is this pattern.
//
// Setup (only needed once, or after this repo's src/ changes and you
// want the comparison to stay apples-to-apples):
//   git worktree add -b experiment/trycatch-vs-catch ../../trycatch-experiment HEAD
//   rsync -a --exclude node_modules --exclude .git src/ ../../trycatch-experiment/src/
//   # then hand-edit ../../trycatch-experiment/src/main.ts to swap the
//   # 3 `.catch()` call sites for internal try/catch.
//
// Usage:
//   bun run bench-catch-vs-trycatch.ts
//   ITER=1000000 ROUNDS=9 bun run bench-catch-vs-trycatch.ts

import DieselCatch from "../src/main";
import type { Context } from "../src/ctx";

const TRYCATCH_MAIN_PATH =
  "/Users/pradeepkumar/Desktop/code/diesel.js/trycatch-experiment/src/main.ts";

const { default: DieselTryCatch } = await import(TRYCATCH_MAIN_PATH);

const ITER = Number(process.env.ITER) || 1_000_000;
const WARMUP = Number(process.env.WARMUP) || 100_000;
const CONCURRENCY = Number(process.env.CONCURRENCY) || 50;
const ROUNDS = Number(process.env.ROUNDS) || 9;

function buildApp(DieselCtor: any) {
  const app = new DieselCtor({ pipelineArchitecture: false });
  app.get("/one", (c: Context) => c.text("one"));
  return app;
}

const catchApp = buildApp(DieselCatch);
const tryCatchApp = buildApp(DieselTryCatch);

const URL = "http://localhost/one";

async function run(handler: (req: Request) => Response | Promise<Response>, count: number) {
  let done = 0;
  while (done < count) {
    const batch = Math.min(CONCURRENCY, count - done);
    const calls = new Array(batch);
    for (let i = 0; i < batch; i++) {
      calls[i] = Promise.resolve(handler(new Request(URL))).then((res) => res.text());
    }
    await Promise.all(calls);
    done += batch;
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function bench(label: string, handler: (req: Request) => Response | Promise<Response>) {
  await run(handler, WARMUP);

  const samples: number[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    const t1 = performance.now();
    await run(handler, ITER);
    samples.push(performance.now() - t1);
  }

  const m = median(samples);
  const perCall = (m / ITER) * 1000;
  const perSec = ITER / (m / 1000);
  console.log(
    `${label.padEnd(28)} median ${m.toFixed(2)}ms  →  ${perSec.toFixed(0)} calls/sec, ${perCall.toFixed(3)}µs/call ` +
      `(all ${ROUNDS} rounds: ${samples.map((s) => s.toFixed(1)).join(", ")})`,
  );
}

console.log(
  `catch vs try/catch — real app.fetch A/B, iter=${ITER}, concurrency=${CONCURRENCY}, rounds=${ROUNDS}, warmup=${WARMUP}\n`,
);

// Interleaved (A, B, A, B, ...) across two full passes so neither variant
// gets an unfair thermal/scheduling advantage from running first/last.
for (let pass = 1; pass <= 4; pass++) {
  console.log(`--- pass ${pass} (order ${pass % 2 === 0 ? "trycatch-first" : "catch-first"}) ---`);
  if (pass % 2 === 0) {
    await bench("internal try/catch [experiment]", tryCatchApp.fetch as any);
    await bench("external .catch() [main]", catchApp.fetch as any);
  } else {
    await bench("external .catch() [main]", catchApp.fetch as any);
    await bench("internal try/catch [experiment]", tryCatchApp.fetch as any);
  }
  console.log();
}

console.log("Done.");
