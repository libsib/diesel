import { describe, expect, it } from "bun:test";
import { Context } from "../../ctx";
import { connInfo } from "./index";

describe('cloudflare adaptor: connInfo', () => {

    it('should return the CF-Connecting-IP header value', () => {
        const req = new Request('http://localhost/ip', { headers: { 'CF-Connecting-IP': '203.0.113.5' } });
        const ctx = new Context(req, undefined, '/ip', undefined, undefined, undefined);
        expect(connInfo(ctx)).toBe('203.0.113.5');
    });

    it('should return null when the header is absent', () => {
        const req = new Request('http://localhost/ip');
        const ctx = new Context(req, undefined, '/ip', undefined, undefined, undefined);
        expect(connInfo(ctx)).toBeNull();
    });
});
