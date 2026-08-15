import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { unlink } from "node:fs/promises";
import Diesel from "../../main";
import { Context } from "../../ctx";
import type { ContextType } from "../../types";
import { connInfo, file } from "./index";

describe('bun adaptor: connInfo', () => {

    it('should return null when the context has no server', () => {
        const ctx = new Context(new Request('http://localhost/ip'), undefined, '/ip', undefined, undefined, undefined);
        expect(connInfo(ctx)).toBeNull();
    });

    it('should return the address info resolved by server.requestIP', () => {
        const fakeServer = { requestIP: () => ({ address: '203.0.113.5', port: 1234, family: 'IPv4' }) };
        const ctx = new Context(new Request('http://localhost/ip'), fakeServer, '/ip', undefined, undefined, undefined);
        expect(connInfo(ctx)).toEqual({ address: '203.0.113.5', port: 1234, family: 'IPv4' });
    });

    it('should return null when server.requestIP resolves nothing', () => {
        const fakeServer = { requestIP: () => null };
        const ctx = new Context(new Request('http://localhost/ip'), fakeServer, '/ip', undefined, undefined, undefined);
        expect(connInfo(ctx)).toBeNull();
    });

    describe('against a real Bun.serve request', () => {
        const app = new Diesel();
        app.get('/ip', (c: ContextType) => c.text(JSON.stringify(connInfo(c))));

        let server: ReturnType<typeof Bun.serve>;

        beforeAll(() => {
            server = Bun.serve({ port: 3010, fetch: app.fetch as any });
        });
        afterAll(() => {
            server.stop(true);
        });

        it('should resolve the real client IP through the fetch handler', async () => {
            const res = await fetch('http://localhost:3010/ip');
            const body = JSON.parse(await res.text());
            expect(res.status).toBe(200);
            expect(['127.0.0.1', '::1']).toContain(body.address);
        });
    });
});

describe('bun adaptor: file', () => {
    const fixturePath = `${import.meta.dir}/__fixtures__/sample.txt`;
    const fixtureContent = "hello from bun file adaptor";

    beforeAll(async () => {
        await Bun.write(fixturePath, fixtureContent);
    });
    afterAll(async () => {
        await unlink(fixturePath);
    });

    it('should serve the file with a sniffed Content-Type and 200 status', async () => {
        const ctx = new Context(new Request('http://localhost/file'), undefined, '/file', undefined, undefined, undefined);
        const res = file(ctx, fixturePath);

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('text/plain');
        expect(await res.text()).toBe(fixtureContent);
    });

    it('should honor an explicit mimeType override', async () => {
        const ctx = new Context(new Request('http://localhost/file'), undefined, '/file', undefined, undefined, undefined);
        const res = file(ctx, fixturePath, 'application/octet-stream');

        expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    });

    it('should honor a custom status and merge customHeaders', async () => {
        const ctx = new Context(new Request('http://localhost/file'), undefined, '/file', undefined, undefined, undefined);
        const res = file(ctx, fixturePath, undefined, 201, { 'X-Custom': 'yes' });

        expect(res.status).toBe(201);
        expect(res.headers.get('X-Custom')).toBe('yes');
    });

    it('should not clobber a Content-Type already set on ctx.headers', () => {
        const ctx = new Context(new Request('http://localhost/file'), undefined, '/file', undefined, undefined, undefined);
        ctx.setHeader('Content-Type', 'application/x-custom');
        const res = file(ctx, fixturePath);

        expect(res.headers.get('Content-Type')).toBe('application/x-custom');
    });

    describe('against a real Bun.serve request', () => {
        const app = new Diesel();
        app.get('/file', (c: ContextType) => file(c, fixturePath));

        let server: ReturnType<typeof Bun.serve>;

        beforeAll(() => {
            server = Bun.serve({ port: 3011, fetch: app.fetch as any });
        });
        afterAll(() => {
            server.stop(true);
        });

        it('should return the full file body', async () => {
            const res = await fetch('http://localhost:3011/file');
            expect(res.status).toBe(200);
            expect(await res.text()).toBe(fixtureContent);
        });

        it('should support Range requests out of the box', async () => {
            const res = await fetch('http://localhost:3011/file', { headers: { Range: 'bytes=0-4' } });
            expect(res.status).toBe(206);
            expect(res.headers.get('content-range')).toBe(`bytes 0-4/${fixtureContent.length}`);
            expect(await res.text()).toBe(fixtureContent.slice(0, 5));
        });
    });
});
