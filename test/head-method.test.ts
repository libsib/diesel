import { describe, it, expect } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { app } from './server'
import Diesel from '../src/main'

const BASE = 'http://localhost'

function get(target: Diesel | typeof app, path: string, method: string) {
  return (target as any).fetch(new Request(`${BASE}${path}`, { method }));
}

describe("HEAD method - routing (via ./server app, no HTTP server involved)", () => {
  it("falls back to the GET route and returns 200", async () => {
    const getRes: Response = await get(app, "/api/hello", "GET");
    const headRes: Response = await get(app, "/api/hello", "HEAD");

    expect(headRes.status).toBe(200);
    expect(headRes.status).toBe(getRes.status);
  });

  it("matches dynamic/param GET routes the same way GET does", async () => {
    const headRes: Response = await get(app, "/api/param/1/john", "HEAD");
    expect(headRes.status).toBe(200);
  });

  it("returns 404 when no route (GET or otherwise) exists for the path", async () => {
    const res: Response = await get(app, "/does-not-exist", "HEAD");
    expect(res.status).toBe(404);
  });

  it("does not fall back to non-GET methods (POST-only route)", async () => {
    // /body is only registered via app.post(...); HEAD should not match it.
    const res: Response = await get(app, "/body", "HEAD");
    expect(res.status).toBe(404);
  });

  it("BUG: the GET fallback must only trigger for HEAD, not for any unmatched method", async () => {
    // /api/hello is GET-only. A DELETE request has nothing to do with HEAD's
    // RFC 9110 fallback rule, so it must 404 like any other unsupported method -
    // NOT silently run the GET handler. The current guard is
    // `if (!matchedRouteHandler.handler) ...find("GET", path)` with no method
    // check, so this currently (incorrectly) returns 200.
    const res: Response = await get(app, "/api/hello", "DELETE");
    expect(res.status).toBe(404);
  });

  it("still returns a real body for a normal GET request (contrast check)", async () => {
    const res: Response = await get(app, "/api/hello", "GET");
    const data = await res.json();
    expect(data.msg).toBe("Hello world!");
  });
});

describe("HEAD method - body stripping per ctx serializer (inspecting the Response object directly)", () => {
  // Own throwaway app so this doesn't depend on / pollute test/server.ts.
  // We call app.fetch() directly and read the returned Response - no Bun.serve,
  // so nothing at the HTTP-transport layer can strip the body for us. Whatever
  // we see on `res.body` / `res.text()` here is exactly what diesel's ctx.*()
  // methods produced.
  const probeApp = new Diesel();

  probeApp.get("/text", (ctx: any) => ctx.text("hello text"));
  probeApp.get("/json", (ctx: any) => ctx.json({ msg: "hello json" }));
  probeApp.get("/send-object", (ctx: any) => ctx.send({ msg: "hello send object" }));
  probeApp.get("/send-string", (ctx: any) => ctx.send("hello send string"));
  probeApp.get("/html", (ctx: any) =>
    ctx.text("<h1>hi</h1>", 200, { "Content-Type": "text/html; charset=utf-8" })
  );
  // Written to the OS temp dir at test-run time so no fixture file needs to
  // be committed to the repo just for ctx.file() to have something to read.
  const fileFixturePath = join(tmpdir(), `diesel-head-method-test-${process.pid}.txt`);
  writeFileSync(fileFixturePath, "sample fixture content for ctx.file() HEAD test\n");
  probeApp.get("/file", (ctx: any) => ctx.file(fileFixturePath));
  probeApp.get("/stream", (ctx: any) =>
    ctx.stream((controller: ReadableStreamDefaultController) => {
      controller.enqueue(new TextEncoder().encode("streamed-data"));
    })
  );

  async function expectBodyStripped(path: string) {
    const getRes: Response = await get(probeApp, path, "GET");
    const getBody = await getRes.clone().text();
    // sanity: the GET route actually produces a non-empty body
    expect(getBody.length).toBeGreaterThan(0);

    const headRes: Response = await get(probeApp, path, "HEAD");
    expect(headRes.status).toBe(200);
    expect(headRes.body).toBeNull();
    expect(await headRes.text()).toBe("");
  }

  it("ctx.text() strips the body on HEAD", async () => {
    await expectBodyStripped("/text");
  });

  it("ctx.text() with a custom Content-Type (html response) strips the body on HEAD", async () => {
    await expectBodyStripped("/html");
  });

  it("ctx.json() strips the body on HEAD", async () => {
    await expectBodyStripped("/json");
  });

  it("ctx.send() with an object payload strips the body on HEAD", async () => {
    await expectBodyStripped("/send-object");
  });

  it("ctx.send() with a string payload strips the body on HEAD", async () => {
    await expectBodyStripped("/send-string");
  });

  it("ctx.file() strips the body on HEAD", async () => {
    await expectBodyStripped("/file");
  });

  it("ctx.stream() strips the body on HEAD", async () => {
    await expectBodyStripped("/stream");
  });
});

describe("HEAD method - explicit registration & middleware", () => {
  it("an explicitly registered app.head() handler wins over the GET fallback", async () => {
    const headPrecedenceApp = new Diesel();
    headPrecedenceApp.head("/explicit", (ctx: any) =>
      new Response(null, { status: 204, headers: { "X-Handler": "head" } })
    );
    headPrecedenceApp.get("/explicit", (ctx: any) => ctx.json({ msg: "get handler" }));

    const headRes: Response = await get(headPrecedenceApp, "/explicit", "HEAD");
    expect(headRes.status).toBe(204);
    expect(headRes.headers.get("x-handler")).toBe("head");
  });

  it("middleware still runs when HEAD falls back to a GET route (auth-gated route)", async () => {
    // /api/protected is GET+POST only, guarded by authJwt middleware. No cookie
    // is sent, so the middleware itself should short-circuit with 401 - proving
    // the fallback replays the full GET route (middleware included), not just
    // the terminal handler.
    const headRes: Response = await get(app, "/api/protected", "HEAD");
    expect(headRes.status).toBe(401);
    expect(headRes.body).toBeNull();
  });
});

