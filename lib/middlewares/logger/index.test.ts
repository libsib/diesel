import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import Diesel from "../../main";
import { advancedLogger } from "./logger";
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

describe("advancedLogger custom logger override", () => {
    const app = new Diesel();
    let customLoggerCalls = 0;

    advancedLogger({
        app,
        logger: () => { customLoggerCalls++; },
    });

    app.get("/test", (c: ContextType) => c.text("hello"));

    beforeAll(() => {
        app.listen(3007, () => console.log("server started"));
    });

    afterAll(() => {
        app.close();
    });

    it("should use the custom logger instead of the default console output", async () => {
        const consoleSpy = spyOn(console, "log");
        consoleSpy.mockClear();

        const res = await fetch("http://localhost:3007/test");
        await res.text();

        expect(customLoggerCalls).toBe(2); // onRequest + onSend
        expect(consoleSpy).not.toHaveBeenCalled();

        consoleSpy.mockRestore();
    });
});

describe("default log formatting", () => {
    const app = new Diesel();
    advancedLogger({ app });
    app.get("/test", (c: ContextType) => c.text("hello"));

    beforeAll(() => {
        app.listen(3008, () => console.log("server started"));
    });

    afterAll(() => {
        app.close();
    });

    it("should not corrupt the method field with a stringified boolean", async () => {
        const logs: string[] = [];
        const consoleSpy = spyOn(console, "log").mockImplementation((msg?: unknown) => {
            logs.push(String(msg));
        });

        const res = await fetch("http://localhost:3008/test");
        await res.text();

        consoleSpy.mockRestore();

        const jsonLine = logs.find((l) => l.includes('"method"'));
        expect(jsonLine).toBeDefined();
        expect(jsonLine).not.toContain("trueGET");
        expect(jsonLine).not.toContain("falseGET");
    });
});
