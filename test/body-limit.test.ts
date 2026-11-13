import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Diesel from "../src/main";

describe("bodyLimit option", () => {
  const app = new Diesel({ bodyLimit: 16 });
  app.post("/echo", async (ctx) => {
    const body = await ctx.body;
    return ctx.json(body ?? {});
  });

  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = "";

  beforeAll(() => {
    server = Bun.serve({ port: 0, fetch: app.fetch });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => server.stop(true));

  it("accepts a body within the limit", async () => {
    const res = await fetch(`${baseUrl}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a body over the limit with 413 (via Content-Length)", async () => {
    const res = await fetch(`${baseUrl}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "this payload is definitely too large" }),
    });
    expect(res.status).toBe(413);
  });

  it("does not limit when bodyLimit is unset", async () => {
    const open = new Diesel();
    open.post("/echo", async (ctx) => ctx.json((await ctx.body) ?? {}));
    const s = Bun.serve({ port: 0, fetch: open.fetch });
    const res = await fetch(`http://localhost:${s.port}/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(10_000) }),
    });
    expect(res.status).toBe(200);
    s.stop(true);
  });
});
