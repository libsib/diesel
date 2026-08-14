import { Context as HonoContext } from "./hono-ctx.js";
import { Context as DieselContext } from "../src/ctx.js";

const ITER = 10_000_00;

// Minimal fake request
const req = new Request("http://localhost/test");

// Fake values for Diesel
const fakeServer: any = null;
const fakeParams: any = {};
const fakeEnv: any = {};
const fakeExec: any = null;

// Fake values for Hono
const honoOpts: any = {
  env: {},
  executionCtx: {} as any,
  matchResult: [] as any,
  notFoundHandler: undefined,
  path: "/test",
};

function bench(name: string, fn: () => void) {
  const start = performance.now();
  fn();
  const end = performance.now();
  console.log(`${name}: ${(end - start).toFixed(2)} ms`);
}

console.log("Warming up...");

// Warmup (important for JIT)
for (let i = 0; i < 100_000; i++) {
  new DieselContext(req, fakeServer, "/test", fakeParams, fakeEnv, fakeExec).text("hi");
  new HonoContext(req, honoOpts).text("hi");
}

console.log("Starting benchmarks\n");

// -----------------------------
// 1. Context creation only
// -----------------------------

bench("Diesel Context create", () => {
  for (let i = 0; i < ITER; i++) {
    new DieselContext(req, fakeServer, "/test", fakeParams, fakeEnv, fakeExec);
  }
});

bench("Hono Context create", () => {
  for (let i = 0; i < ITER; i++) {
    new HonoContext(req, honoOpts);
  }
});

console.log("");

// -----------------------------
// 2. text() without headers
// -----------------------------


bench("Diesel text()", () => {
  for (let i = 0; i < ITER; i++) {
    const c = new DieselContext(req, fakeServer, "/test", fakeParams, fakeEnv, fakeExec);
    c.text("hello world");
  }
});

bench("Hono text()", () => {
  for (let i = 0; i < ITER; i++) {
    const c = new HonoContext(req, honoOpts);
    c.text("hello world");
  }
});

console.log("");

// -----------------------------
// 3. json() without headers
// -----------------------------

bench("Diesel json()", () => {
  for (let i = 0; i < ITER; i++) {
    const c = new DieselContext(req, fakeServer, "/test", fakeParams, fakeEnv, fakeExec);
    c.json({ a: 1, b: 2, c: 3 });
  }
});

bench("Hono json()", () => {
  for (let i = 0; i < ITER; i++) {
    const c = new HonoContext(req, honoOpts);
    c.json({ a: 1, b: 2, c: 3 });
  }
});

console.log("");

// -----------------------------
// 4. text() WITH headers used
// -----------------------------

bench("Diesel text() + header", () => {
  for (let i = 0; i < ITER; i++) {
    const c = new DieselContext(req, fakeServer, "/test", fakeParams, fakeEnv, fakeExec);
    c.setHeader("X-Test", "1");
    c.text("hello");
  }
});

bench("Hono text() + header", () => {
  for (let i = 0; i < ITER; i++) {
    const c = new HonoContext(req, honoOpts);
    c.header("X-Test", "1");
    c.text("hello");
  }
});

console.log("\nDone.");
