# Changelog

## 3.5.5

A security- and correctness-focused release. Six middleware/adaptor fixes, several of which close auth-bypass and spoofing vectors. No breaking API changes, but a few security-motivated behaviour changes are called out below.

### Security & Fixes

- **core: stop echoing request headers in error responses (#147, closes #153).** Error responses no longer copy the client's request headers (`Cookie`, `Authorization`, ...) when the handler set none; only response headers are kept and `Content-Type` matches the error format. `use()` now supports the documented array forms (`use([mw])`, `use(path, [mw])`, `use([paths], mw)`) and throws a `TypeError` on bad input instead of silently registering nothing. `route()` applies the child's global middleware to every child route under the base path (previously `child.use(auth); app.route("/api", child)` left `/api/x` unprotected). `onSend` now runs after the not-found/static fallback so hooks always receive the final `Response`.

- **jwt: close auth bypasses (#144, closes #150).** `authenticateJwtDB` with no `routes` now protects every route (it previously never ran). Protected-route matching uses the normalized router path (`ctx.path`), so `/admin/`, `//admin` and `/%61dmin` no longer skip auth. The `authenticateJwtDB` wrapper is now `async`, so `pipelineArchitecture: true` awaits it. An empty `accessToken` cookie no longer overrides `Authorization: Bearer`; the `Bearer` scheme is matched case-insensitively; a missing user returns 401, not 404. `jwt.verify` only accepts HMAC algorithms (HS256/384/512).

- **ratelimit: key on socket IP, per-instance store, atomic incr (#145, closes #151).** **Behaviour change:** `rateLimit()` now keys on the socket IP (`server.requestIP(req)`) instead of the first `X-Forwarded-For` entry, which any client could randomize to bypass the limit. `X-Forwarded-For` / `CF-Connecting-IP` are no longer read by default — behind a proxy you control set `trustProxy: true` (uses the right-most XFF hop), or pass a `keyGenerator`. The in-memory counter Map is now per `rateLimit()` instance, so different routes no longer share counts. `max: 0` now blocks the first request. New optional `RateLimitStore.incr(key, ttlMs)`; `RedisStore` implements it with `INCR` + `PEXPIRE` only on the first hit, fixing the read-then-write race and the TTL being refreshed on every hit.

- **node adaptor: error handling, PUT bodies, disconnect abort, proxy trust (#146, closes #152).** Handler/stream errors are caught (500 if headers not sent, otherwise the socket is destroyed) instead of an unhandled rejection + hung socket. Malformed `Host`/request target → 400; absolute-form targets (`GET http://h/x`) parse correctly. PUT request bodies are no longer dropped. `req.signal` aborts when the client disconnects, the response stream is cancelled, and `write()` backpressure is respected. `server.requestIP(req)` and `connInfo(req)` return the real socket address. **Behaviour change:** `X-Forwarded-Proto` / `X-Forwarded-For` are ignored unless `serve({ trustProxy: true })`.

- **cors: `Vary: Origin`, spec-correct preflight and credentials (#143, closes #149).** `Vary: Origin` is appended (existing `Vary` preserved) whenever the response depends on the request Origin, preventing shared caches/CDNs from serving one origin's `Access-Control-Allow-Origin` to another. OPTIONS is only answered as a 204 preflight when `Access-Control-Request-Method` is present. `Access-Control-Allow-Credentials` is only ever sent as `true`. `origin: "*"` with `credentials: true` now reflects the request Origin instead of the invalid `*` + credentials pair.

- **filter: segment-aware public route matching (#142, closes #148).** `filter()` public routes now match by path segment: `"/api"` covers `/api` and `/api/*` but not `/api-admin`. `publicRoutes: ["/"]` now only makes `/` public (it previously made every route public). Request paths and configured routes are normalized (duplicate/trailing slashes) before matching.

## 3.5.4

### Fixes

- **A request for `/__proto__`, `/constructor`, `/toString` or any other `Object.prototype` key crashed the router on the default (peepal) router.** From upgrading `peepal-router` `^0.6.1` → `^0.6.6`; the fix landed upstream in `0.6.4`. Trie node children were stored in a plain `{}`, so `children["__proto__"]` returned an inherited object instead of `undefined`, the walk stepped into it and threw on the next segment. `PeepalRouter.find()` (`src/router/interface.ts`) calls `search()`, which is affected at any depth, so every Diesel app on the default router was exposed. Reproduced against `0.6.1` on a table of `/user/:id` + `/health`:

  ```
  /__proto__      TypeError: Cannot read properties of undefined (reading 'GET')
  /constructor/y  TypeError: Cannot read properties of undefined (reading 'y')
  ```

  The throw happens inside `find()`, before the `.catch(handleError)` that wraps handler execution in `#handleRequests` — so it surfaced as an unhandled rejection rather than a 500. Any unauthenticated client could send these paths. On `0.6.5` they resolve cleanly to no handler and fall through to the 404 path.

### Performance

- **Roughly a wash on V8, ~1.15-1.25x on JSC for dynamic routes.** `search()` medians, 300k iterations x 11 reps, alternating order, node 24 and bun 1.4.1:

  | lookup | node (V8) | bun (JSC) |
  | --- | --- | --- |
  | `/api/v1/users/:id` | 1.04x | 1.14x |
  | `/api/v1/users/:id/posts/:postId` | 1.02x | 1.20x |
  | `/static/*` | 1.02x | 1.15x |
  | mixed static + dynamic | 0.98-1.05x | 1.18-1.25x |
  | all-static (21 paths cycled) | 0.86-0.94x | 0.95-0.99x |

  The dynamic-route gain is `0.6.4`'s direct `":"`/`"*"` child references, which replace a `children` dictionary lookup with a field read.

### Notes

- No Diesel API changes, and no routing behaviour changes for paths that already worked: the same request matches the same handler with the same params as on 3.5.3. The test suite is identical across the bump (181 pass, the same 4 pre-existing failures).
- **The upstream `0.6.5` static-cache claim does not reproduce here.** Its changelog reports +60% (V8) / +96% (JSC) on all-static traffic from backing the per-method static caches with `Object.create(null)` instead of `Map`. Measured through Diesel's own call shape, all-static traffic is flat-to-slightly-slower (0.86-0.94x on node, within noise on bun) — a `Map` hit and a null-prototype object hit are both ~5-7 ns and neither touches the trie. Treat the static-path numbers in this release as unchanged, not improved.
- The `Object.create(null)` change is still worth having for correctness rather than speed: the caches are keyed by raw request paths, so a plain `{}` would reintroduce the `/__proto__` bug at the cache layer.
- This bump **is** required for consumers to pick the fix up. The previous `^0.6.1` range already admits `0.6.6`, so fresh installs resolve to it anyway — but any lockfile pinned at `0.6.1` through `0.6.3` stays on a crashing router until the declared floor moves.
- The known param-name collision on diverging branches (`/user/:id/profile` + `/user/:name/settings` sharing a node) is still **not** fixed in `peepal-router@0.6.6` — the failing test in `src/router/interface.test.ts` continues to document it, alongside the same bug in our own `src/router/trie.ts`.

## 3.5.3

### Performance

- **Dynamic and wildcard route lookups on the default router are ~1.2-1.5x faster.** From upgrading `peepal-router` `^0.6.0` → `^0.6.1`, which adds a per-node `hasWildcardChild` flag so `children["*"]` is only probed on nodes that actually have a wildcard child, and hoists the double child lookup (once to test, once to assign) into a single local. Measured on node 24 / V8, `search()` medians over 400k iterations x 15 reps:

  | route | 0.6.0 | 0.6.1 | |
  | --- | --- | --- | --- |
  | `/api/v1/users/:id` | 63.1 ns | 52.9 ns | 1.19x |
  | `/api/v1/users/:id/posts/:postId` | 96.6 ns | 66.0 ns | 1.46x |
  | `/static/*` | 43.3 ns | 34.0 ns | 1.27x |

  Same direction but smaller under bun 1.4 / JSC (two-param ~1.20x, wildcard ~1.18x, single-param within noise). Static routes are unchanged (~4.5 ns node, ~3.0 ns bun) — they resolve from the 3.5.2 static cache and never walk the trie.

### Notes

- No Diesel API changes, and no routing behaviour changes: the same request matches the same handler with the same params as on 3.5.2.
- Unlike the 3.5.2 bump, this one is **not** required for consumers to pick the upgrade up. The existing `^0.6.0` range already admits `0.6.1`, so a fresh `diesel-core@3.5.2` install resolves to it anyway; this release only raises the declared floor so lockfiles pinned at `0.6.0` move.
- Two changes are called out as breaking upstream; neither reaches Diesel. The `Find` → `Result` type rename is types-only and `src/router/interface.ts` imports just `TrieRouter` (its `Find` is our own local interface). Lookups that collect no middleware now return a shared frozen empty array instead of allocating — we only ever iterate `matchedRouteHandler.middlewares` (`src/main.ts`, and the generated pipeline in `src/request_pipeline.ts`), never mutate it.
- The known param-name collision on diverging branches (`/user/:id/profile` + `/user/:name/settings` sharing a node) is still **not** fixed in `peepal-router@0.6.1` — the failing test in `src/router/interface.test.ts` continues to document it, alongside the same bug in our own `src/router/trie.ts`.

## 3.5.2

### Performance

- **Static route lookups on the default router are ~8x faster** (28.0 ns → 3.3 ns per `search()` on `/api/v1/orders/recent`; shorter paths like `/health` ~2.7x, 20.3 ns → 7.5 ns). This comes from upgrading `peepal-router` `^0.5.2` → `^0.6.0`, which adds a per-method static-path cache: routes registered without `:params` or `*` are resolved through a `Map` lookup instead of walking the trie segment by segment. `PeepalRouter.find()` (`src/router/interface.ts`) calls `search()`, so every Diesel app on the default router gets this with no code change. Dynamic/param routes are unaffected (~1.1x, still a trie walk).
- The cache is invalidated correctly when routes or middleware are added after the fact — `insert()` and `pushMiddleware()` rebuild the affected entries, and a lookup that misses is never cached, so it can't shadow the trie walk.

### Notes

- No Diesel API changes. This release exists only to move consumers onto `peepal-router@0.6.0`: the previous `^0.5.2` range excludes `0.6.x`, so existing `diesel-core@3.5.1` installs will never resolve to it on their own.
- The known param-name collision on diverging branches (`/user/:id/profile` + `/user/:name/settings` sharing a node) is **not** fixed in `peepal-router@0.6.0` — the failing test in `src/router/interface.test.ts` still documents it, alongside the same bug in our own `src/router/trie.ts`.

## 3.5.1

### Fixes

- **Node adaptor (`diesel-core/node`) dropped every `Set-Cookie` header but the last one.** `sendWebResToNodeRes` built the outgoing Node response headers with `Object.fromEntries(webRes.headers)`, which collapses repeated header names into a single object key — so a response setting both an `accessToken` and a `refreshToken` cookie only ever sent the last one to the client. Headers are now applied individually via `nodeRes.setHeader`, with all `Set-Cookie` values passed through together as an array (`webRes.headers.getSetCookie()`).
- **Node adaptor crashed on any request with a body** (`POST`/`DELETE`/etc.) with `TypeError: RequestInit: duplex option is required when sending a body`. `convertNodeReqToWebReq` attached a streaming `ReadableStream` body to the web `Request` without setting `duplex: 'half'`, which undici (Node's `fetch`/`Request` implementation) requires whenever a request has a streaming body. Body detection is now based on `Content-Length`/`Transfer-Encoding` rather than just excluding `GET`/`PUT`, and `duplex: 'half'` is set whenever a body stream is attached.

## 3.4.0

### Performance

- **`new Diesel()` construction is ~100x faster** (~7.1 µs → ~0.07 µs per instance). The 10 HTTP-verb methods (`get`/`post`/`put`/.../`all`) were previously re-created as per-instance closures inside the constructor on every single construction; they now live once on the prototype, shared across all instances. Matters most for apps that create many sub-routers, and for cold starts on serverless/edge runtimes (Workers, Lambda, Deno Deploy) where construction happens on every boot.
- `tempRoutes` is now lazily created on the first `addRoute()` call instead of eagerly allocated in the constructor, matching the existing `tempMiddlewares` pattern.
- Router handler-lookup checks (`matched.handler`) switched from truthy/falsy checks (`!x`, `if (x)`) to strict `undefined` checks (`=== undefined`, `!== undefined`) — a single identity comparison is cheaper than a check that has to account for every JS falsy value, since the router's `handler` field is only ever `Array<Function> | undefined`.
- `#execute_handlers` and the generated pipeline handler now skip the loop entirely when a route has exactly one handler (the common case).

### Breaking changes

- **`jwtSecret` removed from `DieselOptions`** (`new Diesel({ jwtSecret })` no longer does anything) and the `app.user_jwt_secret` field/`process.env.DIESEL_JWT_SECRET` fallback are gone. `authenticateJwt`/`authenticateJwtDB` (from `diesel-core/jwt`) now **require** `jwtSecret` to be passed directly in their own options — the same place you already pass the `jwt` library instance. Update `new Diesel({ jwtSecret: "..." })` + `authenticateJwt({ app, jwt })` to `new Diesel()` + `authenticateJwt({ app, jwt, jwtSecret: "..." })`.
- **Dead `postHandler` hook removed.** `app.addHooks("postHandler", fn)` was accepted and tracked internally but never actually invoked anywhere in the request pipeline — registering it silently did nothing. It's no longer a recognized hook type; calling `addHooks` with it now throws `Unknown hook type: postHandler` instead of quietly no-op'ing. If you need "after handler" behavior, use the `onSend` hook, which does run and can inspect/modify the outgoing response.

## 3.3.0

### Features

- **HEAD method support (RFC 9110).** A `HEAD` request to a path with no dedicated `HEAD` handler now falls back to the matching `GET` route instead of 404ing — middleware and hooks on that route still run as normal. An explicit `app.head(...)` registration, when present, still takes priority over the fallback. Wired into every dispatch path: `.fetch` and `cfFetch()`, under both the default and `pipelineArchitecture: true` execution modes.
- `ctx.text()`, `ctx.json()`, `ctx.send()`, `ctx.file()`, and `ctx.stream()` now all omit the response body when the request method is `HEAD`, regardless of which one built the response.

### Fixes

- The `HEAD`→`GET` fallback was initially guarded only by "no route matched", which meant *any* unmatched method (e.g. `DELETE`/`PUT` to a `GET`-only path) incorrectly ran the `GET` handler too. Restricted the fallback to `HEAD` requests specifically.

## 3.2.0

### Features

- **New `diesel-core/bun`, `diesel-core/deno`, and `diesel-core/cloudflare` adaptors** — each exports `connInfo(ctx)` for real client-IP resolution using the runtime's actual mechanism (Bun's `server.requestIP()`, Deno's `Deno.serve` `remoteAddr`, Cloudflare's edge-set `CF-Connecting-IP` header). `diesel-core/bun` and `diesel-core/deno` also export `file(ctx, path, ...)`, a `c.file()`-shaped helper built on each runtime's native file API (`Bun.file`, `Deno.open`) — the Bun version gets automatic HTTP Range/partial-content support for free.
- Expanded the shared `getMimeType` util from 6 to ~35 recognized extensions (audio/video, fonts, documents, archives).

## 3.1.0

### Fixes

- **Headers/cookies set via `ctx.setHeader()`/`ctx.setCookie()` were dropped from the response whenever a route or middleware threw.** `handleError` had no access to `ctx`, so every error path (uncaught throw, `HTTPException`) rebuilt a bare `Response` from scratch instead of carrying forward anything already set on the request context. Fixed across every dispatch path — `.fetch`, `cfFetch()`, and `sub()` — for both the default and `pipelineArchitecture: true` execution modes.
- `cfFetch()` under `pipelineArchitecture: true` used a separate, older pipeline codegen (`buildRequestPipeline`) that built its `Context` internally and never exposed it, which is what caused the header bug above on that path specifically. Switched it to the same codegen `.fetch` already uses (`build_request_pipeline_latest`). As a side effect, `onRequest` hooks and per-route middleware now also run under `cfFetch()` + `pipelineArchitecture: true`, which they previously skipped — execution is now consistent across Bun/Node/Deno/Cloudflare Workers regardless of architecture mode.

### Breaking changes

- **Dead `onError: boolean` constructor option removed** from `DieselOptions`. It only ever logged to the console and was undocumented outside one example. Use `app.addHooks("onError", (error, path, req) => { ... })` instead (see README).

### Other

- Removed the now-unused `buildRequestPipeline` codegen path and its only helper, superseded entirely by `build_request_pipeline_latest`.

## 3.0.1

Docs-only release — no code changes.

- README rewritten for 3.0's API (`.fetch` as a property, `cfFetch()` for Cloudflare, `listen()`/`close()` removed, `filter` middleware replacing `setupFilter()`), and now documents Bun/Node/Deno/Cloudflare Workers support with a Deno example.
- Fixed the npm downloads badge (was pointing at an unrelated package) and swapped the Bun-only `import.meta.dir` example for the portable `import.meta.dirname`.
- Docs site (astro.build) bumped from Astro 4 to 7 / Starlight 0.28 to 0.41.

## 3.0.0

### Breaking changes

- **`.fetch` is now a lazy property, not a method.** Pass `app.fetch` directly to your server instead of calling `app.fetch()`.
  ```diff
  - Bun.serve({ fetch: app.fetch() })
  + Bun.serve({ fetch: app.fetch })
  ```
  The first read builds the real handler (freeing `tempRoutes`/`tempMiddlewares`) and replaces itself with that plain function, so there's zero wrapper overhead after the first access. `cfFetch()` (Cloudflare Workers) is unaffected — it's still a method.

- **`app.setupFilter()` removed.** Route filtering/auth now lives in a standalone `diesel-core/filter` middleware instead of being built into core.
  ```diff
  - app.setupFilter().publicRoutes("/login").permitAll().authenticateJwt(...)
  + import { filter } from "diesel-core/filter";
  + app.use(filter({ publicRoutes: ["/login"], authenticate: [authJwt] }));
  ```

- **`ctx.ip` removed.** Real client IP resolution is runtime-specific (Bun's `requestIP()`, Deno's `connInfo`, Node's socket, Cloudflare's header), and guessing at it in core was misleading. `rateLimit()` now takes a pluggable `keyGenerator(ctx)` option instead of hard-depending on `ctx.ip`.

- **`app.listen()` / `app.close()` removed.** Both were hard-tied to `Bun.serve()`. Call your runtime's native server directly instead:
  ```diff
  - app.listen(3000)
  + Bun.serve({ port: 3000, fetch: app.fetch })
  ```

- **`platform` option removed** from `DieselOptions`. It only ever gated Cloudflare-specific behavior, which now lives entirely in `cfFetch()`.

### Fixes

- `diesel-core/filesave` subpath export pointed at a nonexistent file (`filesave.js` instead of the actual built `savefile.js`) — every published version through 2.2.4 hit a module-not-found error importing it.

### Other

- Core no longer depends on Bun-only APIs (`Bun.file`, `Bun.write`, bun's `Server` type, bare builtin specifiers) — the same code now runs on Bun, Node, and Deno.
- Dropped the `uuid` dependency (replaced with `crypto.randomUUID()`).
- Bumped `peepal-router` to `0.5.1` (fixes an ESM extension issue that broke resolution under Deno and strict-ESM Node).
- Dropped dead code with no live call sites (`executeBunMiddlewares`, `handleBunFilterRequest`, unused router/file-route helpers).
