import * as http from 'http';

export interface ConnInfo {
    protocol: string;
    host: string;
    url: string;
    ip?: string;
    headers: Record<string, string | string[]>;
}

export interface ConnInfoOptions {
    /**
     * Honour `X-Forwarded-For` / `X-Forwarded-Proto`. Only enable this when
     * the server sits behind a proxy you control that overwrites those
     * headers - otherwise any client can spoof its IP and scheme.
     * Defaults to the `trustProxy` option passed to `serve()` for requests
     * created by the node adaptor, and to `false` otherwise.
     */
    trustProxy?: boolean;
}

interface NodeRequestInfo {
    incoming: http.IncomingMessage;
    trustProxy: boolean;
}

// web Request (built by the node adaptor) -> the node request it came from,
// so the real socket address can still be resolved from the web Request.
const requestInfo = new WeakMap<Request, NodeRequestInfo>();

/** @internal used by the node adaptor's serve() */
export function registerNodeRequest(req: Request, incoming: http.IncomingMessage, trustProxy: boolean) {
    requestInfo.set(req, { incoming, trustProxy });
}

/** @internal */
export function getNodeRequest(req: Request): http.IncomingMessage | undefined {
    return requestInfo.get(req)?.incoming;
}

export function connInfo(req: http.IncomingMessage | Request, options?: ConnInfoOptions): ConnInfo {
    let headers: Record<string, string | string[]> = {};
    if ('headers' in req) {
        if ('get' in req.headers) {
            // @ts-ignore
            headers = Object.fromEntries(req?.headers?.entries() as any);
        } else {
            headers = req.headers as Record<string, string | string[]>;
        }
    }

    let incoming: http.IncomingMessage | undefined;
    let trustProxy = options?.trustProxy;
    if (req instanceof Request) {
        const info = requestInfo.get(req);
        incoming = info?.incoming;
        trustProxy ??= info?.trustProxy;
    } else {
        incoming = req;
    }

    const socket = incoming?.socket as (http.IncomingMessage['socket'] & { encrypted?: boolean }) | undefined;

    const protocol =
        (trustProxy && (headers['x-forwarded-proto'] as string)?.split(',')[0].trim()) ||
        (socket?.encrypted ? 'https' : 'http');

    const host = headers['host'] as string || '';

    let ip: string | undefined;
    const forwarded = trustProxy ? headers['x-forwarded-for'] as string : undefined;
    if (forwarded) {
        ip = forwarded.split(',')[0].trim();
    } else if (socket?.remoteAddress) {
        ip = socket.remoteAddress;
    }

    const url =
        'url' in req
            ? req.url!
            : `${protocol}://${host}${(req as any).url || ''}`;

    return {
        protocol,
        host,
        url,
        ip,
        headers,
    };
}
