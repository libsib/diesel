import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import Diesel from "../../main"
import { poweredBy } from "./index";
import { ContextType } from "../../types";


describe('powered-by middleware testing', () => {

    const app = new Diesel()


    app.use('/poweredBy', poweredBy())
    app.get('/poweredBy', (c:ContextType) => c.text('root'))

    app.use('/poweredBy2', poweredBy())
    app.use('/poweredBy2', poweredBy())
    app.get('/poweredBy2', (c:ContextType) => c.text('root'))

    app.use('/poweredBy3', poweredBy({ serverName: 'Foo' }))
    app.get('/poweredBy3', (c:ContextType) => c.text('root'))

    let server: ReturnType<typeof Bun.serve>;

    beforeAll(() => {
        server = Bun.serve({ port: 3008, fetch: app.fetch })
    })
    afterAll(() => {
        server.stop(true)
    })


    it('Should return with X-Powered-By header', async () => {
        const res = await fetch("http://localhost:3008/poweredBy")
        expect(res).not.toBeNull()
        expect(res.status).toBe(200)
        expect(res.headers.get('X-Powered-By')).toBe('Diesel')
    })

    it('Should not return duplicate values', async () => {
        const res = await fetch('http://localhost:3008/poweredBy2')
        expect(res).not.toBeNull()
        expect(res.status).toBe(200)
        expect(res.headers.get('X-Powered-By')).toBe('Diesel')
    })

    it('Should return with custom server name', async () => {
        const res = await fetch('http://localhost:3008/poweredBy3')
        expect(res).not.toBeNull()
        expect(res.status).toBe(200)
        expect(res.headers.get('X-Powered-By')).toBe('Foo')
    })
})