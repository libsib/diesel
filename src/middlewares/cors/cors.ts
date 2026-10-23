import { ContextType, middlewareFunc } from "../../types";

export interface CorsOptions {
    origin?: string | string[];
    methods?: string[];
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    credentials?: boolean;
    maxAge?: number;
}

const defaultMethods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];
const defaultHeaders = ["Content-Type", "Authorization"];

// Append "Origin" to Vary without clobbering anything already there
const varyOrigin = (ctx: ContextType) => {
    const vary = ctx.headers?.get("Vary");
    if (!vary) {
        ctx.setHeader("Vary", "Origin");
    } else if (vary.trim() !== "*" && !vary.split(",").some((v: string) => v.trim().toLowerCase() === "origin")) {
        ctx.setHeader("Vary", `${vary}, Origin`);
    }
};

export const cors = (config: CorsOptions): middlewareFunc => {
    return async function (ctx): Promise<Response | null | any> {
        const origin = ctx.req.headers.get("origin") ?? "*";
        const allowedOrigins = config.origin;
        const allowedHeaders = config.allowedHeaders ?? defaultHeaders;
        const allowedMethods = config.methods ?? defaultMethods;
        const allowedCredentials = config.credentials ?? false;
        const exposedHeaders = config.exposedHeaders ?? [];
        const maxAge = config.maxAge;

        ctx.setHeader("Access-Control-Allow-Methods", allowedMethods.join(","));
        ctx.setHeader("Access-Control-Allow-Headers", allowedHeaders.join(","));

        if (exposedHeaders.length > 0) {
            ctx.setHeader("Access-Control-Expose-Headers", exposedHeaders.join(","));
        }

        // Response depends on the request Origin unless it's a plain `*` without credentials
        if (allowedOrigins !== "*" || allowedCredentials) {
            varyOrigin(ctx);
        }

        let allowOrigin: string;
        if (origin === "*") {
            allowOrigin = "*";
        } else if (allowedOrigins === "*") {
            // `*` with credentials is invalid per spec, reflect the request origin instead
            allowOrigin = allowedCredentials ? origin : "*";
        } else if (Array.isArray(allowedOrigins)) {
            if (allowedOrigins.includes(origin)) {
                allowOrigin = origin;
            } else if (allowedOrigins.includes("*")) {
                allowOrigin = allowedCredentials ? origin : "*";
            } else {
                return ctx.json({ message: "CORS not allowed" }, 403);
            }
        } else if (typeof allowedOrigins === "string") {
            if (origin === allowedOrigins) {
                allowOrigin = origin;
            } else {
                return ctx.json({ message: "CORS not allowed" }, 403);
            }
        } else {
            return ctx.json({ message: "CORS not allowed" }, 403);
        }

        ctx.setHeader("Access-Control-Allow-Origin", allowOrigin);

        // Spec only defines `true`; never pair it with `*`
        if (allowedCredentials && allowOrigin !== "*") {
            ctx.setHeader("Access-Control-Allow-Credentials", "true");
        }

        // Only a real preflight carries Access-Control-Request-Method
        if (ctx.req.method === "OPTIONS" && ctx.req.headers.has("access-control-request-method")) {
            if (maxAge) {
                ctx.setHeader("Access-Control-Max-Age", maxAge.toString());
            }
            return ctx.text("", 204);
        }

        return null;
    } as middlewareFunc
};