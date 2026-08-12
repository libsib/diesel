import Diesel from "../lib/main";
import { ContextType } from "../lib/types";
import { HTTPException } from '../lib/http-exception';
import FindMyWay from 'find-my-way'
import { FindMyWayRouter } from "../lib/router/find-my-way";
import { TrieRouter2 } from '../lib/router/trie2'
import { Context } from "../lib/ctx";


// const t2 = new TrieRouter2()


const app = new Diesel({
    errorFormat: 'text',
    // logger: true,
    // router: 'fastify',
    pipelineArchitecture: false
    // routerInstance: t2
    // router: 'fastify',
})


const msg = "hhhhh"

function addMiddleware() {
    // app.use(() => console.log(msg))

    app.use(async () => { console.log("hi") })

    // app.useAdvancedLogger({ app })

    app.addHooks('preHandler', () => {
        console.log('pre Handler hook hun mai')
    })

    // app.routeNotFound((ctx) => {
    //     return ctx.send(`nahi mila ye route ${ctx.path}`)
    // })

    // app.use('/power', (ctx) => {
    //     console.log('power middleware')
    // })
}

// addMiddleware()

app.get('/user/:id', (ctx: ContextType): Response => {
    const p = ctx.req
    const id = ctx.params.id
    console.log('id ', id)
    return ctx.text(id)
})


app.BunRoute('get', '/bun', "Helll")

app.static('', '')
// app.get('*', (c) => c.text("hello"))

app.get("/", (ctx: Context) => {
    // const ip = ctx.ip
    // console.log('ip ', ip)
    ctx.setHeader("access-control-allow-origin", "pradeep.com")
    ctx.setHeader("Content-Type", "application/json; charset=utf-8")
    return ctx.send("name",200,{
        "Content-Type":"text/plain; charset=utf-8"
    })
})

class UserService {
    users: Array<Object>
    constructor() {
        this.users = [
            {
                name: "pradeep",
                age: 20
            },
            {
                name: "pk",
                age: 2
            },
        ]
    }

    getUser = async (ctx: ContextType): Promise<Response> => {
        return new Promise((resolve, reject) => {
            // reject(new Error("User Not Found 404"))
            // console.log(this.users)
            resolve(Response.json({ users: this.users }))
        })
    }
}

const userService = new UserService()
app.BunRoute('get', '/user', userService.getUser)

// app.use(async() => console.log('hloblalsssss'), async() => console.log("2nd"), () => console.log("3rd"))
// app.use(async() => console.log('hloblal'))
// app.use('/power', () => console.log('power middleware'))
app.get("/power", (ctx: Context) => {
    return ctx.text("/power")
})


app.get('/async', (ctx: Context): any => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve(ctx.text("maybe resolved"))
        }, 600);
    })
})

app.get('/stream', (c: Context) => {
    c.setHeader('Content-Type', 'text/event-stream')
    return c.stream(
        async (controller) => {
            controller.enqueue("Hello ")
            await Bun.sleep(200)
            controller.enqueue('World!')
            controller.close()
        }
    )
})

app.get('/err', (ctx: ContextType) => {
    // throw new Error("async error");
    throw new HTTPException(400, { res: ctx.json({ msg: "error shwn" }) })
    throw new HTTPException(400, { message: "hehhehe", cause: 'casueeee' })
})
app.get('/aerr', async (ctx: Context) => {
    await someAsyncTask();
    throw new Error("async error");
});


function someAsyncTask() {

}

// app.use('/', someAsyncTask)
// app.use('/', () => console.log(''), () => new Response("hello2"))

app.get('/hello/2', (ctx: Context) => ctx.send("/hello/2"))
app.get('/hello/:id/:name', (ctx: Context) => ctx.send('/helo/;id/;name'))


const ur = new Diesel()
// ur.use("/", () => console.log("/* middleware"))
// ur.use("/*", () => console.log("ur/* middleware"))
ur.get('/', () => console.log("path midl"), () => new Response("/ hello ur"))

app.route('/ur', ur)


const router = Diesel.router('/router')
router.use(async function () { console.log("router middleware") })
router.get('/', (c: Context) => c.text("from /router"))



app.listen(3000, () => console.log("diesel running on 3000"))


// Bun.serve({
//     port: 3000,
//     fetch: app.fetch as any
// })

