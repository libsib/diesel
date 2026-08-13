import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import Diesel from "../lib/main";
import { HTTPException } from "../lib/http-exception";
import type { Context } from "../lib/ctx";

const port = 3003;
const baseUrl = `http://localhost:${port}`;

const app = new Diesel();

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

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({ port, fetch: app.fetch });
});

afterAll(() => {
  server.stop(true);
});

describe("handleError — user-set headers should survive onto the error response", () => {
  it("keeps a header set via ctx.setHeader() before a plain throw", async () => {
    const res = await fetch(`${baseUrl}/plain-error`);
    expect(res.status).toBe(500);
    expect(res.headers.get("x-custom")).toBe("from-controller");
  });

  it("keeps a header set via ctx.setHeader() before throwing HTTPException", async () => {
    const res = await fetch(`${baseUrl}/http-exception`);
    expect(res.status).toBe(400);
    expect(res.headers.get("x-custom")).toBe("from-controller");
  });

  it("keeps a cookie set via ctx.setCookie() before a plain throw", async () => {
    const res = await fetch(`${baseUrl}/set-cookie-error`);
    expect(res.status).toBe(500);
    expect(res.headers.has("set-cookie")).toBe(true);
    expect(res.headers.get("set-cookie") ?? "").toContain("session=abc123");
  });
});
