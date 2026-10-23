import { ContextType } from "../../types";
import { RateLimitStore } from "./implementation";

type Props = {
    windowMs?: number,
    max?: number,
    message?: string
    store?: RateLimitStore
    // Resolves the bucket key for a request. Defaults to the socket IP
    // reported by the runtime server (`server.requestIP(req)` on Bun).
    // Forwarded headers are ignored unless `trustProxy` is set, since
    // they are client-controlled. Pass your own keyGenerator for other
    // setups (e.g. `CF-Connecting-IP` on Cloudflare, or a user id).
    keyGenerator?: (ctx: ContextType) => string
    // Set only when the app sits behind a reverse proxy you control that
    // appends to `X-Forwarded-For`. The right-most entry (the one your
    // proxy added) is used as the key. Ignored when keyGenerator is set.
    trustProxy?: boolean
}

const socketIP = (ctx: ContextType): string | undefined =>
    ctx.server?.requestIP?.(ctx.req)?.address;

const rightMostForwardedFor = (ctx: ContextType): string | undefined => {
    const xff = ctx.req.headers.get("x-forwarded-for");
    if (!xff) return undefined;
    const hops = xff.split(",");
    const last = hops[hops.length - 1]?.trim();
    return last || undefined;
};

let warnedNoIP = false;

const makeDefaultKeyGenerator = (trustProxy: boolean) => (ctx: ContextType): string => {
    const ip = (trustProxy ? rightMostForwardedFor(ctx) : undefined) ?? socketIP(ctx);
    if (ip) return ip;

    // No way to tell clients apart (no server.requestIP, e.g. Workers) —
    // everyone shares one bucket. Warn once so it doesn't go unnoticed.
    if (!warnedNoIP) {
        warnedNoIP = true;
        console.warn(
            "[diesel rateLimit] could not resolve client IP; all requests share one bucket. Pass a keyGenerator."
        );
    }
    return "unknown";
};

export const rateLimit = (props: Props) => {
    const {
        windowMs = 60000,
        max = 100,
        message = "Rate limit exceeded. Please try again later.",
        store,
        trustProxy = false,
        keyGenerator = makeDefaultKeyGenerator(trustProxy)
    } = props;

    // per-instance, so separate rateLimit() calls don't share counters
    const requests = new Map<string, { count: number; startTime: number }>();

    return async (ctx: ContextType): Promise<Response | void> => {
        const clientKey = keyGenerator(ctx);

        // if user has given store ( instance of their redis)
        if (store) {
            const key = `rate-limit:${clientKey}`;

            let count: number;
            if (store.incr) {
                // atomic, and the TTL is only set on the first hit of a window
                count = await store.incr(key, windowMs);
            } else {
                // legacy stores: read-then-write, not safe under concurrency
                const current = await store.get(key);
                count = current ? current + 1 : 1;
                if (count <= max) {
                    await store.set(key, count.toString(), windowMs);
                }
            }

            if (count > max) {
                return ctx.json({ error: message }, 429);
            }
            return
        }

        // Default in-memory store
        const currentTime = Date.now();
        let requestInfo = requests.get(clientKey);

        if (!requestInfo) {
            requestInfo = { count: 1, startTime: currentTime };
            requests.set(clientKey, requestInfo);
        }
        else if (currentTime - requestInfo.startTime > windowMs) {
            requestInfo.count = 1;
            requestInfo.startTime = currentTime;
        } else {
            requestInfo.count++;
        }

        if (requestInfo.count > max) {
            return ctx.json({ error: message }, 429);
        }
    };
};
