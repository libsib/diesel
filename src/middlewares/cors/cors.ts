import { middlewareFunc } from "../../types";

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
        ctx.setHeader("Access-Control-Allow-Credentials", allowedCredentials.toString());

        if (exposedHeaders.length > 0) {
            ctx.setHeader("Access-Control-Expose-Headers", exposedHeaders.join(","));
        }

        if (allowedOrigins === "*" || origin === "*") {
            ctx.setHeader("Access-Control-Allow-Origin", "*");
        } else if (Array.isArray(allowedOrigins)) {
            if (origin && allowedOrigins.includes(origin)) {
                ctx.setHeader("Access-Control-Allow-Origin", origin);
            } else if (allowedOrigins.includes("*")) {
                ctx.setHeader("Access-Control-Allow-Origin", "*");
            } else {
                return ctx.json({ message: "CORS not allowed" }, 403);
            }
        } else if (typeof allowedOrigins === "string") {
            if (origin === allowedOrigins) {
                ctx.setHeader("Access-Control-Allow-Origin", origin);
            } else {
                return ctx.json({ message: "CORS not allowed" }, 403);
            }
        } else {
            return ctx.json({ message: "CORS not allowed" }, 403);
        }

        if (ctx.req.method === "OPTIONS") {
            if (maxAge) {
                ctx.setHeader("Access-Control-Max-Age", maxAge.toString());
            }
            return ctx.text("", 204);
        }

        return null;
    } as middlewareFunc
};