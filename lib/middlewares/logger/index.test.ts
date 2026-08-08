import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Diesel from "../../main";
import { ContextType } from "../../types";

describe("logger middleware onSend chaining", () => {
    const app = new Diesel({ logger: true });

    app
        .addHooks("onSend", async (_ctx: ContextType, res?: Response) => {
            if (!res) return;
            res.headers.set("X-Custom-Hook", "ran");
            return res;
        })
        .get("/test", (c: ContextType) => c.text("hello"));

    beforeAll(() => {
        app.listen(3006, () => console.log("server started"));
    });

    afterAll(() => {
        app.close();
    });

    it("should still run onSend hooks registered after logger:true", async () => {
        const res = await fetch("http://localhost:3006/test");
        expect(res.status).toBe(200);
        expect(res.headers.get("X-Custom-Hook")).toBe("ran");
    });
});
