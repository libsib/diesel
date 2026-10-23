import * as http from 'node:http'
import type { RuntimeServer } from '../../types'
import { connInfo, getNodeRequest, registerNodeRequest, type ConnInfo, type ConnInfoOptions } from './conninfo'

export { connInfo, type ConnInfo, type ConnInfoOptions }

export interface options {
    fetch: (req: Request, ...args: any) => Response | Promise<Response>
    port: number
    /**
     * Trust `X-Forwarded-Proto` (request URL scheme) and `X-Forwarded-For`
     * (`connInfo().ip`). Only enable behind a proxy that sets/overwrites
     * these headers - clients can send them too. Defaults to `false`.
     */
    trustProxy?: boolean
}

export type NodeServer = http.Server<typeof http.IncomingMessage, typeof http.ServerResponse> & Required<Pick<RuntimeServer, 'requestIP'>>

class BadRequestError extends Error { }

function buildUrl(req: http.IncomingMessage, trustProxy: boolean): URL {
    const socket = req.socket as http.IncomingMessage['socket'] & { encrypted?: boolean }
    const protocol = (trustProxy && (req.headers['x-forwarded-proto'] as string)?.split(',')[0].trim())
        || (socket?.encrypted ? 'https' : 'http');
    const target = req.url || '/';
    try {
        // origin-form ("/path?q"). Concatenate rather than resolve against a
        // base, so "//evil.com/x" stays a path instead of becoming a host.
        if (target[0] === '/') {
            return new URL(`${protocol}://${req.headers.host || 'localhost'}${target}`);
        }
        // absolute-form ("GET http://host/path HTTP/1.1"), sent to proxies
        // but valid for any server to receive (RFC 9112 3.2.2).
        const url = new URL(target);
        if (url.protocol === 'http:' || url.protocol === 'https:') return url;
    } catch { }
    throw new BadRequestError(`invalid request target: ${target}`);
}

function convertNodeReqToWebReq(req: http.IncomingMessage, signal: AbortSignal, trustProxy: boolean) {
    const url = buildUrl(req, trustProxy);

    const init: RequestInit = {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: null,
        signal,
    }
    const contentLength = req.headers['content-length'];
    const hasBody = req.headers['transfer-encoding'] !== undefined
        || (contentLength !== undefined && contentLength !== '0');
    if (req.method !== 'GET' && req.method !== 'HEAD' && hasBody) {
        init.body = new ReadableStream<Uint8Array>({
            start(controller) {
                req.on('data', (chunk) => {
                    controller.enqueue(new Uint8Array(chunk));
                    // respect the consumer's pace instead of buffering the
                    // whole upload in memory
                    if ((controller.desiredSize ?? 1) <= 0) req.pause();
                });
                req.on('end', () => controller.close());
                req.on('error', (err) => controller.error(err));
            },
            pull() {
                req.resume();
            },
            cancel() {
                req.destroy();
            }
        });
        // undici's Request constructor throws "RequestInit: duplex option is
        // required when sending a body" unless duplex is set when a streaming
        // body is present.
        (init as RequestInit & { duplex: 'half' }).duplex = 'half';
    }
    return new Request(url, init);
}



async function sendWebResToNodeRes(webRes: Response, nodeRes: http.ServerResponse) {
    // Object.fromEntries(webRes.headers) collapses repeated header names
    // (e.g. multiple Set-Cookie headers) down to the last value, silently
    // dropping every cookie but the last one set. Set headers individually
    // instead, and pass all Set-Cookie values through as an array.
    webRes.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') {
            nodeRes.setHeader(key, value)
        }
    })
    const cookies = webRes.headers.getSetCookie()
    if (cookies.length) {
        nodeRes.setHeader('Set-Cookie', cookies)
    }
    nodeRes.writeHead(webRes.status)
    const reader = webRes.body?.getReader()
    if (reader) {
        // client went away: stop pulling from the response stream so its
        // cancel() runs instead of producing chunks nobody will read
        const onClose = () => { reader.cancel().catch(() => { }) }
        nodeRes.once('close', onClose)
        try {
            let result
            while (!(result = await reader.read()).done) {
                if (nodeRes.destroyed) break
                if (!nodeRes.write(result.value)) {
                    await new Promise<void>((resolve) => {
                        const done = () => {
                            nodeRes.off('drain', done)
                            nodeRes.off('close', done)
                            resolve()
                        }
                        nodeRes.on('drain', done)
                        nodeRes.on('close', done)
                    })
                }
            }
        } finally {
            nodeRes.off('close', onClose)
        }
    }
    if (!nodeRes.destroyed) nodeRes.end()
}

export function serve(options: options): NodeServer {
    const trustProxy = options.trustProxy === true

    const server = http.createServer(async (request, response) => {
        const controller = new AbortController()
        response.once('close', () => {
            if (!response.writableFinished) controller.abort()
        })

        try {
            const webRequest = convertNodeReqToWebReq(request, controller.signal, trustProxy);
            registerNodeRequest(webRequest, request, trustProxy)

            // send our req to diesel's fetch handler
            const webRes = await options.fetch(webRequest, server)
            await sendWebResToNodeRes(webRes, response)
        } catch (err) {
            if (response.destroyed) return
            if (!response.headersSent) {
                const badRequest = err instanceof BadRequestError
                if (!badRequest) console.error(err)
                response.writeHead(badRequest ? 400 : 500, { 'Content-Type': 'text/plain; charset=utf-8' })
                response.end(badRequest ? 'Bad Request' : 'Internal Server Error')
            } else {
                console.error(err)
                response.destroy(err as Error)
            }
        }
    }) as NodeServer

    // same shape as Bun's server.requestIP(), so `ctx.server.requestIP(ctx.req)`
    // returns the real socket address under node too
    server.requestIP = (req: Request) => {
        const socket = getNodeRequest(req)?.socket
        if (!socket?.remoteAddress) return null
        return { address: socket.remoteAddress, port: socket.remotePort, family: socket.remoteFamily }
    }

    server.listen(options.port ?? 3000, () => console.log(`node server running on port ${options.port ?? 3000}`))
    return server;
}
