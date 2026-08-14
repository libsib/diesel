import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import Diesel from "../src/main";
import type { Context } from "../src/ctx";

const port = 3002;
const baseUrl = `http://localhost:${port}`;

const app = new Diesel();
const child = new Diesel();

app.use("/app/*", (ctx: Context) => {
  ctx.setHeader("x-parent", "from-parent");
});

app.use((ctx: Context) => {
  ctx.set("name","pradeep")
})

child.get("/ctx", (ctx: Context) => {
  const name = ctx.get("name")
  return ctx.json({
    status: true,
    name
  })
})
child.get("/hello", (ctx: Context) => {
  ctx.setHeader("x-child", "from-child");
  return ctx.text("child hello");
});

child.get("/json", (ctx: Context) => ctx.json({ ok: true }));

child.get("/:id", (ctx: Context) => ctx.json({ id: ctx.params.id }));

app.sub("/app/*", child);

const routedChild = new Diesel();
routedChild.get("/test", (ctx: Context) => ctx.text("routed response"));
app.route("/routed", routedChild);

app.mount("/external/*", async (req: Request) => {
  return new Response("external response", {
    headers: { "x-external": "true" },
  });
});

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({ port, fetch: app.fetch });
});

afterAll(() => {
  server.stop(true);
});

describe("sub — routing", () => {
  it("routes to child /hello", async () => {
    const res = await fetch(`${baseUrl}/app/hello`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("child hello");
  });

  it("routes to child /json", async () => {
    const res = await fetch(`${baseUrl}/app/json`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("resolves path params in child", async () => {
    const res = await fetch(`${baseUrl}/app/42`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "42" });
  });
});

describe("sub — shared ctx", () => {
  it("parent middleware header appears in child response", async () => {
    const res = await fetch(`${baseUrl}/app/hello`);
    expect(res.headers.get("x-parent")).toBe("from-parent");
  });

  it("child-set header appears in response", async () => {
    const res = await fetch(`${baseUrl}/app/hello`);
    expect(res.headers.get("x-child")).toBe("from-child");
  });

  it("both parent and child headers present together", async () => {
    const res = await fetch(`${baseUrl}/app/hello`);
    expect(res.headers.get("x-parent")).toBe("from-parent");
    expect(res.headers.get("x-child")).toBe("from-child");
  });

  it("ctx set by parent must be accesible by children and children returns that in response", async () => {
    // pradeep will be extracted by parent midl and set in ctx.set
    // child will get and return this in json
    const res = await fetch(`${baseUrl}/app/ctx`);
    expect(await res.json()).toEqual({ status: true, name: "pradeep" })
  });
});

describe("mount — 3rd party handler", () => {
  it("routes to external handler", async () => {
    const res = await fetch(`${baseUrl}/external/anything`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("external response");
  });

  it("external handler headers are preserved", async () => {
    const res = await fetch(`${baseUrl}/external/anything`);
    expect(res.headers.get("x-external")).toBe("true");
  });
});

describe("route — subrouting", () => {
  it("routes to child /test", async () => {
    const res = await fetch(`${baseUrl}/routed/test`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("routed response");
  });
});
