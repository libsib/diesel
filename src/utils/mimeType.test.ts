import { describe, expect, it } from "bun:test";
import { getMimeType } from "./mimeType";

describe('getMimeType', () => {
    const cases: Array<[string, string]> = [
        ['file.js', 'application/javascript'],
        ['file.mjs', 'application/javascript'],
        ['file.ts', 'application/typescript'],
        ['file.css', 'text/css'],
        ['file.html', 'text/html'],
        ['file.htm', 'text/html'],
        ['file.txt', 'text/plain'],
        ['file.csv', 'text/csv'],
        ['file.xml', 'application/xml'],
        ['file.json', 'application/json'],
        ['file.md', 'text/markdown'],
        ['file.png', 'image/png'],
        ['file.jpg', 'image/jpeg'],
        ['file.jpeg', 'image/jpeg'],
        ['file.svg', 'image/svg+xml'],
        ['file.gif', 'image/gif'],
        ['file.webp', 'image/webp'],
        ['file.ico', 'image/x-icon'],
        ['file.bmp', 'image/bmp'],
        ['file.avif', 'image/avif'],
        ['file.mp3', 'audio/mpeg'],
        ['file.wav', 'audio/wav'],
        ['file.ogg', 'audio/ogg'],
        ['file.mp4', 'video/mp4'],
        ['file.webm', 'video/webm'],
        ['file.mov', 'video/quicktime'],
        ['file.avi', 'video/x-msvideo'],
        ['file.woff', 'font/woff'],
        ['file.woff2', 'font/woff2'],
        ['file.ttf', 'font/ttf'],
        ['file.otf', 'font/otf'],
        ['file.pdf', 'application/pdf'],
        ['file.zip', 'application/zip'],
        ['file.gz', 'application/gzip'],
        ['file.tar', 'application/x-tar'],
        ['file.wasm', 'application/wasm'],
        ['file.unknownext', 'application/octet-stream'],
        ['file', 'application/octet-stream'],
    ];

    for (const [path, expected] of cases) {
        it(`should map "${path}" to "${expected}"`, () => {
            expect(getMimeType(path)).toBe(expected);
        });
    }

    it('should be case-insensitive on the extension', () => {
        expect(getMimeType('file.PNG')).toBe('image/png');
        expect(getMimeType('file.JPG')).toBe('image/jpeg');
    });

    it('should use the last extension for a multi-dot path', () => {
        expect(getMimeType('archive.tar.gz')).toBe('application/gzip');
    });
});
