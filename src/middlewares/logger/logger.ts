import Diesel from "../../main";
import { ContextType } from "../../types";

enum LogPrefix {
    Outgoing = "-->",
    Incoming = "<--",
    Error = "xxx",
}

type LogLevel = 'info' | 'warn' | 'error'

type LogMeta = {
    method?: string
    url?: string
    status?: number
    duration?: string
    error?: string
    headers?: Record<string, string | null>
    reqId?: string
}

const COLORS = {
    reset: "\x1b[0m",
    info: "\x1b[36m",   // Cyan
    warn: "\x1b[33m",   // Yellow
    error: "\x1b[31m",  // Red
    method: {
        GET: "\x1b[32m",     // Green
        POST: "\x1b[34m",    // Blue
        PUT: "\x1b[35m",     // Magenta
        DELETE: "\x1b[31m",  // Red
        PATCH: "\x1b[36m",   // Cyan
    },
};



const log = (level: LogLevel, message: string, meta?: LogMeta) => {
    const color = COLORS[level] || COLORS.reset;
    const methodColor = meta?.method
        ? COLORS.method[meta.method as keyof typeof COLORS.method] || COLORS.reset
        : COLORS.reset;
    const statusColor = meta?.status
        ? meta.status >= 500
            ? COLORS.error
            : meta.status >= 400
                ? COLORS.warn
                : COLORS.info
        : COLORS.reset;

    console.log(
        `\n${color}[${level.toUpperCase()}]${COLORS.reset
        } ${message} - ${methodColor}${meta?.method || ""}${COLORS.reset}`
    );

    const formattedMeta = {
        timestamp: new Date().toISOString(),
        ...meta,
        status: meta?.status
            ? `${statusColor}${meta.status}${COLORS.reset}`
            : undefined,
        method: meta?.method
            ? `${methodColor > color}${meta.method}${COLORS.reset}`
            : undefined,
    };

    console.log(JSON.stringify(formattedMeta, null, 2) + "\n");
};

export type AdvancedLoggerOptions = {
    app: Diesel
    logger?: () => void;
    logLevel?: LogLevel
    onRequest?: (ctx: ContextType) => void
    onSend?: (ctx: ContextType) => Response | void | Promise<Response | void>
    onError?: (error: Error, path: string, req: Request) => Response | void | Promise<Response | void>
}

export const advancedLogger = (options?: AdvancedLoggerOptions) => {
    const {
        app,
        logger,
        logLevel = 'info',
        onRequest,
        onSend,
        onError,
    } = options || {};

    app?.addHooks('onRequest', (ctx: ContextType) => {
        ctx.req.startTime = Date.now();

        logger?.() ?? log(logLevel, 'Incoming Request', {
            method: ctx.req.method,
            url: ctx.path!,
            headers: {
                'user-agent': ctx.req.headers.get('user-agent'),
                'content-type': ctx.req.headers.get('content-type'),
            },
        });

        onRequest?.(ctx);
    });

    app?.addHooks('onSend', async (ctx: ContextType, finalResult: Response): Promise<Response | undefined> => {
        const duration = `${Date.now() - ctx.req.startTime}ms`;

        logger?.() ?? log(logLevel, 'Response Sent', {
            method: ctx.req.method,
            url: ctx.url.toString(),
            status: finalResult.status,
            duration,
            reqId: ctx.get?.('requestId'),
            headers: {
                'content-type': finalResult.headers.get('content-type'),
            },
        });

        const res = await onSend?.(ctx);

        if (res instanceof Response) return res;
    });

    app?.addHooks('onError', async (error: Error, path: string, req: Request) => {
        logger?.() ?? log('error', 'Unhandled Error', {
            method: req.method,
            url: path,
            status: 500,
            error: error.message,
        });

        const res = await onError?.(error, path, req);
        if (res instanceof Response) return res;
    });
};



const logFormatted = (
    prefix: LogPrefix,
    method: string,
    path: string,
    status: number = 0,
    elapsed?: string,
    reqId?: string
) => {
    const methodColor =
        COLORS.method[method as keyof typeof COLORS.method] || COLORS.reset;
    const statusColor =
        status >= 500 ? COLORS.error : status >= 400 ? COLORS.warn : COLORS.info;

    const reqIdTag = reqId ? `[${reqId}] ` : "";
    const message =
        prefix === LogPrefix.Incoming
            ? `${prefix} ${methodColor}${method}${COLORS.reset} ${path} ${reqIdTag}`
            : `${prefix} ${methodColor}${method}${COLORS.reset
            } ${path} ${statusColor}${status}${COLORS.reset} ${elapsed ?? ""} ${reqIdTag}`;
    console.log(message);
};

const timeElapsed = (start: number) => {
    const delta = Date.now() - start;
    return delta < 1000 ? `${delta}ms` : `${Math.round(delta / 1000)}s`;
};

export type LoggerOptions = {
    app: Diesel;
    log?: () => void;
    onRequest?: (req: Request, pathname: string) => void;
    onSend?: (ctx: ContextType) => Response | Promise<Response> | void;
    onError?: (
        error: Error,
        pathname: string,
        req: Request,
    ) => Response | Promise<Response> | void;
};

export const logger = (options: LoggerOptions) => {
    const { app, log, onRequest, onSend, onError } = options;

    app.addHooks("onRequest", (ctx: ContextType) => {
        const req = ctx.req
        const pathname = ctx.path
        req.startTime = Date.now();
        log?.() ?? logFormatted(LogPrefix.Incoming, req.method, pathname!);

        onRequest?.(req, pathname!);
    });

    app.addHooks("onSend", async (ctx: ContextType, finalResult: Response): Promise<Response | undefined> => {
        const { method, url } = ctx.req;
        const path = new URL(url).pathname;
        const reqId = ctx.get?.('requestId')
        log?.() ??
            logFormatted(
                LogPrefix.Outgoing,
                method,
                path,
                finalResult?.status,
                timeElapsed(ctx.req.startTime),
                reqId as string
            );

        const res = await onSend?.(ctx);
        return res instanceof Response ? res : finalResult;
    });

    app.addHooks("onError", async (error: Error, path: string, req: Request) => {
        const pathname = req.path!
        log?.() ??
            logFormatted(error.message as LogPrefix, req.method, pathname, 500);

        const res = await onError?.(error, pathname, req);
        if (res instanceof Response) return res;
    });
};
