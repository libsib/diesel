import * as http from 'http';

export interface ConnInfo {
    protocol: string;
    host: string;
    url: string;
    ip?: string;
    headers: Record<string, string | string[]>;
}

export function connInfo(req: http.IncomingMessage | Request): ConnInfo {
    let headers: Record<string, string | string[]> = {};
    if ('headers' in req) {
        if ('get' in req.headers) {
            // @ts-ignore
            headers = Object.fromEntries(req?.headers?.entries() as any);
        } else {
            headers = req.headers as Record<string, string | string[]>;
        }
    }

    const protocol =
        (headers['x-forwarded-proto'] as string)?.split(',')[0] ||
        ('socket' in req && req.socket?.encrypted ? 'https' : 'http');

    const host = headers['host'] as string || '';

    let ip: string | undefined;
    const forwarded = headers['x-forwarded-for'] as string;
    if (forwarded) {
        ip = forwarded.split(',')[0].trim();
    } else if ('socket' in req && req.socket?.remoteAddress) {
        ip = req.socket.remoteAddress;
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
