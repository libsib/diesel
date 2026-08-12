import { Diesel } from "diesel-core"
import { serve } from 'diesel-core/node'

const app = 
new Diesel({
    logger:true
})
    .get("/", (c) => {
        return c.text(`hello from node diesel/`)
    })


serve({
    fetch: app.fetch,
    port: 3000
})