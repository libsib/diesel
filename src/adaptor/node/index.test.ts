import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as net from "node:net";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import Diesel from "../../main";
import type { ContextType } from "../../types";
import { connInfo, serve, type NodeServer } from "./main";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// send raw bytes so we can use request targets / Host values fetch() won't produce
async function rawRequest(port: number, payload: string): Promise<string> {
    const socket = net.connect(port, '127.0.0.1');
    await once(socket, 'connect');
    socket.write(payload);
    let data = '';
    socket.on('data', (c) => { data += c.toString(); });
    await Promise.race([once(socket, 'end'), once(socket, 'close'), sleep(2000)]);
    socket.destroy();
    return data;
}

async function listen(fetch: (req: Request, ...args: any) => Response | Promise<Response>, trustProxy?: boolean) {
    const server = serve({ port: 0, fetch, trustProxy });
    if (!server.listening) await once(server, 'listening');
    return { server, port: (server.address() as AddressInfo).port };
}

describe('node adaptor: serve', () => {
    let server: NodeServer;
    let base: string;
    let port: number;
    let aborted = false;
    let streamCancelled = false;
    let pulls = 0;

    beforeAll(async () => {
        ({ server, port } = await listen(async (req) => {
            const u = new URL(req.url);
            if (u.pathname === '/echo') return new Response(`${req.method}:${await req.text()}`);
            if (u.pathname.endsWith('/url')) return new Response(req.url);
            if (u.pathname === '/throw') throw new Error('boom');
            if (u.pathname === '/errstream') {
                return new Response(new ReadableStream({
                    start(c) { c.enqueue(new TextEncoder().encode('a')); c.error(new Error('mid-stream')); }
                }));
            }
            if (u.pathname === '/abort') {
                return new Promise((resolve) => {
                    req.signal.addEventListener('abort', () => { aborted = true; resolve(new Response('x')); });
                });
            }
            if (u.pathname === '/stream') {
                return new Response(new ReadableStream({
                    async pull(c) { await sleep(20); pulls++; c.enqueue(new TextEncoder().encode('x\n')); },
                    cancel() { streamCancelled = true; },
                }));
            }
            if (u.pathname === '/ip') return Response.json(connInfo(req));
            if (u.pathname === '/big') return new Response(new Uint8Array(8 * 1024 * 1024).fill(97));
            return new Response('nf', { status: 404 });
        }));
        base = `http://127.0.0.1:${port}`;
    });

    afterAll(() => {
        server.closeAllConnections();
        server.close();
    });

    it('passes PUT, PATCH, POST and DELETE bodies through', async () => {
        for (const method of ['PUT', 'PATCH', 'POST', 'DELETE']) {
            const res = await fetch(`${base}/echo`, { method, body: 'hello' });
            expect(await res.text()).toBe(`${method}:hello`);
        }
    });

    it('streams a large response body intact (backpressure)', async () => {
        const res = await fetch(`${base}/big`);
        expect((await res.arrayBuffer()).byteLength).toBe(8 * 1024 * 1024);
    });

    it('responds 500 when the fetch handler throws instead of hanging', async () => {
        const res = await fetch(`${base}/throw`, { signal: AbortSignal.timeout(2000) });
        expect(res.status).toBe(500);
        // server still serves requests afterwards
        expect((await fetch(`${base}/echo`, { method: 'POST', body: 'ok' })).status).toBe(200);
    });

    it('destroys the socket when the response body errors mid-stream', async () => {
        const raw = await rawRequest(port, 'GET /errstream HTTP/1.1\r\nHost: x\r\n\r\n');
        // the connection is torn down: no complete chunked response (Bun may
        // not even flush the status line before the socket is destroyed)
        expect(raw.endsWith('0\r\n\r\n')).toBe(false);
    });

    it('responds 400 for a malformed Host header', async () => {
        const raw = await rawRequest(port, 'GET /url HTTP/1.1\r\nHost: [::1\r\nConnection: close\r\n\r\n');
        expect(raw.startsWith('HTTP/1.1 400')).toBe(true);
    });

    it('handles an absolute-form request target', async () => {
        const raw = await rawRequest(port, 'GET http://example.com/url?a=1 HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n');
        expect(raw.startsWith('HTTP/1.1 200')).toBe(true);
        expect(raw).toContain('http://example.com/url?a=1');
    });

    it('keeps a "//" path as a path, not a host', async () => {
        const raw = await rawRequest(port, 'GET //evil.com/url HTTP/1.1\r\nHost: good.com\r\nConnection: close\r\n\r\n');
        expect(raw).toContain('http://good.com//evil.com/url');
    });

    it('ignores X-Forwarded-Proto / X-Forwarded-For by default', async () => {
        const raw = await rawRequest(port, 'GET /url HTTP/1.1\r\nHost: h\r\nX-Forwarded-Proto: https\r\nConnection: close\r\n\r\n');
        expect(raw).toContain('http://h/url');
        const info = await (await fetch(`${base}/ip`, { headers: { 'x-forwarded-for': '6.6.6.6' } })).json();
        expect(info.ip).not.toBe('6.6.6.6');
        expect(info.ip).toContain('127.0.0.1');
        expect(info.protocol).toBe('http');
    });

    it('exposes the real socket address via server.requestIP', async () => {
        const app = new Diesel();
        app.get('/ip', (c: ContextType) => c.json(c.server?.requestIP?.(c.req) ?? null));
        const s = await listen(app.fetch);
        try {
            const info = await (await fetch(`http://127.0.0.1:${s.port}/ip`, { headers: { 'x-forwarded-for': '6.6.6.6' } })).json();
            expect(info.address).toContain('127.0.0.1');
            expect(typeof info.port).toBe('number');
        } finally {
            s.server.closeAllConnections();
            s.server.close();
        }
    });

    it('aborts req.signal when the client disconnects', async () => {
        const ctrl = new AbortController();
        const p = fetch(`${base}/abort`, { signal: ctrl.signal }).catch(() => { });
        await sleep(100);
        ctrl.abort();
        await p;
        for (let i = 0; i < 50 && !aborted; i++) await sleep(20);
        expect(aborted).toBe(true);
    });

    it('cancels the response stream when the client disconnects', async () => {
        const socket = net.connect(port, '127.0.0.1');
        await once(socket, 'connect');
        socket.write('GET /stream HTTP/1.1\r\nHost: x\r\n\r\n');
        await once(socket, 'data');
        socket.destroy();
        for (let i = 0; i < 50 && !streamCancelled; i++) await sleep(20);
        expect(streamCancelled).toBe(true);
        const after = pulls;
        await sleep(200);
        expect(pulls - after).toBeLessThanOrEqual(1);
    });
});

describe('node adaptor: serve with trustProxy', () => {
    let server: NodeServer;
    let port: number;

    beforeAll(async () => {
        ({ server, port } = await listen((req) => {
            const u = new URL(req.url);
            if (u.pathname === '/ip') return Response.json(connInfo(req));
            return new Response(req.url);
        }, true));
    });

    afterAll(() => {
        server.closeAllConnections();
        server.close();
    });

    it('honours X-Forwarded-Proto and X-Forwarded-For', async () => {
        const raw = await rawRequest(port, 'GET /url HTTP/1.1\r\nHost: h\r\nX-Forwarded-Proto: https\r\nConnection: close\r\n\r\n');
        expect(raw).toContain('https://h/url');
        const info = await (await fetch(`http://127.0.0.1:${port}/ip`, {
            headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'x-forwarded-proto': 'https' },
        })).json();
        expect(info.ip).toBe('203.0.113.7');
        expect(info.protocol).toBe('https');
    });
});
