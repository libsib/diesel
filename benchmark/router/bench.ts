import { TrieRouter } from "../../src/router/trie";
import { FindMyWayRouter } from "./find-my-way";
import { HonoTrieRouter } from "./hono/router";

// Configuration
const NUM_ROUTES = 3000;
const SEARCH_ITERATIONS = 2_000_000;
const LATENCY_SAMPLES = 100_000;

const dummyHandler = () => "ok";

interface RouterInstance {
  add(method: string, path: string, handler: any): void;
  find(method: string, path: string): any;
}

// Utilities

function forceGC(): void {
  if (global.gc) {
    global.gc();
  }
}

function getMemoryUsageMB(): number {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor(sorted.length * p);
  return sorted[idx];
}

// Route Generators — one distinct shape per category (static / param / wildcard).
// Each generator produces `n` DISTINCT routes by varying a static "version"
// segment (`v${i}`), so insertion cost is comparable across categories even
// though param/wildcard routes only have one *shape* per version.

function makeStaticRoutes(n: number): string[] {
  const routes: string[] = [];
  for (let i = 0; i < n; i++) {
    routes.push(`/api/users/${i}`);
    routes.push(`/api/posts/${i}/comments/${i}`);
    routes.push(`/shop/categories/electronics/devices/mobile/products/${i}`);
    routes.push(`/flights/JFK/LHR/20261201/seat/${i}`);
  }
  return routes;
}

function makeStaticLookupPaths(n: number): string[] {
  const paths = new Array(SEARCH_ITERATIONS);
  for (let i = 0; i < SEARCH_ITERATIONS; i++) {
    const id = (Math.random() * n) | 0;
    const r = Math.random();

    if (r < 0.2) {
      paths[i] = `/api/users/${id}`;
    } else if (r < 0.4) {
      paths[i] = `/api/posts/${id}/comments/${id}`;
    } else if (r < 0.6) {
      paths[i] = `/shop/categories/electronics/devices/mobile/products/${id}`;
    } else if (r < 0.8) {
      paths[i] = `/flights/JFK/LHR/20261201/seat/${id}`;
    } else {
      // Intentional 404 misses to test worst case traversal
      paths[i] = `/api/unknown/path/that/does/not/exist/${id}`;
    }
  }
  return paths;
}

function makeParamRoutes(n: number): string[] {
  const routes: string[] = [];
  for (let i = 0; i < n; i++) {
    routes.push(`/api/v${i}/users/:id`);
    routes.push(`/api/v${i}/posts/:id/comments/:commentId`);
    routes.push(`/shop/v${i}/categories/:category/devices/:device/products/:id`);
    routes.push(`/flights/v${i}/:departure/:destination/:date/seat/:seat`);
  }
  return routes;
}

function makeParamLookupPaths(n: number): string[] {
  const paths = new Array(SEARCH_ITERATIONS);
  for (let i = 0; i < SEARCH_ITERATIONS; i++) {
    const id = (Math.random() * n) | 0;
    const r = Math.random();

    if (r < 0.2) {
      paths[i] = `/api/v${id}/users/42`;
    } else if (r < 0.4) {
      paths[i] = `/api/v${id}/posts/42/comments/7`;
    } else if (r < 0.6) {
      paths[i] = `/shop/v${id}/categories/electronics/devices/mobile/products/42`;
    } else if (r < 0.8) {
      paths[i] = `/flights/v${id}/JFK/LHR/20261201/seat/42`;
    } else {
      // Intentional 404 misses to test worst case traversal
      paths[i] = `/api/v${id}/unknown/path/that/does/not/exist`;
    }
  }
  return paths;
}

function makeWildcardRoutes(n: number): string[] {
  const routes: string[] = [];
  for (let i = 0; i < n; i++) {
    routes.push(`/api/v${i}/files/*`);
    routes.push(`/assets/v${i}/*`);
    routes.push(`/shop/v${i}/categories/electronics/*`);
    routes.push(`/downloads/v${i}/archive/*`);
  }
  return routes;
}

function makeWildcardLookupPaths(n: number): string[] {
  const paths = new Array(SEARCH_ITERATIONS);
  for (let i = 0; i < SEARCH_ITERATIONS; i++) {
    const id = (Math.random() * n) | 0;
    const r = Math.random();

    if (r < 0.2) {
      paths[i] = `/api/v${id}/files/deep/nested/path/to/file.png`;
    } else if (r < 0.4) {
      paths[i] = `/assets/v${id}/img/logo.svg`;
    } else if (r < 0.6) {
      paths[i] = `/shop/v${id}/categories/electronics/phones/mobile/product-42`;
    } else if (r < 0.8) {
      paths[i] = `/downloads/v${id}/archive/2026/08/report.zip`;
    } else {
      // Intentional 404 misses to test worst case traversal
      paths[i] = `/api/v${id}/unknown/path/that/does/not/exist`;
    }
  }
  return paths;
}

