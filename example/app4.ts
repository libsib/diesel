import { Context } from "../src/ctx";
import Diesel from "../src/main";

const app = new Diesel()
app.use((c: Context) => {
  c.setHeader("powered-by", "app1")
})
const app2 = new Diesel()
app2.get("/", (c:Context) => {
  c.setHeader("pk", 'kumar')
  return c.text('Hello / from app2')
})

app.get('/', (c:Context) => {
  return c.text("Heloo fropm root /")
  // throw new Error("hee")
})

app.use((ctx: Context) => {
  const param = ctx.params
  console.log("name use ", param)
  ctx.set("name",param)
})

app2.get("/ctx/:name", (ctx: Context) => {
  const name = ctx.params.name
  return ctx.json({
    status: true,
    name
  })
})

app.sub("/app/*", app2)
app.listen(3000)