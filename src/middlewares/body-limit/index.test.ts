import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Diesel from "../../main";
import { bodyLimit } from "./body-limit";
import type { Context } from "../../ctx";

describe("body limit testing", () => {
    const app = new Diesel();

    app.use("/", bodyLimit({ maxSize: 10 }));

    app.post("/", async (ctx: Context) => ctx.send("Success"));

    let server: ReturnType<typeof Bun.serve>;
    beforeAll(() => { server = Bun.serve({ port: 3012, fetch: app.fetch as any }) });
    afterAll(() => server.stop(true));

    it("should allow requests within the size limit", async () => {
        const res = await fetch("http://localhost:3012/", {
            method: "POST",
            headers: { "Content-Length": "5" },
            body: "abcde",
        });
        expect(res.status).toBe(200);
    });

    it("should block requests declaring a body larger than the limit", async () => {
        const body = "a".repeat(20);
        const res = await fetch("http://localhost:3012/", {
            method: "POST",
            headers: { "Content-Length": String(body.length) },
            body,
        });
        expect(res.status).toBe(413);
        const data = await res.json();
        expect(data.error).toBe("Request body too large");
    });
});
