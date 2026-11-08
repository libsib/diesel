// ──────────────────────────────────────────────
//  Remote HTTP benchmark (real network, over the wire)
//
//  Usage:
//    TARGET=http://139.99.91.212:3000 FRAMEWORK=diesel k6 run k6-http.js
//
//  Env:
//    TARGET      base url, required        e.g. http://139.99.91.212:3000
//    FRAMEWORK   label for the report      default: "unknown"
//    MODE        latency|vus|ramp|smoke    default: vus
//    VUS         concurrent connections    default: 100   (mode=vus)
//    DURATION    test length               default: 20s   (mode=vus/latency)
//    RATE_MAX    peak req/s to push for    default: 20000 (mode=ramp)
//    ROUTE       path, route name, or mix  default: /user/123
//    SLEEP       think time in seconds     default: 0
//    OUT         write json summary here   default: none
// ──────────────────────────────────────────────

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend } from 'k6/metrics'

const TARGET = (__ENV.TARGET || '').replace(/\/+$/, '')
if (!TARGET) {
  throw new Error('TARGET is required, e.g. TARGET=http://139.99.91.212:3000')
}

const FRAMEWORK = __ENV.FRAMEWORK || 'unknown'
const MODE = __ENV.MODE || 'vus'
const VUS = parseInt(__ENV.VUS || '100')
const DURATION = __ENV.DURATION || '20s'
const RATE_MAX = parseInt(__ENV.RATE_MAX || '20000')
const THINK = parseFloat(__ENV.SLEEP || '0')
const OUT = __ENV.OUT || ''

// the 8 endpoints both diesel and hono expose identically
const POST_BODY = JSON.stringify({ name: "pradeep", email: "a@b.c", age: 30 });

const ALL_ROUTES = [
  { name: 'root', method: 'GET', path: '/', label: 'GET  /                      (small json)' },
  { name: 'param', method: 'GET', path: '/user/123', label: 'GET  /user/:id              (text, 1 param)' },
  { name: 'named', method: 'GET', path: '/users/pradeep', label: 'GET  /users/:name           (text, 1 param)' },
  { name: 'two_param', method: 'GET', path: '/user/123/post/456', label: 'GET  /user/:id/post/:postId (json, 2 params)' },
  { name: 'query', method: 'GET', path: '/api/search?q=phone&page=2&limit=5', label: 'GET  /api/search            (query parsing)' },
  {
    name: 'headers', method: 'GET', path: '/api/headers',
    label: 'GET  /api/headers           (header reads)',
    headers: { authorization: 'Bearer benchmark-token', 'user-agent': 'k6-remote-bench' },
  },
  { name: 'items', method: 'GET', path: '/api/items', label: 'GET  /api/items             (~5.5KB payload)' },
  {
    name: 'post_body', method: 'POST', path: '/api/user',
    label: 'POST /api/user              (json body parse)',
    body: POST_BODY,
    headers: { 'content-type': 'application/json' },
    expect: 201,
  },
]

const ROUTE = __ENV.ROUTE || '/user/123'

function resolveRoutes () {
  if (ROUTE === 'all' || ROUTE === 'mix') return ALL_ROUTES
  const byName = ALL_ROUTES.find((r) => r.name === ROUTE)
  if (byName) return [byName]
  const byPath = ALL_ROUTES.find((r) => r.path === ROUTE)
  if (byPath) return [byPath]
  if (ROUTE.startsWith('/')) return [{ name: 'custom', method: 'GET', path: ROUTE, label: `GET  ${ROUTE}` }]
  throw new Error(`unknown ROUTE "${ROUTE}" — use a path, "all", or one of: ${ALL_ROUTES.map((r) => r.name).join(', ')}`)
}

// k6 metric names allow only letters, numbers and underscores
function metricKey (name) {
  return 'route_' + name.replace(/[^A-Za-z0-9_]/g, '_')
}

const ROUTES = resolveRoutes().map((r) => ({ ...r, key: metricKey(r.name) }))
const ROUTE_LABEL = ROUTES.length > 1 ? `all ${ROUTES.length} endpoints` : ROUTES[0].path

// per-route latency, so a slow route can't hide behind a fast one
const routeTrends = {}
for (const r of ROUTES) routeTrends[r.key] = new Trend(r.key, true)

function scenarios () {
  switch (MODE) {
    // one connection, one request at a time — pure round-trip baseline
    case 'latency':
      return { latency: { executor: 'constant-vus', vus: 1, duration: DURATION } }

    // closed model: N connections hammering flat out — "capacity at this concurrency"
    case 'vus':
      return { load: { executor: 'constant-vus', vus: VUS, duration: DURATION } }

    // open model: push req/s up until it stops keeping up — finds the knee
    case 'ramp':
      return {
        ramp: {
          executor: 'ramping-arrival-rate',
          startRate: Math.max(100, Math.floor(RATE_MAX / 20)),
          timeUnit: '1s',
          preAllocatedVUs: 200,
          maxVUs: 2000,
          stages: [
            { target: Math.floor(RATE_MAX * 0.25), duration: '15s' },
            { target: Math.floor(RATE_MAX * 0.5), duration: '15s' },
            { target: Math.floor(RATE_MAX * 0.75), duration: '15s' },
            { target: RATE_MAX, duration: '15s' },
          ],
        },
      }

    case 'smoke':
      return { smoke: { executor: 'constant-vus', vus: 5, duration: '10s' } }

    default:
      throw new Error(`unknown MODE "${MODE}" — use latency, vus, ramp or smoke`)
  }
}

