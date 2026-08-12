# Changelog

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
