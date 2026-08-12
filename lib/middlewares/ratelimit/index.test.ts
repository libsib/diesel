import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Diesel from "../../main";
import { rateLimit } from "./rate-limit";
import { RedisStore } from "./implementation";
import { ContextType } from "../../types";
// import {redis} from '../../../example/src/utils/redis'


describe('rate limit testing', () => {
    const app = new Diesel()

    app.use("/one", rateLimit({
        windowMs: 1000,
        max: 5
    }))

    // redis rate-limit
    // const redisStore = new RedisStore(redis)
    app.use("/redis", rateLimit({
        // store: redisStore,
        windowMs: 1000,
        max: 5,
    }))

    app.get("/one", (ctx:ContextType) => ctx.send("Success"));
    app.get("/", (ctx:ContextType) => ctx.send("Success"));
    app.get("/redis", (ctx:ContextType) => ctx.send('Success'))
    let server: ReturnType<typeof Bun.serve>;
    beforeAll(() => { server = Bun.serve({ port: 3008, fetch: app.fetch() }) })
    afterAll(() => server.stop(true))

    it("should allow requests within the limit", async () => {
        for (let i = 0; i < 5; i++) {
            const res = await fetch("http://localhost:3008/one");
            expect(res.status).toBe(200);
            const text = await res.text();
            expect(text).toBe("Success");
        }
    });

    it("should block requests over the limit", async () => {
        for (let i = 0; i < 5; i++) {
            await fetch("http://localhost:3008/one");
        }

        const res = await fetch("http://localhost:3008/one");
        expect(res.status).toBe(429);
        const data = await res.json();
        expect(data.error).toContain("Rate limit exceeded. Please try again later.");
    })

    it("should allow requests after the window has passed", async () => {
        for (let i = 0; i < 5; i++) {
            await fetch("http://localhost:3008/one");
        }
        const prevRes = await fetch("http://localhost:3008/one");
        expect(prevRes.status).toBe(429);
        const prevData = await prevRes.json();
        expect(prevData.error).toContain("Rate limit exceeded. Please try again later.");
        //
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const res = await fetch("http://localhost:3008/one");
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toBe("Success");
    })

    it("it doesnt affect", async () => {
        for (let i = 0; i < 10; i++) {
            const res = await fetch("http://localhost:3008");
            expect(res.status).toBe(200);
            const text = await res.text();
            expect(text).toBe("Success");
        }
    })

    // it("should allow requests within the limit using redis", async () => {
    //     for (let i = 0; i < 5; i++) {
    //         const res = await fetch("http://localhost:3008/redis");
    //         expect(res.status).toBe(200);
    //         const text = await res.text();
    //         expect(text).toBe("Success");
    //     }
    // });
    it("should block requests over the limit using redis", async () => {
        for (let i = 0; i < 5; i++) {
            await fetch("http://localhost:3008/redis");
        }

        const res = await fetch("http://localhost:3008/redis");
        expect(res.status).toBe(429);
        const data = await res.json();
        expect(data.error).toContain("Rate limit exceeded. Please try again later.");
    })

    it("should allow redis requests after the window has passed", async () => {
        for (let i = 0; i < 5; i++) {
            await fetch("http://localhost:3008/redis");
        }
        const prevRes = await fetch("http://localhost:3008/redis");
        expect(prevRes.status).toBe(429);
        const prevData = await prevRes.json();
        expect(prevData.error).toContain("Rate limit exceeded. Please try again later.");
        //
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const res = await fetch("http://localhost:3008/redis");
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toBe("Success");
    })
})