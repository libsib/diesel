import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Diesel from "../../main";
import { authenticateJwt } from "./index";
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
        server = Bun.serve({ port: 3007, fetch: app.fetch() });
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
