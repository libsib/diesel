import DieselReal from "../src/main.js";

// -----------------------------------------------------------------------
// Startup-time audit: things `new Diesel()` (and sub-router instances via
// `new Diesel()` + `app.route(prefix, router)`) pay for on every
// construction, whether or not that construction ever needs them.
// This matters most for:
//   - cold starts on Cloudflare Workers / Lambda / Deploy (one construction
//     per isolate boot)
//   - apps that create many sub-routers (one `new Diesel()` per module)
//
// Section 1 benchmarks the REAL, LIVE `src/main.ts` class as it exists
// right now (imported directly) — this reflects whatever state the source
// is currently in.
//
// Sections 2 and 3 are standalone "before vs after" repros kept for
// reference/documentation. They do NOT import from src — they hardcode
// both the old and new patterns side by side so the reasoning behind the
// fix stays visible even after src/main.ts has already been changed:
//
// 2. `this.tempRoutes = new Map()` in the constructor — allocated eagerly
//    even though it's only ever written to inside addRoute(). Same shape
//    of issue as `tempMiddlewares`, which was already lazy (`null` until
//    `use()` is called). Fixed in src/main.ts: tempRoutes is now `null`
//    until first `addRoute()` call, via `??=`.
//
// 3. `supportedMethods.forEach(...)` in the constructor created 10 brand
//    new arrow-function closures and assigned them as own properties on
//    *every* instance (get/post/put/patch/delete/any/head/options/
//    propfind/all). Fixed in src/main.ts: these are now plain prototype
//    methods, shared across every instance, allocated zero times per
//    construction.
// -----------------------------------------------------------------------

const TRIALS = 9;
const ITER = 50_000;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function runBench(name: string, fn: () => number) {
  const samples: number[] = [];
  let sink = 0;
  for (let t = 0; t < TRIALS; t++) {
    const start = performance.now();
    sink += fn();
    samples.push(performance.now() - start);
  }
  const m = median(samples);
  console.log(
    `${name}: ${m.toFixed(2)} ms total, ${((m * 1000) / ITER).toFixed(2)} µs/instance (median of ${TRIALS}, sink=${sink})`,
  );
  return m;
}

console.log("=== 1. Real `new Diesel()` baseline (live src/main.ts, whatever state it's in) ===\n");

runBench("new Diesel() [live src/main.ts]", () => {
  let count = 0;
  for (let i = 0; i < ITER; i++) {
    const app = new (DieselReal as any)();
    count += app ? 1 : 0;
  }
  return count;
});

console.log("\n=== 2. tempRoutes: eager `new Map()` (before) vs lazy `null` (after — what src/main.ts does now) ===\n");

class EagerTempRoutes {
  tempRoutes: Map<string, any>;
  constructor() {
    this.tempRoutes = new Map();
  }
}

class LazyTempRoutes {
  tempRoutes: Map<string, any> | null;
  constructor() {
    this.tempRoutes = null;
  }
}

runBench("constructor with `tempRoutes = new Map()` (before fix)", () => {
  let count = 0;
  for (let i = 0; i < ITER; i++) {
    count += new EagerTempRoutes().tempRoutes ? 1 : 0;
  }
  return count;
});

runBench("constructor with `tempRoutes = null` (after fix, matches tempMiddlewares)", () => {
  let count = 0;
  for (let i = 0; i < ITER; i++) {
    count += new LazyTempRoutes().tempRoutes === null ? 1 : 0;
  }
  return count;
});

console.log(
  "\n=== 3. HTTP verb methods: forEach closures (before) vs prototype methods (after — what src/main.ts does now) ===\n",
);

const SUPPORTED_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "ANY",
  "ALL",
  "HEAD",
  "OPTIONS",
  "PROPFIND",
];

class ForEachClosures {
  constructor() {
    SUPPORTED_METHODS.forEach((method) => {
      (this as any)[method.toLocaleLowerCase()] = (
        path: string,
        ...handlers: any
      ): this => {
        this.addRoute(method, path, handlers);
        return this;
      };
    });
  }
  addRoute(_method: string, _path: string, _handlers: any) {}
}

class PrototypeMethods {
  addRoute(_method: string, _path: string, _handlers: any) {}
  get(path: string, ...handlers: any) {
    this.addRoute("GET", path, handlers);
    return this;
  }
  post(path: string, ...handlers: any) {
    this.addRoute("POST", path, handlers);
    return this;
  }
  put(path: string, ...handlers: any) {
    this.addRoute("PUT", path, handlers);
    return this;
  }
  patch(path: string, ...handlers: any) {
    this.addRoute("PATCH", path, handlers);
    return this;
  }
  delete(path: string, ...handlers: any) {
    this.addRoute("DELETE", path, handlers);
    return this;
  }
  any(path: string, ...handlers: any) {
    this.addRoute("ANY", path, handlers);
    return this;
  }
  all(path: string, ...handlers: any) {
    this.addRoute("ALL", path, handlers);
    return this;
  }
  head(path: string, ...handlers: any) {
    this.addRoute("HEAD", path, handlers);
    return this;
  }
  options(path: string, ...handlers: any) {
    this.addRoute("OPTIONS", path, handlers);
    return this;
  }
  propfind(path: string, ...handlers: any) {
    this.addRoute("PROPFIND", path, handlers);
    return this;
  }
}

runBench("constructor with forEach-assigned closures (before fix)", () => {
  let count = 0;
  for (let i = 0; i < ITER; i++) {
    count += new ForEachClosures() ? 1 : 0;
  }
  return count;
});

runBench("constructor with prototype methods (after fix, zero per-instance closures)", () => {
  let count = 0;
  for (let i = 0; i < ITER; i++) {
    count += new PrototypeMethods() ? 1 : 0;
  }
  return count;
});

console.log("\nDone.");
