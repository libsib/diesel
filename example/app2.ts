import Diesel from "../src/main";
import jwt from 'jsonwebtoken'
import { logger } from '../src/middlewares/logger/logger'
import { BunRequest } from "bun";
import { ContextType } from "../src/types";
const app = new Diesel()
const port = process.env.PORT || 3000


export async function authJwt(req: BunRequest): Promise<void | Response> {
    const token = req.cookies
    if (!token) {
        return Response.json({ message: "Authentication token missing" }, { status: 401 });
    }
    try {
        const user = jwt.verify(token, "SECRET_KEY");
        req.user = user
    } catch (error) {
        return Response.json({ message: "Invalid token" }, { status: 403 });
    }
}

const msg = "Hi";
app.use(() => {
    console.log(msg)
})

app.addHooks('onRequest', () => { console.log('onRequest') })
app.useLogger(logger)
// app.use(authJwt)

// app.setupFilter()
//     .publicRoutes("/cookie", '/api/user/', '/health')
//     .permitAll()
//     .authenticate([authJwt])

app.addHooks('onError', (err: ErrnoException) => {
    console.log('got an exception ', err)
    return new Response(
        JSON.stringify({ message: err.message, stack: err.stack }),
        {
            headers: { "Content-Type": "application/json" },
            status: 500
        }
    );
});


app.BunRoute('get', '/bun', async () => {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(new Response("Hello bun"));
        }, 1000);
    });
});

app.BunRoute('get', '/bun2', () => new Response("Hello bun/2"))
app.BunRoute('get', '/bun3', { message: "Hello JSON" });
app.BunRoute('get', '/bun4', () => new Response("hell"))

app.get('/err', (ctx) => {
    return new Promise((res, rej) => {
        setTimeout(() => {
            rej(new Error("This is a simulated delayed error!"));
        }, 200);
    })
})



// app.on(['GET', 'POST', 'BREW', 'QUERY'], '/', (c) => c.text("Hello from /"))
app.get("/", (c) => c.text("Hello from /"))


// app.use("/hello", () => console.log("/hello"))
app.get("/hello", (c) => c.send("he;;o"))

app.get("/hello/test", (c) => c.send("he;;o/test"))

app.get("/hello/:id", (c) => {
    const id = c.params.id
    const query = c.query.name
    return c.send(`Hello from /hello/${id} , and here is query:${query}`)
})



// 
const authRt = Diesel.router('/auth')
// authRt.use('/login', () => console.log('from authRt'))
authRt.get("/login", (c) => c.send("/auth login"))

const userRt = Diesel.router('/user')
// userRt.use('/login', () => console.log("from userRt /user"))
userRt.any("/login", (c) => c.send("/user login"))

//
const userRouter = new Diesel({ prefixApiUrl: '/api/user' })
userRouter.get("/login", (c) => c.send("from /api/user/login"))

const userRouter2 = new Diesel()
userRouter2.get("/login", () => {console.log('hei')}, (c) => c.send("login from userRouter 2"))

// app.route('', userRouter)
app.register('/api/user2', userRouter2)

app.listen(port, () => console.log(`server running on ports: ${port}`))
// after listening it wont work
// app.use(() => console.log('afeter listen'))