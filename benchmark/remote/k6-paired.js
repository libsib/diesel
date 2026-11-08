// ──────────────────────────────────────────────
//  Paired head-to-head: diesel vs hono, same instant, same link
//
//  Sequential runs can't separate these two — run-to-run network drift (we saw
//  49ms → 62ms → 58ms RTT on the same box) is larger than the gap being
//  measured. This hits BOTH servers inside one iteration, so every comparison
//  is a matched pair sharing the same network conditions. The per-pair
//  difference is recorded directly, which cancels the drift instead of
//  averaging over it.
//
//  Usage:
//    DIESEL_URL=http://IP:3000 HONO_URL=http://IP:3001 VUS=100 DURATION=20s \
//      k6 run --quiet k6-paired.js
// ──────────────────────────────────────────────

import http from 'k6/http'
import { check } from 'k6'
import { Trend, Counter } from 'k6/metrics'
import exec from 'k6/execution'

const DIESEL_URL = (__ENV.DIESEL_URL || '').replace(/\/+$/, '')
const HONO_URL = (__ENV.HONO_URL || '').replace(/\/+$/, '')
if (!DIESEL_URL || !HONO_URL) {
  throw new Error('DIESEL_URL and HONO_URL are both required')
}

const VUS = parseInt(__ENV.VUS || '100')
const DURATION = __ENV.DURATION || '20s'
const OUT = __ENV.OUT || ''

const POST_BODY = JSON.stringify({ name: 'pradeep', email: 'a@b.c', age: 30 })

const ROUTES = [
  { name: 'root', method: 'GET', path: '/', label: 'GET  /                       (small json)' },
  { name: 'param', method: 'GET', path: '/user/123', label: 'GET  /user/:id               (text, 1 param)' },
  { name: 'named', method: 'GET', path: '/users/pradeep', label: 'GET  /users/:name            (text, 1 param)' },
  { name: 'two_param', method: 'GET', path: '/user/123/post/456', label: 'GET  /user/:id/post/:postId  (json, 2 params)' },
  { name: 'query', method: 'GET', path: '/api/search?q=phone&page=2&limit=5', label: 'GET  /api/search             (query parsing)' },
  {
    name: 'headers', method: 'GET', path: '/api/headers',
    label: 'GET  /api/headers            (header reads)',
    headers: { authorization: 'Bearer benchmark-token', 'user-agent': 'k6-paired-bench' },
  },
  { name: 'items', method: 'GET', path: '/api/items', label: 'GET  /api/items              (~5.5KB payload)' },
  {
    name: 'post_body', method: 'POST', path: '/api/user',
    label: 'POST /api/user               (json body parse)',
    body: POST_BODY, headers: { 'content-type': 'application/json' }, expect: 201,
  },
]

// per route: latency for each side, the paired difference, and a win tally
const M = {}
for (const r of ROUTES) {
  M[r.name] = {
    diesel: new Trend(`d_${r.name}`, true),
    hono: new Trend(`h_${r.name}`, true),
    delta: new Trend(`delta_${r.name}`, true), // diesel - hono, per pair
    dieselWins: new Counter(`win_d_${r.name}`),
    honoWins: new Counter(`win_h_${r.name}`),
  }
}

export const options = {
  scenarios: { paired: { executor: 'constant-vus', vus: VUS, duration: DURATION } },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: { http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: false }] },
}

function fire (base, r) {
  return http.request(r.method, base + r.path, r.body || null, {
    headers: r.headers || {},
    tags: { route: r.name },
  })
}

export default function () {
  // alternate which server goes first, so neither gets a systematic
  // advantage from being the warm/second request in the pair
  const dieselFirst = exec.scenario.iterationInTest % 2 === 0

  for (const r of ROUTES) {
    const want = r.expect || 200
    let dRes, hRes

    if (dieselFirst) {
      dRes = fire(DIESEL_URL, r)
      hRes = fire(HONO_URL, r)
    } else {
      hRes = fire(HONO_URL, r)
      dRes = fire(DIESEL_URL, r)
    }

    const m = M[r.name]
    const dOk = dRes.status === want
    const hOk = hRes.status === want

    check(dRes, { [`diesel ${want}`]: () => dOk }, { route: r.name })
    check(hRes, { [`hono ${want}`]: () => hOk }, { route: r.name })

    m.diesel.add(dRes.timings.duration)
    m.hono.add(hRes.timings.duration)

    // only a clean pair is a valid comparison
    if (dOk && hOk) {
      m.delta.add(dRes.timings.duration - hRes.timings.duration)
      if (dRes.timings.duration < hRes.timings.duration) m.dieselWins.add(1)
      else m.honoWins.add(1)
    }
  }
}

// ── reporting ─────────────────────────────────

