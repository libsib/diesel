import Diesel from "../src/main";
import jwt from "jsonwebtoken";
import { ContextType, CookieOptions } from "../src/types";
import homapge from './templates/index.html'
import aboutpage from './templates/about.html'
import { cors } from "../src/middlewares/cors/cors";
import { securityMiddleware } from "../src/middlewares/security/security";
import { fileSaveMiddleware } from '../src/middlewares/filesave/savefile'
import { advancedLogger, logger } from '../src/middlewares/logger/logger'
import { rateLimit } from '../src/middlewares/ratelimit/rate-limit'
// import {loadRoutes} from 'ex-router'
import { poweredBy } from '../src/middlewares/powered-by/index'
import { authenticateJwt } from '../src/middlewares/jwt/index'
import { redis } from './src/utils/redis'
import { RedisStore } from "../src/middlewares/ratelimit/implementation";
import { requestId } from '../src/middlewares/request-id/index'
import { Context } from "../src/ctx";
const app = new Diesel({
});

const SECRET_KEY = "linux";
// this is my external lib fro file based routing
// loadRoutes(app,{
//   routeDir:process.cwd()+'/src/routes'
// })
const port = 3000


// Authentication Middleware
export async function authJwt(ctx: ContextType): Promise<undefined | Response> {
  const token = ctx.cookies?.accessToken
  if (!token) {
    return ctx.json({ message: "Authentication token missing" }, 401);
  }
  try {
    const user = jwt.verify(token, SECRET_KEY);
    ctx.set('user', user);
  } catch (error) {
    return ctx.json({ message: "Invalid token" }, 403);
  }
}

app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}))


// app.setupFilter()
//   .publicRoutes("/cookie", '/api/user/', '/health')
//   .permitAll()
//   // .authenticateJwt(jwt)

//   .authenticate([authJwt])


// app.use(authenticateJwt({
// app,
// jwt,
// routes:['/ok']
// }))
// const redisStore = new RedisStore(redis)
// app.use(rateLimit({
//   windowMs: 10000, 
//   max: 5,
//   message: "Too many requests, please try again later.",
//   store: redisStore
// }))



app.use('/body', fileSaveMiddleware({ fields: ["avatar"] }));

// app.use(securityMiddleware)

app.use(requestId())
app.useLogger(logger)
// app.useAdvancedLogger(advancedLogger)

// app.use(requestId())

app.get('/reqid', (ctx) => {
  const reqId = ctx.get('requestId')
  return ctx.json({ reqId: reqId })
})

// app.use((ctx) => ctx.send("hhhh"))
//app.addHooks('onRequest', () => console.log('first'))
//app.addHooks('onRequest', () => console.log('second'))
app.get("/ok", (ctx) => {
  return ctx.send({ msg: "hello world" })
})

app.routeNotFound(async (ctx) => {
  const file = await Bun.file(`${import.meta.dir}/templates/routenotfound.html`)
  return new Response(file, { status: 404 })
})


// import homapge from './templates/index.html'
// import aboutpage from './templates/about.html'
// app.staticHtml(
//   {
//     "/":homapge,
//     "/about":aboutpage
//   }
// )

app.redirect("/name/:name/:age", "/redirect/:name/:age")
app.get("/redirect/:name/:age", (ctx) => {
  const params = ctx.params
  const query = ctx.query
  return ctx.json({
    msg: "from redirect",
    params: params,
    query: query
  })
})

// app.static(`${import.meta.dirname}/public`)

// app.get("*",() => new Response(Bun.file(`${import.meta.dirname}/public/index.html`)) )

app.get('/health', (ctx: ContextType) => {
  return ctx.send("lady boy im healthy")
})

app.get("/str", async (c) => {
  return c.yieldStream(async function* () {
    yield "Hello",
      yield " ",
      yield "World!";
  })
});

app.get("/stream", async (c: Context) => {

  c.setHeader('Content-Type','text/event-stream')
  return c.stream(async (controller) => {
    controller.enqueue("from")
    await Bun.sleep(1000)
    controller.enqueue("/stream method")
    await Bun.sleep(1000)
    controller.enqueue("kaisa laga??")
    await Bun.sleep(1000)
  })

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue("hello ");
      await Bun.sleep(2000)
      controller.enqueue("world");
      await Bun.sleep(1000)
      controller.enqueue('kaise ho bhai?')
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream'
    }
  })
});

app.get('/r', () => {
  return Response.json({ msg: "Hello world" })
})

app.get('/txt', (c) => {
  return c.text("txt")
})


app.get("/", async (ctx: ContextType) => {
  const headers = ctx.headers
  return ctx.json({
    msg: "Sending headers",
    header: headers
  })
});

app
  .get('/rd', (ctx) => {
    return ctx.redirect('/test/pradeep/23')
  })
  .head("/", (ctx: ContextType) => {
    return ctx.send("")
  })
  .post("/", (ctx) => ctx.json({ status: true, message: "from post" }))
  .any("/any", (ctx) => {
    return ctx.json({ msg: "any" })
  })
  .post("/post", fileSaveMiddleware, (ctx) => {
    return ctx.json({ msg: "post" })
  })
  .get("/test/:id/:name", (ctx: ContextType) => {
    const id = ctx.params.id
    const name = ctx.params.name
    console.log(ctx.params.name)
    return ctx.text("How are you? " + id + name);
  })
  .get("/err", (ctx) => {
    throw new Error("Somethin`g went wrong yes");
  })
  .get("/query", async (ctx) => {
    const name = ctx.query.name
    const age = ctx.query.age
    const q = ctx.query
    // console.log(name,age)
    const cookie = ctx.cookies.accessToken
    return ctx.json({ name, age, Allquery: q })
  })

  .post("/body", async (ctx) => {
    const { name } = await ctx.body
    console.log(name)
    return ctx.json({
      msg: "from body",
      name: name
    })
  })


  .get("/cookie", (ctx: ContextType) => {
    const accessToken = jwt.sign({ userId: "123" }, SECRET_KEY, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ userId: "123" }, SECRET_KEY, { expiresIn: '7d' });

    // Set cookies
    const cookieOptions: CookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60,
    };

    ctx.setCookie('accessToken', accessToken, cookieOptions);
    ctx.setCookie('refreshToken', refreshToken, cookieOptions);

    return ctx.json({ message: "Cookies set successfully" });
  });


app.get("/too", (ctx) => { return ctx.send("GETTT too") })
app.post('/too', (ctx) => { return ctx.send("Send posstt") })

app.get("/ejs", async (ctx: ContextType) => {
  return await ctx.ejs(`${import.meta.dirname}/templates/look.ejs`, { name: "linux" })
})

// app.route("/api/user", userRoute)

// app.listen(port, () => {
//   console.log(`Server is running on port ${port}`);
// })


const shutdown = (): any => {
  app.close();
  process.exit()
};

app.get('/api/user', (ctx) => { return ctx.send("GETTT user") })
app.post('/api/user', (ctx) => { return ctx.send("Send posstt user") })

const fetchapp = app.fetch
Bun.serve({
  port,
  routes: {
    '/*': homapge,
    '/api/*': fetchapp as any
  },
})
console.log(`Server is running on port ${port}`);


process.on('SIGTERM', shutdown)
process.on("SIGINT", shutdown);
