const ITER = 20_000_000;
const TRIALS = 9;

type MatchedRoute = { handler?: (() => void) | undefined };

function makeRoutes(hitRate: number): MatchedRoute[] {
  const routes: MatchedRoute[] = [];
  for (let i = 0; i < 1000; i++) {
    routes.push(i / 1000 < hitRate ? { handler: () => {} } : {});
  }
  return routes;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

type Check = { name: string; run: (routes: MatchedRoute[]) => number };

const checks: Check[] = [
  {
    name: "if (!matched.handler)",
    run: (routes) => {
      let count = 0;
      for (let i = 0; i < ITER; i++) {
        if (!routes[i % routes.length].handler) count++;
      }
      return count;
    },
  },
  {
    name: "if (matched.handler === undefined)",
    run: (routes) => {
      let count = 0;
      for (let i = 0; i < ITER; i++) {
        if (routes[i % routes.length].handler === undefined) count++;
      }
      return count;
    },
  },
  {
    name: "if (matched.handler)",
    run: (routes) => {
      let count = 0;
      for (let i = 0; i < ITER; i++) {
        if (routes[i % routes.length].handler) count++;
      }
      return count;
    },
  },
  {
    name: "if (matched.handler !== undefined)",
    run: (routes) => {
      let count = 0;
      for (let i = 0; i < ITER; i++) {
        if (routes[i % routes.length].handler !== undefined) count++;
      }
      return count;
    },
  },
];

function runScenario(label: string, routes: MatchedRoute[]) {
  console.log(`\n--- ${label} ---`);

  const samples: Record<string, number[]> = {};
  const lastSink: Record<string, number> = {};
  for (const c of checks) samples[c.name] = [];

  // Interleave trials round-robin across checks so no single check
  // is unfairly biased by CPU thermal ramp / GC pauses / OS scheduling.
  for (let t = 0; t < TRIALS; t++) {
    for (const c of checks) {
      const start = performance.now();
      const sink = c.run(routes);
      const elapsed = performance.now() - start;
      samples[c.name].push(elapsed);
      lastSink[c.name] = sink;
    }
  }

  // Fixed order, grouped as negative pair then positive pair, so it's
  // clear all four checks ran and which ones are counterparts.
  console.log("negation form (checking handler is MISSING):");
  for (const name of ["if (!matched.handler)", "if (matched.handler === undefined)"]) {
    console.log(
      `  ${name}: ${median(samples[name]).toFixed(2)} ms (median of ${TRIALS}, sink=${lastSink[name]})`,
    );
  }
  console.log("positive form (checking handler IS PRESENT):");
  for (const name of ["if (matched.handler)", "if (matched.handler !== undefined)"]) {
    console.log(
      `  ${name}: ${median(samples[name]).toFixed(2)} ms (median of ${TRIALS}, sink=${lastSink[name]})`,
    );
  }
}

console.log("Warming up...");
const warmupRoutes = makeRoutes(0.5);
for (let i = 0; i < 200_000; i++) {
  const m = warmupRoutes[i % warmupRoutes.length];
  if (!m.handler) {}
  if (m.handler === undefined) {}
  if (m.handler) {}
  if (m.handler !== undefined) {}
}
for (const c of checks) c.run(warmupRoutes);

console.log("Starting benchmarks");

runScenario("90% routes have a handler", makeRoutes(0.9));
runScenario("50% routes have a handler", makeRoutes(0.5));
runScenario("10% routes have a handler", makeRoutes(0.1));

console.log("\nDone.");