describe("HEAD method - raw Response paths are stripped too (central guard)", () => {
  // ctx.text()/json()/send()/file()/stream() null the body themselves as an
  // early-exit optimization (skips real work like disk I/O for ctx.file()).
  // Anything that hands back a `Response` WITHOUT going through those helpers
  // (onError hooks, the default 404 fallback, custom middleware) used to skip
  // HEAD stripping entirely. A central guard in stripHeadBody() (utils/request.util.ts),
  // applied once to whatever Response #handleRequests/#buildFetchHandler/cfFetch()
  // resolve to, now catches those cases too - regardless of how the body was built.

  it("an onError hook returning a raw Response is stripped on HEAD", async () => {
    // ./server's onError hook does `return new Response(JSON.stringify(...), {status:500})`
    const headRes: Response = await get(app, "/error", "HEAD");
    expect(headRes.status).toBe(500);
    expect(headRes.body).toBeNull();
    expect(await headRes.clone().text()).toBe("");
  });

  it("the default 404 'route not found' response is stripped on HEAD", async () => {
    const headRes: Response = await get(app, "/does-not-exist", "HEAD");
    expect(headRes.status).toBe(404);
    expect(headRes.body).toBeNull();
    expect(await headRes.clone().text()).toBe("");
  });
});

describe("HEAD method - pipelineArchitecture mode", () => {
  // #buildFetchHandler() (used by `app.fetch`) branches into two separate
  // implementations for pipelineArchitecture true/false - both need their own
  // HEAD->GET fallback since neither shares code with the other.
  it("pipelineArchitecture:true falls back HEAD->GET via app.fetch()", async () => {
    const pipelineApp = new Diesel({ pipelineArchitecture: true });
    pipelineApp.get("/x", (ctx: any) => ctx.json({ ok: true }));

    const getRes: Response = await get(pipelineApp, "/x", "GET");
    const headRes: Response = await get(pipelineApp, "/x", "HEAD");

    expect(getRes.status).toBe(200);
    expect(headRes.status).toBe(200);
    expect(headRes.body).toBeNull();
  });

  it("BUG: the GET fallback must only trigger for HEAD, not for any unmatched method", async () => {
    const pipelineApp = new Diesel({ pipelineArchitecture: true });
    pipelineApp.get("/x", (ctx: any) => ctx.json({ ok: true }));

    const res: Response = await get(pipelineApp, "/x", "DELETE");
    expect(res.status).toBe(404);
  });
});

describe("HEAD method - Cloudflare adaptor (app.cfFetch())", () => {
  // cfFetch() is a THIRD, separate fetch-handler surface (used on Cloudflare
  // Workers instead of app.fetch/Bun.serve) with its own two branches
  // (pipelineArchitecture true/false), so the HEAD->GET fallback has to be
  // verified there independently too - it doesn't share code with #handleRequests
  // or #buildFetchHandler's non-cf branches.
  function cfGet(cfApp: Diesel, path: string, method: string) {
    const handler = (cfApp as any).cfFetch();
    return handler(new Request(`${BASE}${path}`, { method }), {}, {});
  }

  it("cfFetch() (default) falls back HEAD->GET and strips the body", async () => {
    const cfApp = new Diesel();
    cfApp.get("/x", (ctx: any) => ctx.json({ ok: true }));

    const getRes: Response = await cfGet(cfApp, "/x", "GET");
    const headRes: Response = await cfGet(cfApp, "/x", "HEAD");

    expect(getRes.status).toBe(200);
    expect(headRes.status).toBe(200);
    expect(headRes.body).toBeNull();
  });

  it("cfFetch() (pipelineArchitecture:true) falls back HEAD->GET and strips the body", async () => {
    const cfApp = new Diesel({ pipelineArchitecture: true });
    cfApp.get("/x", (ctx: any) => ctx.json({ ok: true }));

    const getRes: Response = await cfGet(cfApp, "/x", "GET");
    const headRes: Response = await cfGet(cfApp, "/x", "HEAD");

    expect(getRes.status).toBe(200);
    expect(headRes.status).toBe(200);
    expect(headRes.body).toBeNull();
  });

  it("cfFetch() does not fall back to non-GET methods (POST-only route)", async () => {
    const cfApp = new Diesel();
    cfApp.post("/body", (ctx: any) => ctx.json({ ok: true }));

    const res: Response = await cfGet(cfApp, "/body", "HEAD");
    expect(res.status).toBe(404);
  });

  it("BUG (default): the GET fallback must only trigger for HEAD, not for any unmatched method", async () => {
    const cfApp = new Diesel();
    cfApp.get("/x", (ctx: any) => ctx.json({ ok: true }));

    const res: Response = await cfGet(cfApp, "/x", "DELETE");
    expect(res.status).toBe(404);
  });

  it("pipelineArchitecture:true correctly guards the fallback to HEAD only", async () => {
    // This is the one branch that already has the `req.method === "HEAD"`
    // guard - kept as a positive control alongside the BUG cases above.
    const cfApp = new Diesel({ pipelineArchitecture: true });
    cfApp.get("/x", (ctx: any) => ctx.json({ ok: true }));

    const res: Response = await cfGet(cfApp, "/x", "DELETE");
    expect(res.status).toBe(404);
  });
});
