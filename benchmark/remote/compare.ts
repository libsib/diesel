// ──────────────────────────────────────────────
//  Compare remote benchmark results
//
//    bun run compare.ts [resultsDir]
//
//  Over a real network most runs are bound by round-trip time or by the client,
//  not by the framework. Each level is classified so a network artifact is not
//  read as a framework win.
// ──────────────────────────────────────────────

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

interface Stats {
  avg: number; min: number; med: number;
  p90: number; p95: number; p99: number; max: number;
}

interface Result {
  framework: string;
  target: string;
  mode: string;
  route: string;
  vus: number | null;
  duration: string;
  timestamp: string;
  requests: number;
  rps: number;
  failRate: number;
  failCount: number;
  droppedIterations: number;
  checksRate: number | null;
  latency: Stats;
  waiting: Stats;
  connecting: Stats;
  dataReceivedRate: number;
  perRoute: Record<string, Stats>;
}

const C = {
  b: "\x1b[1m", dim: "\x1b[2m", cyan: "\x1b[36m", green: "\x1b[32m",
  red: "\x1b[31m", yellow: "\x1b[33m", r: "\x1b[0m",
};

const dir = process.argv[2] || join(import.meta.dir, "results");
if (!existsSync(dir)) {
  console.error(`no results directory at ${dir}`);
  process.exit(1);
}

const results: Result[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => {
    try {
      return JSON.parse(readFileSync(join(dir, f), "utf8")) as Result;
    } catch {
      console.error(`${C.yellow}skipping unreadable ${f}${C.r}`);
      return null;
    }
  })
  .filter((r): r is Result => r !== null);

if (results.length === 0) {
  console.error(`no results found in ${dir}`);
  process.exit(1);
}

