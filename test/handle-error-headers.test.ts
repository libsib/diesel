import { describe, it, expect } from "bun:test";
import Diesel from "../src/main";
import { HTTPException } from "../src/http-exception";
import type { Context } from "../src/ctx";

// No server/network needed here — app.fetch / app.cfFetch() just return a
// Response for a given Request, so we can call them directly and inspect
// the headers on the result.

function registerRoutes(app: Diesel) {
  app.get("/plain-error", (ctx: Context) => {
    ctx.setHeader("x-custom", "from-controller");
    throw new Error("boom");
  });

  app.get("/http-exception", (ctx: Context) => {
    ctx.setHeader("x-custom", "from-controller");
    throw new HTTPException(400, { message: "bad request" });
  });

  app.get("/set-cookie-error", (ctx: Context) => {
    ctx.setCookie("session", "abc123");
    throw new Error("boom");
  });
}

type Handler = (req: Request) => Response | Promise<Response>;

function runScenarios(name: string, buildHandler: () => Handler) {
  describe(name, () => {
    it("keeps a header set via ctx.setHeader() before a plain throw", async () => {
      const handler = buildHandler();
      const res = await handler(new Request("http://localhost/plain-error"));
      expect(res.status).toBe(500);
      expect(res.headers.get("x-custom")).toBe("from-controller");
    });

    it("keeps a header set via ctx.setHeader() before throwing HTTPException", async () => {
      const handler = buildHandler();
      const res = await handler(
        new Request("http://localhost/http-exception"),
      );
      expect(res.status).toBe(400);
      expect(res.headers.get("x-custom")).toBe("from-controller");
    });

    it("keeps a cookie set via ctx.setCookie() before a plain throw", async () => {
      const handler = buildHandler();
      const res = await handler(
        new Request("http://localhost/set-cookie-error"),
      );
      expect(res.status).toBe(500);
      expect(res.headers.has("set-cookie")).toBe(true);
      expect(res.headers.get("set-cookie") ?? "").toContain(
        "session=abc123",
      );
    });
  });
}

runScenarios("handleError — app.fetch, default architecture", () => {
  const app = new Diesel();
  registerRoutes(app);
  return (req) => app.fetch(req);
});

runScenarios(
  "handleError — app.fetch, pipelineArchitecture: true",
  () => {
    const app = new Diesel({ pipelineArchitecture: true });
    registerRoutes(app);
    return (req) => app.fetch(req);
  },
);

runScenarios("handleError — app.cfFetch(), default architecture", () => {
  const app = new Diesel();
  registerRoutes(app);
  const handler = app.cfFetch();
  return (req) => handler(req, {}, undefined);
});

runScenarios(
  "handleError — app.cfFetch(), pipelineArchitecture: true",
  () => {
    const app = new Diesel({ pipelineArchitecture: true });
    registerRoutes(app);
    const handler = app.cfFetch();
    return (req) => handler(req, {}, undefined);
  },
);