// Benchmark Stages

function benchmarkInsert(router: RouterInstance, routes: string[], name: string): void {
  forceGC();
  const memBefore = getMemoryUsageMB();

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < routes.length; i++) {
    router.add("GET", routes[i], dummyHandler);
  }
  const t1 = process.hrtime.bigint();

  const memAfter = getMemoryUsageMB();
  const ms = Number(t1 - t0) / 1_000_000;
  const memDelta = memAfter - memBefore;

  console.log(`${name} insert: ${ms.toFixed(2)} ms | Memory Delta: +${memDelta.toFixed(2)} MB`);
}

function benchmarkLookup(router: RouterInstance, paths: string[], name: string): void {
  // Warmup the JIT compiler
  for (let i = 0; i < 100000; i++) {
    router.find("GET", paths[i]);
  }

  forceGC();
  const t0 = process.hrtime.bigint();

  for (let i = 0; i < paths.length; i++) {
    router.find("GET", paths[i]);
  }

  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1_000_000;
  const rps = (SEARCH_ITERATIONS / (ms / 1000)).toFixed(0);

  console.log(`${name} lookup: ${ms.toFixed(2)} ms | RPS: ${rps}`);
}

function benchmarkParamAccess(router: RouterInstance, paths: string[], name: string): void {
  for (let i = 0; i < 100000; i++) {
    router.find("GET", paths[i]);
  }

  forceGC();
  const t0 = process.hrtime.bigint();

  for (let i = 0; i < paths.length; i++) {
    const r = router.find("GET", paths[i]);
    if (r && r.params) {
      const _ = Object.values(r.params)[0];
    }
  }

  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1_000_000;
  console.log(`${name} param access: ${ms.toFixed(2)} ms`);
}

function latencyTest(router: RouterInstance, paths: string[], name: string): void {
  const samples = new Float64Array(LATENCY_SAMPLES);

  for (let i = 0; i < 100000; i++) {
    router.find("GET", paths[i]);
  }

  forceGC();

  for (let i = 0; i < LATENCY_SAMPLES; i++) {
    const idx = (Math.random() * paths.length) | 0;

    const t0 = process.hrtime.bigint();
    router.find("GET", paths[idx]);
    const t1 = process.hrtime.bigint();

    // Store in microseconds for better precision reading
    samples[i] = Number(t1 - t0) / 1000;
  }

  samples.sort();

  console.log(
    `${name} latency (μs) ` +
    `p50=${percentile(samples as any, 0.5).toFixed(2)} ` +
    `p90=${percentile(samples as any, 0.9).toFixed(2)} ` +
    `p99=${percentile(samples as any, 0.99).toFixed(2)} ` +
    `p99.9=${percentile(samples as any, 0.999).toFixed(2)}`
  );
}

// Runner

function runSuite(title: string, routes: string[], paths: string[]): void {
  console.log(`\n===== ${title} =====`);

  const routers: Record<string, RouterInstance> = {
    FindMyWay: new FindMyWayRouter() as RouterInstance,
    Trie: new TrieRouter() as RouterInstance,
    HonoTrieRouter: new HonoTrieRouter() as RouterInstance,
  };

  console.log("\n--- Insertion Phase ---");
  for (const [name, r] of Object.entries(routers)) {
    benchmarkInsert(r, routes, name);
  }

  console.log("\n--- Lookup Phase ---");
  for (const [name, r] of Object.entries(routers)) {
    benchmarkLookup(r, paths, name);
  }

  console.log("\n--- Parameter Access Phase ---");
  for (const [name, r] of Object.entries(routers)) {
    benchmarkParamAccess(r, paths, name);
  }

  console.log("\n--- Latency Phase ---");
  for (const [name, r] of Object.entries(routers)) {
    latencyTest(r, paths, name);
  }
}

// Execute — static, then param, then wildcard, in that order.

runSuite("STATIC ROUTES", makeStaticRoutes(NUM_ROUTES), makeStaticLookupPaths(NUM_ROUTES));
runSuite("PARAMETER ROUTES", makeParamRoutes(NUM_ROUTES), makeParamLookupPaths(NUM_ROUTES));
runSuite("WILDCARD ROUTES", makeWildcardRoutes(NUM_ROUTES), makeWildcardLookupPaths(NUM_ROUTES));