const num = (n: number, d = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const ms = (n: number) =>
  n === undefined || n === null || isNaN(n) ? "—" : n < 10 ? `${n.toFixed(2)}ms` : `${n.toFixed(1)}ms`;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB/s`;
const pad = (s: string, w: number) => s.padStart(w);

const frameworks = [...new Set(results.map((r) => r.framework))].sort();
const loadRuns = results.filter((r) => r.mode === "vus");
const baselines = results.filter((r) => r.mode === "latency");
const levels = [...new Set(loadRuns.map((r) => r.vus!))].sort((a, b) => a - b);
const pick = (fw: string, vus: number) => loadRuns.find((r) => r.framework === fw && r.vus === vus);

// round-trip floor: the 1-connection baseline, else the fastest median seen
const baseMed = baselines.length > 0
  ? Math.min(...baselines.map((b) => b.latency.med))
  : Math.min(...loadRuns.map((r) => r.latency.med));

type Verdict = "rtt" | "saturated" | "usable";

// A level only measures the framework if the network is neither the floor nor
// the ceiling: latency must have risen above pure RTT (so the server is doing
// real queueing work) without the client/link falling apart.
function classify(r: Result): Verdict {
  const saturated =
    r.failRate > 0 ||
    r.droppedIterations > 0 ||
    r.connecting.avg > 5 ||
    r.latency.p99 > baseMed * 10;
  if (saturated) return "saturated";
  if (r.latency.med < baseMed * 1.3) return "rtt";
  return "usable";
}

const VERDICT_LABEL: Record<Verdict, string> = {
  rtt: `${C.dim}rtt-bound${C.r}`,
  saturated: `${C.red}saturated${C.r}`,
  usable: `${C.green}usable${C.r}`,
};
const VERDICT_PLAIN: Record<Verdict, string> = { rtt: "rtt-bound", saturated: "saturated", usable: "usable" };

// ── network baseline ──────────────────────────
if (baselines.length > 0) {
  console.log(`\n${C.b}${C.cyan}Network baseline${C.r} ${C.dim}(1 connection, serial — the floor you can't beat)${C.r}`);
  console.log(`${C.dim}  ${"framework".padEnd(10)}${pad("req/s", 10)}${pad("avg", 11)}${pad("med", 11)}${pad("p99", 11)}${C.r}`);
  for (const b of [...baselines].sort((x, y) => x.framework.localeCompare(y.framework))) {
    console.log(
      `  ${b.framework.padEnd(10)}${pad(num(b.rps, 0), 10)}` +
      `${pad(ms(b.latency.avg), 11)}${pad(ms(b.latency.med), 11)}${pad(ms(b.latency.p99), 11)}`
    );
  }
  const spread = Math.max(...baselines.map((b) => b.latency.med)) - Math.min(...baselines.map((b) => b.latency.med));
  if (baselines.length >= 2 && spread < 2) {
    console.log(`  ${C.dim}baselines within ${spread.toFixed(2)}ms of each other — this is the link, not the frameworks${C.r}`);
  }
}

// ── per-framework sweep ───────────────────────
for (const fw of frameworks) {
  const runs = loadRuns.filter((r) => r.framework === fw).sort((a, b) => a.vus! - b.vus!);
  if (runs.length === 0) continue;

  console.log(`\n${C.b}${C.cyan}${fw}${C.r} ${C.dim}— ${runs[0].route} @ ${runs[0].target}${C.r}`);
  console.log(
    `${C.dim}  ${pad("conns", 6)}${pad("req/s", 11)}${pad("avg", 10)}${pad("med", 10)}` +
    `${pad("p95", 10)}${pad("p99", 10)}${pad("fail", 8)}${pad("↓", 12)}   verdict${C.r}`
  );

  const best = Math.max(...runs.map((r) => r.rps));
  for (const r of runs) {
    const v = classify(r);
    const rps = pad(num(r.rps, 0), 11);
    const fail = r.failRate > 0
      ? pad(`${C.red}${(r.failRate * 100).toFixed(2)}%${C.r}`, 8 + C.red.length + C.r.length)
      : pad("0%", 8);
    console.log(
      `  ${pad(String(r.vus), 6)}${r.rps === best ? C.b + C.green + rps + C.r : rps}` +
      `${pad(ms(r.latency.avg), 10)}${pad(ms(r.latency.med), 10)}` +
      `${pad(ms(r.latency.p95), 10)}${pad(ms(r.latency.p99), 10)}` +
      `${fail}${pad(mb(r.dataReceivedRate), 12)}   ${VERDICT_LABEL[v]}`
    );
  }

  const peak = runs.find((r) => r.rps === best)!;
  const peakV = classify(peak);
  console.log(
    `  ${C.dim}peak ${num(best, 0)} req/s at ${peak.vus} connections` +
    `${peakV !== "usable" ? ` — but that level is ${VERDICT_PLAIN[peakV]}, so treat it as a link limit` : ""}${C.r}`
  );
}

// ── head to head ──────────────────────────────
if (frameworks.length >= 2) {
  const [a, b] = frameworks;
  console.log(`\n${C.b}${C.cyan}Head to head${C.r} ${C.dim}— ${a} vs ${b}${C.r}`);
  console.log(
    `${C.dim}  ${pad("conns", 6)}${pad(a + " req/s", 15)}${pad(b + " req/s", 15)}` +
    `${pad("winner", 10)}${pad("margin", 9)}   comparable?${C.r}`
  );

  const usable: { vus: number; margin: number; winner: string }[] = [];

  for (const vus of levels) {
    const ra = pick(a, vus);
    const rb = pick(b, vus);
    if (!ra || !rb) continue;

    const va = classify(ra);
    const vb = classify(rb);
    const comparable = va === "usable" && vb === "usable";

    const winner = ra.rps >= rb.rps ? a : b;
    const hi = Math.max(ra.rps, rb.rps);
    const lo = Math.min(ra.rps, rb.rps);
    const margin = lo > 0 ? ((hi - lo) / lo) * 100 : 0;
    if (comparable) usable.push({ vus, margin, winner });

    const note = comparable
      ? `${C.green}yes${C.r}`
      : `${C.yellow}no — ${a}:${VERDICT_PLAIN[va]} ${b}:${VERDICT_PLAIN[vb]}${C.r}`;

    console.log(
      `  ${pad(String(vus), 6)}${pad(num(ra.rps, 0), 15)}${pad(num(rb.rps, 0), 15)}` +
      `${comparable ? (winner === a ? C.green : C.yellow) : C.dim}${pad(winner, 10)}${C.r}` +
      `${pad(`+${margin.toFixed(1)}%`, 9)}   ${note}`
    );
  }

  console.log("");
  if (usable.length === 0) {
    console.log(`  ${C.b}${C.yellow}No level separated the two frameworks.${C.r}`);
    console.log(`  ${C.dim}Every level was either bound by round-trip time (both frameworks answer`);
    console.log(`  long before the packet returns) or ran past what the client/link can sustain.`);
    console.log(`  The req/s above describe your network, not diesel vs hono.${C.r}`);
    console.log("");
    console.log(`  ${C.b}To measure the frameworks, drive load from inside the VPS${C.r} ${C.dim}(removes ~${baseMed.toFixed(0)}ms of RTT):${C.r}`);
    console.log(`    ${C.dim}# on the VPS${C.r}`);
    console.log(`    TARGET=http://127.0.0.1:3000 FRAMEWORK=diesel MODE=vus VUS=100 k6 run k6-http.js`);
    console.log(`    TARGET=http://127.0.0.1:3001 FRAMEWORK=hono   MODE=vus VUS=100 k6 run k6-http.js`);
    console.log(`  ${C.dim}Keep this remote test for what it is good at: confirming both stacks behave`);
    console.log(`  correctly and stay stable for real clients at real latency.${C.r}`);
  } else {
    const avg = usable.reduce((s, u) => s + (u.winner === a ? u.margin : -u.margin), 0) / usable.length;
    const overall = avg >= 0 ? a : b;
    const aWins = usable.filter((u) => u.winner === a).length;
    console.log(`  ${C.b}Comparable levels: ${usable.map((u) => "c" + u.vus).join(", ")}${C.r}`);
    console.log(`  ${C.b}${a} won ${aWins}/${usable.length}, ${b} won ${usable.length - aWins}/${usable.length}${C.r}`);
    if (Math.abs(avg) < 5) {
      console.log(`  ${C.b}Average margin ${Math.abs(avg).toFixed(1)}% — inside run-to-run noise, call it a tie.${C.r}`);
    } else {
      console.log(`  ${C.b}${overall} is ${Math.abs(avg).toFixed(1)}% faster across the comparable levels.${C.r}`);
    }
    const skipped = levels.length - usable.length;
    if (skipped > 0) {
      console.log(`  ${C.dim}${skipped} level(s) excluded as rtt-bound or saturated.${C.r}`);
    }
  }
}

console.log(`\n${C.dim}Raw results: ${dir}${C.r}\n`);
