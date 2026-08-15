# Changelog

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
