import { Application, Router } from "@oakserver/oak";

const PORT = parseInt(process.env.PORT || "3000");

const router = new Router();

router.get("/", (ctx) => {
  ctx.response.body = { message: "Hello Oak!", framework: "oak" };
});

router.get("/user/:id", (ctx) => {
  ctx.response.body = "from id " + ctx.params.id;
});

router.get("/users/:name", (ctx) => {
  ctx.response.body = "from name " + ctx.params.name;
});

router.get("/user/:id/post/:postId", (ctx) => {
  ctx.response.body = { userId: ctx.params.id, postId: ctx.params.postId };
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

console.log(`oak is running on port ${PORT}`)
app.listen({ port: PORT });
