import { describe, expect, it } from "bun:test";
import { Context } from "../../ctx";
import { connInfo } from "./index";

describe('deno adaptor: connInfo', () => {

    it('should return null when the context has no server', () => {
        const ctx = new Context(new Request('http://localhost/ip'), undefined, '/ip', undefined, undefined, undefined);
        expect(connInfo(ctx)).toBeNull();
    });

    it('should return the remoteAddr resolved from Deno.serve\'s handler info', () => {
        // Shape verified against a real `Deno.serve` handler's second argument:
        // { transport: "tcp", hostname: "127.0.0.1", port: 53855 }
        const fakeServer = { remoteAddr: { transport: 'tcp', hostname: '127.0.0.1', port: 53855 } };
        const ctx = new Context(new Request('http://localhost/ip'), fakeServer as any, '/ip', undefined, undefined, undefined);
        expect(connInfo(ctx)).toEqual({ transport: 'tcp', hostname: '127.0.0.1', port: 53855 });
    });

    it('should return null when the server info has no remoteAddr', () => {
        const fakeServer = {};
        const ctx = new Context(new Request('http://localhost/ip'), fakeServer as any, '/ip', undefined, undefined, undefined);
        expect(connInfo(ctx)).toBeNull();
    });
});