const C = { b: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', r: '\x1b[0m' }

function num (n, d = 0) {
  if (n === undefined || n === null || isNaN(n)) return '—'
  const parts = n.toFixed(d).split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}
function ms (n) {
  if (n === undefined || n === null || isNaN(n)) return '—'
  return n < 10 ? `${n.toFixed(2)}ms` : `${n.toFixed(1)}ms`
}
function pad (s, w) { return String(s).padStart(w) }

export function handleSummary (data) {
  const m = data.metrics
  const get = (k) => (m[k] ? m[k].values : null)

  const L = []
  L.push('')
  L.push(`${C.b}${C.cyan}━━ PAIRED head-to-head ━━ ${VUS} connections ━━ ${DURATION} ━━━━━━━━━━━━━━${C.r}`)
  L.push(`  ${C.dim}diesel  ${DIESEL_URL}${C.r}`)
  L.push(`  ${C.dim}hono    ${HONO_URL}${C.r}`)
  const reqs = get('http_reqs')
  const failed = get('http_req_failed')
  L.push(`  ${C.dim}${num(reqs ? reqs.count : 0)} requests total, ${((failed ? failed.rate : 0) * 100).toFixed(2)}% failed${C.r}`)
  L.push('')
  L.push(`  ${C.dim}${'endpoint'.padEnd(45)}${pad('diesel', 10)}${pad('hono', 10)}${pad('Δ paired', 11)}${pad('diesel wins', 13)}${pad('signal', 9)}${C.r}`)

  const rows = []
  for (const r of ROUTES) {
    const d = get(`d_${r.name}`)
    const h = get(`h_${r.name}`)
    const dl = get(`delta_${r.name}`)
    const dw = get(`win_d_${r.name}`)
    const hw = get(`win_h_${r.name}`)
    if (!d || !h || !dl) continue

    const wins = dw ? dw.count : 0
    const losses = hw ? hw.count : 0
    const total = wins + losses
    const winPct = total > 0 ? (wins / total) * 100 : 0
    const deltaMed = dl.med

    // How far is this win rate from a coin flip? With ~2000 pairs per route a
    // 53% rate is already many standard errors out, so judge by z, not by a
    // flat percentage cutoff.
    const z = total > 0 ? (winPct / 100 - 0.5) / Math.sqrt(0.25 / total) : 0
    const decisive = Math.abs(z) >= 3
    const faster = deltaMed < 0 ? 'diesel' : 'hono'

    rows.push({ route: r.name, label: r.label, deltaMed, deltaAvg: dl.avg, winPct, total, z, decisive, faster, dMed: d.med, hMed: h.med })

    const dc = deltaMed < 0 ? C.green : C.yellow
    const wc = decisive ? (winPct > 50 ? C.green : C.yellow) : C.dim
    L.push(
      `  ${r.label.padEnd(45)}${pad(ms(d.med), 10)}${pad(ms(h.med), 10)}` +
      `${dc}${pad((deltaMed >= 0 ? '+' : '') + deltaMed.toFixed(2) + 'ms', 11)}${C.r}` +
      `${wc}${pad(winPct.toFixed(1) + '%', 13)}${C.r}` +
      `${decisive ? C.b : C.dim}${pad(z.toFixed(1) + 'σ', 9)}${C.r}`
    )
  }

  L.push('')
  L.push(`  ${C.dim}Δ paired = median of (diesel − hono) measured within the same iteration.${C.r}`)
  L.push(`  ${C.dim}negative → diesel faster. "diesel wins" = share of pairs diesel won;${C.r}`)
  L.push(`  ${C.dim}~50% means the two are indistinguishable on that endpoint.${C.r}`)
  L.push('')

  const favD = rows.filter((x) => x.deltaMed < 0).length
  const favH = rows.length - favD
  const meanDelta = rows.reduce((a, x) => a + x.deltaMed, 0) / (rows.length || 1)
  const decisiveRows = rows.filter((x) => x.decisive)
  const consistent = rows.length > 0 && (favD === rows.length || favH === rows.length)

  if (consistent) {
    const winner = favD === rows.length ? 'diesel' : 'hono'
    const wc = winner === 'diesel' ? C.green : C.yellow
    // all endpoints landing on one side is (1/2)^n by chance
    const pAll = 2 * Math.pow(0.5, rows.length)
    L.push(`  ${C.b}Verdict: ${wc}${winner}${C.r}${C.b} is ahead on all ${rows.length} endpoints${C.r}`)
    L.push(`  ${C.dim}median edge ${Math.abs(meanDelta).toFixed(2)}ms; ${decisiveRows.length}/${rows.length} endpoints past 3σ.${C.r}`)
    L.push(`  ${C.dim}All ${rows.length} landing on one side is p=${pAll.toFixed(4)} by chance — the effect is real.${C.r}`)
    L.push('')
    L.push(`  ${C.yellow}But mind the size:${C.r} ${C.dim}these handlers take ~0.05ms locally, so a ${Math.abs(meanDelta).toFixed(2)}ms`)
    L.push(`  gap is far too big to be handler code. Suspect a per-process or per-port`)
    L.push(`  asymmetry on the box instead. To tell those apart, swap the ports`)
    L.push(`  (diesel on 3001, hono on 3000) and rerun: if the edge follows the`)
    L.push(`  framework it is real, if it follows the port it is an artifact.${C.r}`)
  } else if (decisiveRows.length === 0) {
    L.push(`  ${C.b}${C.yellow}Verdict: no endpoint separated them.${C.r}`)
    L.push(`  ${C.dim}Win rates sat within noise of 50% and the sides are split`)
    L.push(`  ${favD} / ${favH}. Even with the network cancelled out by pairing,`)
    L.push(`  diesel and hono are the same speed here.${C.r}`)
  } else {
    L.push(`  ${C.b}Verdict: mixed — ${decisiveRows.length}/${rows.length} endpoints past 3σ, sides split ${favD}/${favH}${C.r}`)
    for (const x of decisiveRows) {
      const w = x.faster === 'diesel' ? `${C.green}diesel${C.r}` : `${C.yellow}hono${C.r}`
      L.push(`    ${x.route.padEnd(12)} ${w} by ${Math.abs(x.deltaMed).toFixed(2)}ms (${x.z.toFixed(1)}σ)`)
    }
  }
  L.push('')

  const out = { stdout: L.join('\n') }
  if (OUT) {
    out[OUT] = JSON.stringify({
      mode: 'paired', dieselUrl: DIESEL_URL, honoUrl: HONO_URL,
      vus: VUS, duration: DURATION, timestamp: new Date().toISOString(),
      totalRequests: reqs ? reqs.count : 0, failRate: failed ? failed.rate : 0,
      rows,
    }, null, 2)
  }
  return out
}