export const options = {
  scenarios: scenarios(),
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  // informational only; the runner does not treat these as fatal
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: false }],
  },
  // keep-alive on (default) — matches how real clients talk to an API
  noVUConnectionReuse: false,
  discardResponseBodies: false,
}

export default function () {
  for (let i = 0; i < ROUTES.length; i++) {
    const r = ROUTES[i]
    const want = r.expect || 200
    const res = http.request(r.method, TARGET + r.path, r.body || null, {
      headers: r.headers || {},
      tags: { route: r.name },
    })
    routeTrends[r.key].add(res.timings.duration)

    check(res, {
      [`status ${want}`]: (x) => x.status === want,
      'body non-empty': (x) => !!x.body && x.body.length > 0,
    }, { route: r.name })
  }
  if (THINK > 0) sleep(THINK)
}

// ── reporting ─────────────────────────────────

const C = { b: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', r: '\x1b[0m' }

// k6's JS runtime rejects toLocaleString's options arg, so group digits by hand
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
function bytes (n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${u[i]}`
}
function trend (m) {
  if (!m) return {}
  const v = m.values
  return { avg: v.avg, min: v.min, med: v.med, p90: v['p(90)'], p95: v['p(95)'], p99: v['p(99)'], max: v.max }
}

export function handleSummary (data) {
  const m = data.metrics
  const reqs = m.http_reqs ? m.http_reqs.values.count : 0
  const rps = m.http_reqs ? m.http_reqs.values.rate : 0
  const failRate = m.http_req_failed ? m.http_req_failed.values.rate : 0
  const failCount = Math.round(failRate * reqs)
  const lat = trend(m.http_req_duration)
  const wait = trend(m.http_req_waiting)
  const conn = trend(m.http_req_connecting)
  const dropped = m.dropped_iterations ? m.dropped_iterations.values.count : 0
  const checksRate = m.checks ? m.checks.values.rate : null
  const rx = m.data_received ? m.data_received.values.rate : 0
  const tx = m.data_sent ? m.data_sent.values.rate : 0

  const cfg = MODE === 'vus' ? `vus=${VUS}` : MODE === 'ramp' ? `peak=${RATE_MAX}/s` : MODE === 'latency' ? 'vus=1' : 'vus=5'

  const L = []
  L.push('')
  L.push(`${C.b}${C.cyan}━━ ${FRAMEWORK} ━━ ${ROUTE_LABEL} ━━ mode=${MODE} ${cfg} ━━━━━━━━━━━━━━${C.r}`)
  L.push(`  ${C.dim}target${C.r}        ${TARGET}`)
  L.push(`  ${C.b}requests${C.r}      ${num(reqs)}  ${C.b}${C.green}(${num(rps, 1)} req/s)${C.r}`)
  const failColor = failCount > 0 ? C.red : C.green
  L.push(`  failed        ${failColor}${(failRate * 100).toFixed(2)}%${C.r}  (${num(failCount)} of ${num(reqs)})`)
  L.push(`  ${C.b}latency${C.r}       avg ${ms(lat.avg)}   med ${ms(lat.med)}   p90 ${ms(lat.p90)}   p95 ${ms(lat.p95)}   p99 ${ms(lat.p99)}   max ${ms(lat.max)}`)
  L.push(`  server wait   avg ${ms(wait.avg)}   p95 ${ms(wait.p95)}   p99 ${ms(wait.p99)}`)
  L.push(`  tcp connect   avg ${ms(conn.avg)}   max ${ms(conn.max)}`)
  L.push(`  bandwidth     ↓ ${bytes(rx)}/s   ↑ ${bytes(tx)}/s`)
  if (checksRate !== null) {
    const ck = checksRate === 1 ? C.green : C.red
    L.push(`  checks        ${ck}${(checksRate * 100).toFixed(2)}% passed${C.r}`)
  }
  if (dropped > 0) {
    L.push(`  ${C.yellow}dropped       ${num(dropped)} iterations — server could not keep up with the target rate${C.r}`)
  }
  if (ROUTES.length > 1) {
    L.push(`  ${C.dim}per route${C.r}`)
    for (const r of ROUTES) {
      const t = trend(m[r.key])
      L.push(`    ${r.label.padEnd(44)} avg ${ms(t.avg)}   med ${ms(t.med)}   p95 ${ms(t.p95)}   p99 ${ms(t.p99)}`)
    }
  }
  L.push('')

  const out = { stdout: L.join('\n') }

  if (OUT) {
    const perRoute = {}
    for (const r of ROUTES) perRoute[r.path] = trend(m[r.key])
    out[OUT] = JSON.stringify({
      framework: FRAMEWORK,
      target: TARGET,
      mode: MODE,
      route: ROUTE_LABEL,
      vus: MODE === 'vus' ? VUS : MODE === 'latency' ? 1 : null,
      rateMax: MODE === 'ramp' ? RATE_MAX : null,
      duration: DURATION,
      timestamp: new Date().toISOString(),
      requests: reqs,
      rps,
      failRate,
      failCount,
      droppedIterations: dropped,
      checksRate,
      latency: lat,
      waiting: wait,
      connecting: conn,
      dataReceivedRate: rx,
      dataSentRate: tx,
      perRoute,
    }, null, 2)
  }

  return out
}
