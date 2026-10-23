import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Diesel from "../../main";
import { filter } from "./index";
import { ContextType } from "../../types";

const deny = () => Response.json({ error: "denied" }, { status: 401 });

const makeApp = (publicRoutes: string[]) => {
    const app = new Diesel();
    app.use(filter({ publicRoutes, authenticate: [deny] }));
    for (const p of ["/", "/admin", "/api", "/api/users", "/api-admin", "/login", "/login/reset"]) {
        app.get(p, (c: ContextType) => c.text("ok"));
    }
    return app;
};

describe("filter middleware", () => {
    let rootServer: ReturnType<typeof Bun.serve>;
    let apiServer: ReturnType<typeof Bun.serve>;
    let emptyServer: ReturnType<typeof Bun.serve>;

    beforeAll(() => {
        rootServer = Bun.serve({ port: 3021, fetch: makeApp(["/"]).fetch });
        apiServer = Bun.serve({ port: 3022, fetch: makeApp(["/api", "/login/"]).fetch });
        const empty = new Diesel();
        empty.use(filter({ publicRoutes: ["/open"], authenticate: [] }));
        empty.get("/open", (c: ContextType) => c.text("ok"));
        empty.get("/secret", (c: ContextType) => c.text("ok"));
        emptyServer = Bun.serve({ port: 3023, fetch: empty.fetch });
    });

    afterAll(() => {
        rootServer.stop(true);
        apiServer.stop(true);
        emptyServer.stop(true);
    });

    const status = async (port: number, path: string) =>
        (await fetch(`http://localhost:${port}${path}`)).status;

    it('publicRoutes ["/"] only makes "/" public', async () => {
        expect(await status(3021, "/")).toBe(200);
        expect(await status(3021, "/admin")).toBe(401);
        expect(await status(3021, "/api/users")).toBe(401);
    });

    it("public prefix matches its own sub-paths", async () => {
        expect(await status(3022, "/api")).toBe(200);
        expect(await status(3022, "/api/users")).toBe(200);
        expect(await status(3022, "/api/users?x=1")).toBe(200);
    });

    it("prefix matching is segment-aware", async () => {
        expect(await status(3022, "/api-admin")).toBe(401);
        expect(await status(3022, "/admin")).toBe(401);
        expect(await status(3022, "/")).toBe(401);
    });

    it("trailing slash in publicRoutes is ignored", async () => {
        expect(await status(3022, "/login")).toBe(200);
        expect(await status(3022, "/login/reset")).toBe(200);
    });

    it("duplicate / trailing slashes cannot dodge classification", async () => {
        expect(await status(3022, "//api-admin")).not.toBe(200);
        expect(await status(3022, "/api-admin/")).not.toBe(200);
        expect(await status(3021, "//admin")).not.toBe(200);
        expect(await status(3021, "/admin/")).not.toBe(200);
    });

    it("returns 401 for protected routes when authenticate is empty", async () => {
        expect(await status(3023, "/open")).toBe(200);
        expect(await status(3023, "/secret")).toBe(401);
    });
});
