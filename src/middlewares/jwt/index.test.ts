import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Diesel from "../../main";
import { authenticateJwt, authenticateJwtDB } from "./index";
import jwt from "jsonwebtoken";
import { authenticateJwtMiddleware } from "../../utils/jwt";
import { ContextType } from "../../types";

describe("jwt test middleware", () => {
    const app = new Diesel();
    const accessToken = jwt.sign({ id: 1, name: "pradeep" }, "linux", {
        expiresIn: "1h",
    });

    let server: ReturnType<typeof Bun.serve>;

    beforeAll(() => {
        server = Bun.serve({ port: 3007, fetch: app.fetch });
    });

    afterAll(() => server.stop(true));

    app.use(
        authenticateJwt({
            app,
            jwt,
            jwtSecret: "linux",
            routes: ["/"],
        })
    );

    app.get("/", (ctx:ContextType) => ctx.send("this will need to get through jwt test"));
    app.get("/public", (ctx:ContextType) => ctx.send("public route"));


    it("should reject request without token", async () => {
        const res = await fetch("http://localhost:3007/");
        expect(res.status).toBe(401);
        
        const responseBody = await res.json();
        expect(responseBody).toEqual({ message: "Unauthorized", error: "No token provided" });
    });
    

    it("should allow request with valid token", async () => {
        const res = await fetch("http://localhost:3007/", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });
        const text = await res.text();

        expect(res.status).toBe(200);
        expect(text).toBe("this will need to get through jwt test");
    });


    it("should reject request with invalid token", async () => {
        const res = await fetch("http://localhost:3007/", {
            headers: {
                Authorization: `Bearer invalid.token.value`,
            },
        });
        const json = await res.json();
        console.log(json)
        expect(res.status).toBe(401);
        expect(json.message).toBe("Unauthorized");
        expect(json.error).toBe("Malformed or tampered token");
    });

    it("should allow access to public route without token", async () => {
        const res = await fetch("http://localhost:3007/public");
        const text = await res.text();

        expect(res.status).toBe(200);
        expect(text).toBe("public route");
    });

    it("should throw an error if jwt library is not provided", () => {
        expect(() => authenticateJwtMiddleware(null, "secret")).toThrow("JWT library is not defined");
    });
    
    it("should respond with 401 if no token is provided", async () => {
        const res = await fetch("http://localhost:3007", { method: "GET" });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ message: "Unauthorized", error: "No token provided" });
    });
    
});

describe("jwt middleware regressions", () => {
    const secret = "linux";
    const token = jwt.sign({ _id: "u1" }, secret, { expiresIn: "1h" });
    const users: Record<string, any> = { u1: { _id: "u1", name: "pradeep" } };
    // mongoose-like stub: User.findById(id).select(...)
    const userModel = {
        findById: (id: string) => ({ select: async () => users[id] ?? null }),
    };
    const req = (path: string, headers: Record<string, string> = {}) =>
        new Request(`http://localhost${path}`, { headers });

    const makeApp = (pipelineArchitecture: boolean, mw: (app: Diesel) => any) => {
        const app = new Diesel({ pipelineArchitecture });
        app.use(mw(app));
        app.get("/admin", (ctx: ContextType) => ctx.send("admin"));
        app.get("/me", (ctx: ContextType) => ctx.json({ user: ctx.get("user") }));
        return app.fetch;
    };

    for (const pipelineArchitecture of [false, true]) {
        describe(`pipelineArchitecture: ${pipelineArchitecture}`, () => {
            it("protects routes regardless of trailing/duplicate slashes or encoding", async () => {
                const fetch = makeApp(pipelineArchitecture, (app) =>
                    authenticateJwt({ app, jwt, jwtSecret: secret, routes: ["/admin"] })
                );
                for (const path of ["/admin", "/admin/", "//admin", "/admin//", "/%61dmin"]) {
                    const res = await fetch(req(path));
                    expect(res.status).toBe(401);
                }
                const ok = await fetch(req("/admin/", { Authorization: `Bearer ${token}` }));
                expect(ok.status).toBe(200);
                expect(await ok.text()).toBe("admin");
            });

            it("normalizes configured routes too", async () => {
                const fetch = makeApp(pipelineArchitecture, (app) =>
                    authenticateJwt({ app, jwt, jwtSecret: secret, routes: ["/admin/"] })
                );
                expect((await fetch(req("/admin"))).status).toBe(401);
            });

            it("authenticateJwtDB without routes protects every route", async () => {
                const fetch = makeApp(pipelineArchitecture, (app) =>
                    authenticateJwtDB({ app, userModel, jwt, jwtSecret: secret })
                );
                expect((await fetch(req("/admin"))).status).toBe(401);
                expect((await fetch(req("/me"))).status).toBe(401);
            });

            it("authenticateJwtDB lets a valid token through and sets user", async () => {
                const fetch = makeApp(pipelineArchitecture, (app) =>
                    authenticateJwtDB({ app, userModel, jwt, jwtSecret: secret, routes: ["/me"] })
                );
                const res = await fetch(req("/me/", { Authorization: `Bearer ${token}` }));
                expect(res.status).toBe(200);
                expect(await res.json()).toEqual({ user: users.u1 });
                expect((await fetch(req("//me"))).status).toBe(401);
            });

            it("authenticateJwtDB returns 401 when the user no longer exists", async () => {
                const fetch = makeApp(pipelineArchitecture, (app) =>
                    authenticateJwtDB({ app, userModel, jwt, jwtSecret: secret })
                );
                const ghost = jwt.sign({ _id: "gone" }, secret);
                const res = await fetch(req("/me", { Authorization: `Bearer ${ghost}` }));
                expect(res.status).toBe(401);
            });
        });
    }

    describe("token extraction", () => {
        const fetch = makeApp(false, (app) => authenticateJwt({ app, jwt, jwtSecret: secret }));

        it("empty accessToken cookie does not override the Authorization header", async () => {
            const res = await fetch(req("/admin", { Cookie: "accessToken=", Authorization: `Bearer ${token}` }));
            expect(res.status).toBe(200);
        });

        it("accepts the Bearer scheme case-insensitively", async () => {
            expect((await fetch(req("/admin", { Authorization: `bearer ${token}` }))).status).toBe(200);
            expect((await fetch(req("/admin", { Authorization: `BEARER ${token}` }))).status).toBe(200);
        });

        it("still verifies HS384/HS512 tokens", async () => {
            for (const algorithm of ["HS384", "HS512"] as const) {
                const t = jwt.sign({ _id: "u1" }, secret, { algorithm });
                expect((await fetch(req("/admin", { Authorization: `Bearer ${t}` }))).status).toBe(200);
            }
        });

        it("rejects unsigned (alg: none) tokens", async () => {
            const t = jwt.sign({ _id: "u1" }, null as any, { algorithm: "none" });
            expect((await fetch(req("/admin", { Authorization: `Bearer ${t}` }))).status).toBe(401);
        });
    });
});
