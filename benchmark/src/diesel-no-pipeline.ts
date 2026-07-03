import { type Context } from "../../lib/ctx";
import Diesel from "../../lib/main";

const PORT = parseInt(process.env.PORT || "3000");

const app = new Diesel({ pipelineArchitecture: false });

// onRequest hook — runs before every request
app.addHooks("onRequest", (ctx: Context) => {
  const _ = ctx.req.headers.get("x-request-id") ?? "none";
});

// preHandler hook — runs after routing, before handler
app.addHooks("preHandler", (ctx: Context) => {
  ctx.set("startTime", Date.now());
});

// onSend hook — runs after handler
app.addHooks("onSend", (ctx: Context, result: any) => {
  const _ = Date.now() - (ctx.get("startTime") ?? 0);
});

// global middleware
app.use((ctx: Context) => {
  const _ = ctx.req.method;
});

app.get("/", (c: Context) => {
  return c.json({ message: "Hi there!", arch: "no-pipeline" });
});

app.get("/user/:id", (c: Context) => {
  return c.text("from id " + c.params.id);
});

app.get("/users/:name", (c: Context) => {
  return c.text("from name " + c.params.name);
});

app.get("/user/:id/post/:postId", (c: Context) => {
  return c.json({ userId: c.params.id, postId: c.params.postId });
});

app.listen(PORT);
