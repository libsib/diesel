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

    app.use(
        "/wild-cred/test",
        cors({
            origin: "*",
            credentials: true,
        })
    );

    app.use(
        "/vary/test",
        (c: ContextType) => {
            c.setHeader("Vary", "Accept-Encoding");
        },
        cors({
            origin: "http://localhost:3000",
        })
    );

    app.get("/public/test", (c:ContextType) => c.json({ message: "Public route" }));
    app.get("/single-origin/test", (c:ContextType) => c.json({ message: "Single origin route" }));
    app.get("/multi-origin/test", (c:ContextType) => c.json({ message: "Multi origin route" }));
    app.options("/multi-origin/test", (c:ContextType) => c.json({ message: "Options route" }));
    app.get("/wild-cred/test", (c:ContextType) => c.json({ message: "Wildcard credentials route" }));
    app.get("/vary/test", (c:ContextType) => c.json({ message: "Vary route" }));

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

    it("should send Vary: Origin when the origin is reflected", async () => {
        const res = await fetch("http://localhost:3005/multi-origin/test", {
            headers: { origin: "http://site1.com" },
        });
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://site1.com");
        expect(res.headers.get("Vary")).toBe("Origin");
    });

    it("should append Origin to an existing Vary header", async () => {
        const res = await fetch("http://localhost:3005/vary/test", {
            headers: { origin: "http://localhost:3000" },
        });
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
        expect(res.headers.get("Vary")).toBe("Accept-Encoding, Origin");
    });

    it("should not send Vary for a plain wildcard origin", async () => {
        const res = await fetch("http://localhost:3005/public/test", {
            headers: { origin: "http://random.com" },
        });
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
        expect(res.headers.get("Vary")).toBeNull();
    });

    it("should pass non-preflight OPTIONS through to the route", async () => {
        const res = await fetch("http://localhost:3005/multi-origin/test", {
            method: "OPTIONS",
            headers: { origin: "http://site1.com" },
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.message).toBe("Options route");
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://site1.com");
    });

    it("should answer OPTIONS with Access-Control-Request-Method as preflight", async () => {
        const res = await fetch("http://localhost:3005/multi-origin/test", {
            method: "OPTIONS",
            headers: {
                origin: "http://site1.com",
                "Access-Control-Request-Method": "GET",
            },
        });
        expect(res.status).toBe(204);
    });

    it("should not send Access-Control-Allow-Credentials when credentials is off", async () => {
        const res = await fetch("http://localhost:3005/multi-origin/test", {
            headers: { origin: "http://site1.com" },
        });
        expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    });

    it("should reflect the origin instead of * when credentials is enabled", async () => {
        const res = await fetch("http://localhost:3005/wild-cred/test", {
            headers: { origin: "http://random.com" },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://random.com");
        expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
        expect(res.headers.get("Vary")).toBe("Origin");
    });
});
