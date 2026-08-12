import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Diesel from "../../main";
import { cors } from "./cors";
import { ContextType } from "../../types";

describe("CORS Middleware", () => {
    const app = new Diesel()

    app.use(
        "/public/test",
        cors({
            origin: "*",
        })
    );

    app.use(
        "/single-origin/test",
        cors({
            origin: "http://localhost:3000",
            allowedHeaders: ["X-Test-Header"],
            methods: ["GET", "POST"],
            credentials: true,
            maxAge: 86400,
        })
    );

    app.use(
        "/multi-origin/test",
        cors({
            origin: ["http://site1.com", "http://site2.com"],
        })
    );

    app.get("/public/test", (c:ContextType) => c.json({ message: "Public route" }));
    app.get("/single-origin/test", (c:ContextType) => c.json({ message: "Single origin route" }));
    app.get("/multi-origin/test", (c:ContextType) => c.json({ message: "Multi origin route" }));

    let server: ReturnType<typeof Bun.serve>;

    beforeAll(() => {
        server = Bun.serve({ port: 3005, fetch: app.fetch });
        console.log("server started");
    });

    afterAll(() => {
        server.stop(true)
    });

    it("should allow any origin for public route", async () => {
        const res = await fetch("http://localhost:3005/public/test", {
            headers: { origin: "http://random.com" },
        });

        const data = await res.json();

        expect(res.status).toBe(200);
        expect(data.message).toBe("Public route");
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("should allow specific origin", async () => {
        const res = await fetch("http://localhost:3005/single-origin/test", {
            headers: { origin: "http://localhost:3000" },
        });
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
        expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });

    it("should reject request from disallowed origin", async () => {
        const res = await fetch("http://localhost:3005/single-origin/test", {
            headers: { origin: "http://evil.com" },
        });
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.message).toBe("CORS not allowed");
    });

    it("should handle preflight with allowed headers and methods", async () => {
        const res = await fetch("http://localhost:3005/single-origin/test", {
            method: "OPTIONS",
            headers: {
                origin: "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "X-Test-Header",
            },
        });
        expect(res.status).toBe(204);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
        expect(res.headers.get("Access-Control-Allow-Headers")).toBe("X-Test-Header");
        expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET,POST");
        expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
    });

    it("should allow multiple origins", async () => {
        const req = await fetch("http://localhost:3005/multi-origin/test", {
            headers: {
                origin: "http://site2.com",
            },
        });
        expect(req.headers.get("Access-Control-Allow-Origin")).toBe("http://site2.com");
    });

    it("should reject disallowed origin in multiple origins", async () => {
        const req = await fetch("http://localhost:3005/multi-origin/test", {
            headers: {
                origin: "http://evil.com",
            },
        });
        expect(req.status).toBe(403);
        const body = await req.json();
        expect(body.message).toBe("CORS not allowed");
    });
});
