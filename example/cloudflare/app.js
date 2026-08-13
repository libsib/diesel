import Diesel from "../../dist/main";


const app = new Diesel({
    platform: 'cf',
})

app.addHooks("onError", (error, path) => {
    console.log("Got an exception:", error);
    console.log("Request Path:", path);
})


app.get("/", (ctx) => ctx.json({ message: "Welcome to Diesel.js on Cloudflare Workers!" }));

app.get("/health", (ctx) => ctx.json({ status: "ok", timestamp: Date.now() }));


app.get("/api/users/:id", (ctx) => {
    const { id } = ctx.params;
    return ctx.json({ id, name: "John Doe", role: "tester" });
});

app.get("/api/users", (ctx) => {
    const { page = "1", limit = "10" } = ctx.query;
    return ctx.json({
        page,
        limit,
        users: [
            { id: 1, name: "John" },
            { id: 2, name: "Jane" },
        ],
    });
});

app.post("/api/users", async (ctx) => {
    const body = await ctx.req.json();
    return ctx.json({ status: "created", user: body }, 201);
});

app.put("/api/users/:id", async (ctx) => {
    const { id } = ctx.params;
    const body = await ctx.req.json();
    return ctx.json({ status: "updated", id, updatedFields: body });
});

app.delete("/api/users/:id", (ctx) => {
    const { id } = ctx.params;
    return ctx.json({ status: "deleted", id });
});

app.post("/api/login", async (ctx) => {
    const { username, password } = await ctx.req.json();
    if (username === "admin" && password === "1234") {
        return ctx.json({ status: "success", token: "fake-jwt-token" });
    }
    return ctx.json({ status: "failed", message: "Invalid credentials" }, 401);
});

app.post("/api/logout", (ctx) => ctx.json({ status: "logged_out" }));


app.get("/api/random", (ctx) => {
    return ctx.json({ number: Math.floor(Math.random() * 1000) });
});

app.post("/api/echo", async (ctx) => {
    const data = await ctx.req.json();
    return ctx.json({ received: data });
});

app.get("/api/slow", async (ctx) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return ctx.json({ message: "This was delayed by 2 seconds" });
});


app.get("/env", (ctx) => {
    const apiKey = ctx.env;
    return ctx.json({ API_KEY: apiKey });
});

app.get("/bg-task", async (ctx) => {
    // Fire-and-forget
    ctx.executionContext.waitUntil(
        (async () => {
            // simulate long-running task
            await new Promise((resolve) => setTimeout(resolve, 2000));
            console.log("Background task done!");
        })()
    );

    return ctx.json({ status: "Task started" });
});

app.get("/kv/:key", async (ctx) => {
    try {
        const value = await ctx.env?.MY_KV?.get(ctx.params.key);
        if (value === null) {
            return ctx.json({ key: ctx.params.key, value: null, message: "Not found" }, 404);
        }
        return ctx.json({ key: ctx.params.key, value });
    } catch (err) {
        return ctx.json({ error: err.message }, 500);
    }
});


app.post("/kv/:key", async (ctx) => {
    try {
        const body = await ctx.req.json();
        if (!body.value) throw new Error("Missing 'value' property");
        await ctx.env?.MY_KV?.put(ctx.params.key, body.value);
        return ctx.json({ status: "saved", key: ctx.params.key });
    } catch (err) {
        return ctx.json({ error: err.message }, 400);
    }
});


app.get("/cache-test", async (ctx) => {
    const cache = caches.default;

    // Use only the URL for cache key
    const cacheKey = new Request(ctx.req.url.toString());

    // Try to get cached response
    let response = await cache.match(cacheKey);
    if (!response) {
        response = new Response("Cached at " + new Date(), { status: 200 });
        await cache.put(cacheKey, response.clone());
    }

    return response;
});

app.get("/proxy", async (ctx) => {
    const res = await fetch("https://api.github.com", {
      headers: {
        "User-Agent": "DieselTest",
        "Accept": "application/vnd.github.v3+json",
      },
    });
  
    const contentType = res.headers.get("content-type") || "";
    let data;
    if (contentType.includes("application/json")) {
      data = await res.json();
    } else {
      data = await res.text(); 
    }
  
    return ctx.json({ status: res.status, data });
  });
  



app.any("*", (ctx) => ctx.json({ error: "Not Found" }, 404));



export default {
    fetch: app.fetch
}