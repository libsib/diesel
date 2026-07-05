import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import Diesel from "../lib/main";
import { Context } from "../lib/ctx";

const port = 3005;
const baseUrl = `http://localhost:${port}`;

describe("Context Object Reuse", () => {
  let app: Diesel;

  beforeAll(() => {
    app = new Diesel();
    
    let firstCtxRef: Context | null = null;

    app.get("/test-reuse", (ctx) => {
      if (!firstCtxRef) {
        firstCtxRef = ctx;
        ctx.set("customKey", "firstValue");
      } else {
        // Assert that the context object is the exact same instance reference
        expect(ctx).toBe(firstCtxRef);
        // Assert that the custom data has been cleared
        expect(ctx.get("customKey")).toBeUndefined();
      }
      return ctx.json({ ok: true });
    });

    app.get("/test-params/:id", (ctx) => {
      return ctx.json({ id: ctx.params.id });
    });

    app.listen(port);
  });

  afterAll(() => {
    app.close();
  });

  it("should reuse the Context instance and reset its state", async () => {
    // First request
    const res1 = await fetch(`${baseUrl}/test-reuse?val=1`);
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.ok).toBe(true);

    // Second request
    const res2 = await fetch(`${baseUrl}/test-reuse?val=2`);
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.ok).toBe(true);
  });

  it("should properly reset query parameters and parameters between requests", async () => {
    const res1 = await fetch(`${baseUrl}/test-params/123?name=alice`);
    const data1 = await res1.json();
    expect(data1.id).toBe("123");

    const res2 = await fetch(`${baseUrl}/test-params/456?name=bob`);
    const data2 = await res2.json();
    expect(data2.id).toBe("456");
  });
});
