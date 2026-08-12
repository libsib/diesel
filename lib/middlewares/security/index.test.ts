import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Diesel from "../../main";
import { securityMiddleware } from "./security";
import { ContextType } from "../../types";

describe("security middleware test", () => {
  const app = new Diesel();

  app.use(securityMiddleware);

  app.get("/", (ctx:ContextType) => ctx.send("success"));

  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    server = Bun.serve({ port: 3000, fetch: app.fetch });
  });

  afterAll(() => {
    server.stop(true);
  });

  it("should return 200 OK for GET /", async () => {
    const res = await fetch("http://localhost:3000");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("success");
  });

  it("should set Strict-Transport-Security header", async () => {
    const res = await fetch("http://localhost:3000");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  });

  it("should set Content-Security-Policy header", async () => {
    const res = await fetch("http://localhost:3000");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'self'");
  });

  it("should set X-Content-Type-Options header", async () => {
    const res = await fetch("http://localhost:3000");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("should set X-Frame-Options header", async () => {
    const res = await fetch("http://localhost:3000");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("should not set unexpected headers", async () => {
    const res = await fetch("http://localhost:3000");
    expect(res.headers.get("x-powered-by")).toBe(null);
    expect(res.headers.get("server")).toBe(null);
  });
});
