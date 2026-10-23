import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Diesel from "../../main";
import { rateLimit } from "./rate-limit";
import { RedisStore, RateLimitStore } from "./implementation";
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
    beforeAll(() => { server = Bun.serve({ port: 3008, fetch: app.fetch }) })
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

// fake runtime server so tests control the socket IP without binding a port
const serverFor = (address: string | null) => ({
    requestIP: () => (address ? { address } : null),
})

const hit = (app: Diesel, path: string, ip: string | null, headers: Record<string, string> = {}) =>
    app.fetch(new Request(`http://localhost${path}`, { headers }), serverFor(ip) as any)

describe('rate limit default key', () => {
    it("ignores client-supplied X-Forwarded-For by default", async () => {
        const app = new Diesel()
        app.use("/k", rateLimit({ windowMs: 60000, max: 2 }))
        app.get("/k", (ctx: ContextType) => ctx.send("ok"))

        const statuses: number[] = []
        for (let i = 0; i < 4; i++) {
            const res = await hit(app, "/k", "10.0.0.1", { "x-forwarded-for": `1.2.3.${i}` })
            statuses.push(res.status)
        }
        expect(statuses).toEqual([200, 200, 429, 429])
    })

    it("keys distinct socket IPs separately (no shared 'unknown' bucket)", async () => {
        const app = new Diesel()
        app.use("/k", rateLimit({ windowMs: 60000, max: 1 }))
        app.get("/k", (ctx: ContextType) => ctx.send("ok"))

        expect((await hit(app, "/k", "10.0.0.1")).status).toBe(200)
        expect((await hit(app, "/k", "10.0.0.1")).status).toBe(429)
        expect((await hit(app, "/k", "10.0.0.2")).status).toBe(200)
    })

    it("uses the right-most X-Forwarded-For hop when trustProxy is set", async () => {
        const app = new Diesel()
        app.use("/k", rateLimit({ windowMs: 60000, max: 1, trustProxy: true }))
        app.get("/k", (ctx: ContextType) => ctx.send("ok"))

        // left-most entry is spoofable, right-most was added by our proxy
        expect((await hit(app, "/k", "127.0.0.1", { "x-forwarded-for": "6.6.6.1, 203.0.113.5" })).status).toBe(200)
        expect((await hit(app, "/k", "127.0.0.1", { "x-forwarded-for": "6.6.6.2, 203.0.113.5" })).status).toBe(429)
        expect((await hit(app, "/k", "127.0.0.1", { "x-forwarded-for": "6.6.6.2, 203.0.113.6" })).status).toBe(200)
    })
})

describe('rate limit instances', () => {
    it("does not share counters between rateLimit() instances", async () => {
        const app = new Diesel()
        app.use("/a", rateLimit({ windowMs: 60000, max: 2 }))
        app.use("/b", rateLimit({ windowMs: 60000, max: 100 }))
        app.get("/a", (ctx: ContextType) => ctx.send("a"))
        app.get("/b", (ctx: ContextType) => ctx.send("b"))

        for (let i = 0; i < 5; i++) {
            expect((await hit(app, "/b", "10.0.0.9")).status).toBe(200)
        }
        expect((await hit(app, "/a", "10.0.0.9")).status).toBe(200)
        expect((await hit(app, "/a", "10.0.0.9")).status).toBe(200)
        expect((await hit(app, "/a", "10.0.0.9")).status).toBe(429)
    })

    it("max: 0 blocks the first request", async () => {
        const app = new Diesel()
        app.use("/z", rateLimit({ windowMs: 60000, max: 0 }))
        app.get("/z", (ctx: ContextType) => ctx.send("z"))

        expect((await hit(app, "/z", "10.0.0.3")).status).toBe(429)
    })
})

// in-memory store with simulated latency, mimicking a remote store
class SlowStore implements RateLimitStore {
    data = new Map<string, { value: number; expiresAt: number }>()
    pexpireCalls = 0
    private tick = () => new Promise((r) => setTimeout(r, 5))
    private live(key: string) {
        const e = this.data.get(key)
        if (e && e.expiresAt <= Date.now()) { this.data.delete(key); return undefined }
        return e
    }
    async get(key: string) {
        await this.tick()
        return this.live(key)?.value ?? null
    }
    async set(key: string, value: string, ttlMs: number) {
        await this.tick()
        this.data.set(key, { value: parseInt(value), expiresAt: Date.now() + ttlMs })
    }
    async reset(key: string) {
        this.data.delete(key)
    }
}

// redis-like client backing RedisStore, with the same latency
class FakeRedis {
    data = new Map<string, { value: number; expiresAt: number }>()
    pexpireCalls = 0
    private tick = () => new Promise((r) => setTimeout(r, 5))
    private live(key: string) {
        const e = this.data.get(key)
        if (e && e.expiresAt <= Date.now()) { this.data.delete(key); return undefined }
        return e
    }
    async incr(key: string) {
        // the increment itself is atomic, like redis; latency is on the reply
        const e = this.live(key) ?? { value: 0, expiresAt: Infinity }
        const value = ++e.value
        this.data.set(key, e)
        await this.tick()
        return value
    }
    async pexpire(key: string, ms: number) {
        this.pexpireCalls++
        const e = this.live(key)
        if (e) e.expiresAt = Date.now() + ms
        await this.tick()
        return 1
    }
    async get(key: string) { return this.live(key)?.value?.toString() ?? null }
    async set(key: string, value: string, _px: string, ms: number) {
        this.data.set(key, { value: parseInt(value), expiresAt: Date.now() + ms })
    }
    async del(key: string) { this.data.delete(key) }
}

describe('rate limit store', () => {
    it("legacy get/set store races under concurrency (documents why incr exists)", async () => {
        const app = new Diesel()
        app.use("/s", rateLimit({ windowMs: 60000, max: 5, store: new SlowStore() }))
        app.get("/s", (ctx: ContextType) => ctx.send("ok"))

        const res = await Promise.all(Array.from({ length: 50 }, () => hit(app, "/s", "10.0.0.4")))
        const allowed = res.filter((r) => r.status === 200).length
        expect(allowed).toBeGreaterThan(5)
    })

    it("RedisStore.incr allows exactly max under 50 concurrent requests", async () => {
        const app = new Diesel()
        const redis = new FakeRedis()
        app.use("/s", rateLimit({ windowMs: 60000, max: 5, store: new RedisStore(redis) }))
        app.get("/s", (ctx: ContextType) => ctx.send("ok"))

        const res = await Promise.all(Array.from({ length: 50 }, () => hit(app, "/s", "10.0.0.5")))
        expect(res.filter((r) => r.status === 200).length).toBe(5)
        expect(res.filter((r) => r.status === 429).length).toBe(45)
        // TTL set once per window, not refreshed on every hit
        expect(redis.pexpireCalls).toBe(1)
    })

    it("RedisStore window is fixed: a hit inside the window does not extend the TTL", async () => {
        const app = new Diesel()
        app.use("/s", rateLimit({ windowMs: 100, max: 2, store: new RedisStore(new FakeRedis()) }))
        app.get("/s", (ctx: ContextType) => ctx.send("ok"))
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

        // t=0 -> 1, t=60 -> 2. A sliding TTL would push expiry to t=160,
        // making the t=130 hit the 3rd in-window request (429).
        expect((await hit(app, "/s", "10.0.0.6")).status).toBe(200)
        await sleep(60)
        expect((await hit(app, "/s", "10.0.0.6")).status).toBe(200)
        await sleep(70)
        expect((await hit(app, "/s", "10.0.0.6")).status).toBe(200)
    })
})
