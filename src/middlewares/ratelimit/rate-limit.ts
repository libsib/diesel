import { ContextType } from "../../types";
import { RateLimitStore } from "./implementation";

type Props = {
    windowMs?: number,
    max?: number,
    message?: string
    store?: RateLimitStore
    // Resolves the bucket key for a request — defaults to a best-effort
    // header guess. `ctx.ip` was removed since real IP resolution is
    // runtime-specific; pass a keyGenerator backed by a per-runtime
    // adaptor helper (e.g. `diesel-core/bun`, `diesel-core/deno`) for
    // an accurate client IP.
    keyGenerator?: (ctx: ContextType) => string
}

const defaultKeyGenerator = (ctx: ContextType): string =>
    ctx.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    ctx.req.headers.get("CF-Connecting-IP") ??
    "unknown";

const requests = new Map<string, { count: number; startTime: number }>();

export const rateLimit = (props: Props) => {
    const {
        windowMs = 60000,
        max = 100,
        message = "Rate limit exceeded. Please try again later.",
        store,
        keyGenerator = defaultKeyGenerator
    } = props;

    return async (ctx: ContextType): Promise<Response | void> => {
        const socketIP = keyGenerator(ctx);

        // if user has given store ( instance of their redis)
        if (store) {
            const key = `rate-limit:${socketIP}`;

            let count = await store.get(key);
            count = count ? count + 1 : 1;

            if (count > max) {
                return ctx.json({ error: message }, 429);
            }

            await store.set(key, count.toString(), windowMs);
            return
        }

        // Default in-memory store
        const currentTime = Date.now();
        if (!requests.has(socketIP)) {
            requests.set(socketIP, { count: 1, startTime: currentTime });
        }
        else {
            const requestInfo = requests.get(socketIP)!;

            if (currentTime - requestInfo.startTime > windowMs) {
                requestInfo.count = 1;
                requestInfo.startTime = currentTime;
            } else {
                requestInfo.count++;
            }

            if (requestInfo.count > max) {
                return ctx.json({ error: message }, 429);
            }
        }
    };
};
