import { type Context } from "../../lib/ctx";
import Diesel from "../../lib/main";

const PORT = parseInt(process.env.PORT || "3000");

export const app = new Diesel({ pipelineArchitecture: true });

app.addHooks("onRequest", () => {})

app.get("/", (c: Context) => {
  return c.json({ message: "Hi there!", framework: "diesel" });
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
