[![Downloads](https://img.shields.io/npm/dm/@nativecn/cli.svg)](https://www.npmjs.com/package/diesel-core)

### [Read the docs](https://diesel-core.vercel.app/)

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://buymeacoffee.com/pradeepxyz)

# DieselJS


**Diesel** is a simple and lightweight HTTP server library for Bun.js that provides you with complete control over your API routes and middleware. It is designed to be intuitive and efficient, allowing you to quickly set up a server, define routes, and optimize important paths for faster response times. started this on 5th october 2024

**Now Supports Node.js & Cloduflare adaptors**


## Installation
Install diesel-core via bun | npm | yarn | pnpm 

```bash
npm install diesel-core
```
```bash
bun add diesel-core
```

### Code Example
```javascript
import {Diesel}  from "diesel-core"

const app = new Diesel()
const port = 3000

app.get("/", async (ctx:ContextType) => {
 return ctx.text("Hello world...!",200)
 // Note :- passing statusCode is optional
})

// Start the server
app.listen(port, () => {
  console.log(`diesel is running on port ${port}`)
})
```
# HttpMethods 
**In Diesel there are almost all http methods that you can use**

```javascript
app.get() app.post() app.put() 
app.patch() app.delete() app.any() 
app.head() app.options() , app.onMethod(method,path,handler)
```
# Cloudflare workers

### now you can use diesel.js for cloudflare workers apis

```ts
import {Diesel} from "diesel-core"
const app = new Diesel({
    platform: 'cf',
    logger: true
})
.get("/", (ctx) => ctx.text("Welcome to Diesel.js on Cloudflare Workers!"));

export default {
  fetch: app.fetch()
}

```
**Note make sure to add platform:'cf' & call fetch(), it gives you real fetch handler**

# Node.js adaptor
### Now you can use Diesel.js for Node.js

```ts
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
    fetch: app.fetch(),
    port: 3000
})
```

# CORS

### Diesel supports CORS out of the box

``` ts
import { cors } from "diesel-core/cors";

app.use(cors({
  origin: ['http://localhost:5173', 'https://myapp.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
```

# Filter and Route Security
**Diesel** provides a `filter` middleware (`diesel-core/filter`) to manage public and protected routes. You register it like any other middleware via `app.use()`: list which routes are publicly accessible, and every other route runs through your authentication middleware.

### How to Use the Filter
Import `filter` from `diesel-core/filter` and pass it to `app.use()`. Use `publicRoutes` for routes that should skip authentication, and `authenticate` for the middleware(s) that guard everything else.


### Example Usage
```typescript
import { Diesel } from "diesel-core";
import { filter } from "diesel-core/filter";
import jwt from 'jsonwebtoken';

const app = new Diesel();

async function authJwt(ctx: ContextType): Promise<void | Response> {
  const token = ctx.cookies?.accessToken;
  if (!token) {
    return ctx.json({ message: "Authentication token missing" }, 401);
  }
  try {
    const user = jwt.verify(token, secret);
    ctx.set('user', user);
  } catch (error) {
    return ctx.json({ message: "Invalid token" }, 403);
  }
}

// Public routes skip authJwt entirely; everything else runs through it
app.use(filter({
  publicRoutes: ['/api/user/register', '/api/user/login', '/cookie'],
  authenticate: [authJwt],
}));

// Public route (no auth required)
app.get("/api/user/register", async (ctx: ContextType) => {
  return ctx.json({ msg: "This is a public route. No authentication needed." });
});

// Protected route (requires auth)
app.get("/api/user/profile", async (ctx: ContextType) => {
  const user = ctx.get("user");
  return ctx.json({ msg: "You are authenticated!", user });
});

const port = 3000;
app.listen(port, () => {
  console.log(`Diesel is running on port ${port}`);
});
```
# Filter Options
1. **publicRoutes: string[]** : Routes listed here are ***public*** and skip `authenticate` entirely. Matched by path prefix.

```javascript 
filter({ publicRoutes: ['/api/user/register', '/api/user/login'] })
```
2. **authenticate: middlewareFunc[]** : One or more middleware functions, run in order, on every route not listed in `publicRoutes`.

*Note* : If `authenticate` is empty and the route isn't public, `filter` returns an "Unauthorized" response by default.
```javascript 
filter({ authenticate: [authJwt] })

filter({ authenticate: [authJwt, rateLimiter] }) // chain multiple auth middlewares
```
3. **Combining with `diesel-core/jwt`** : Use the built-in JWT helper as one of your `authenticate` middlewares instead of writing your own.

```javascript
import { authenticateJwt } from "diesel-core/jwt";

const app = new Diesel({ jwtSecret: "your-secret" });
app.use(filter({
  publicRoutes: ['/login'],
  authenticate: [authenticateJwt({ app, jwt })],
}));
```

## Use Case
 * **Public Routes** :  Routes like `/api/user/register` or `/api/user/login` are open to all users. List them in `publicRoutes`.

 * **Protected Routes** : All other routes run through `authenticate`, e.g. `authenticate: [authJwt]` or `authenticate: [authenticateJwt({...})]` from `diesel-core/jwt`.

# Using Hooks in DieselJS

DieselJS allows you to enhance your request handling by utilizing hooks at various stages of the request lifecycle. This gives you the flexibility to execute custom logic for logging, authentication, data manipulation, and more.


### Available Hooks

1. **onRequest**: Triggered when a request is received.
2. **preHandler**: Invoked just before the request handler executes.
<!-- 3. **postHandler**: Executed after the request handler completes but before sending the response. -->
3. **onSend**: Called just before the response is sent to the client.
4. **onError** : Executes if any error occurs

### How to Define Hooks

To define hooks in your DieselJS application, you can add them directly to your `Diesel` instance. Here's how to set up and use each hook:

### Example Usage

```javascript

// onError hook: receives (error, path, req)
app.addHooks("onError", (error, path, req) => {
  console.log(`Error on ${req.method} ${path}: ${error.message}`)
  // optionally return a Response to override the default error response
})

// onRequest hook: receives ctx
app.addHooks("onRequest", (ctx) => {
    console.log(`Request received: ${ctx.req.method} ${ctx.path}`);
})

// preHandler hook: receives ctx, return a Response to stop the request
app.addHooks("preHandler", (ctx) => {
  const authToken = ctx.req.headers.get("Authorization");
  if (!authToken) {
    return new Response("Unauthorized", { status: 401 });
  }
})

// onSend hook: receives ctx and the outgoing result Response
app.addHooks('onSend', async (ctx, result) => {
  console.log(`Sending response with status: ${result.status}`);
  return result; // return a modified response or the original
});
```

# Middleware example

**No Need to call NonSense *next()* in Middleware**

**just dont return , if evrything goes right**

```javascript
async function authJwt (ctx:ContextType): Promise<void | Response> {
  
  try {
    const token = ctx.cookies?.accessToken
    if (!token) {
      return ctx.json({ message: "Authentication token missing" },401);
    }
    // Verify the JWT token using a secret key
    const user = jwt.verify(token, secret);
    ctx.set('user',user);
  } catch (error) {
    return ctx.json({ message: "Invalid token" },403);
  }
}

// this is a global middleware
app.use(authJwt)
OR 
app.use(authJwt,middleware2 , ...)

// path middleware example
app.use("/user",authJWT)
OR
// app.use(["/user","/home"],[authJWT,middleware2])
//means /user and /home has two middlewares


```

# set cookies

```javascript
app.get("/set-cookie", async(ctx:ContextType) => {
  const user = {
    name: "pk",
    age: 22,
  }

  const accessToken = jwt.sign(user, secret, { expiresIn: "1d" })

  const refreshToken = jwt.sign(user, secret ,{ expiresIn: "10d" })

  const options = {
    httpOnly: true, 
    secure: true, 
    maxAge: 24 * 60 * 60 * 1000, 
    sameSite: "Strict", 
    path: "/", 
  }

  ctx
  .setCookie("accessToken", accessToken, options)
  .setCookie("refreshToken", refreshToken, options)

  return ctx.json({msg:"setting cookies"})
})
```

# Render a HTML page
```javascript
app.get("/render",async (ctx) => {
  return ctx.file(`${import.meta.dir}/index.html`)
})
```
# redirect
```javascript
app.get("/redirect",(ctx:ContextType) => {
  return ctx.redirect("/");
})
```
# get params

**You can use set ***Multiparams***** , ***like this***

```javascript
app.get("/product/:productId/:productName")
```

```javascript
app.get("/hello/:id/",(ctx:ContextType) => {
  const id = ctx.params.id
  const query = ctx.query // you can pass query name also , you wanna get
  return ctx.json({ msg: "Hello", id });
})
```


