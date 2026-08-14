import { ContextType } from "../../types";

export const  securityMiddleware = (ctx: ContextType) => {
    ctx.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    ctx.setHeader("Content-Security-Policy", "default-src 'self'");
    ctx.setHeader("X-Content-Type-Options", "nosniff");
    ctx.setHeader("X-Frame-Options", "DENY");
}