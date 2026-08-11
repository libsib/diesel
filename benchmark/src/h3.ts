import { H3 } from 'h3'

const PORT = parseInt(process.env.PORT || "3000");

const app = new H3()

app.get('/', () => {
  return { message: "Hello H3!", framework: "h3" }
})

app.get('/user/:id', (event) => {
  return "from id " + event.context.params.id
})

app.get('/users/:name', (event) => {
  return "from name " + event.context.params.name
})

app.get('/user/:id/post/:postId', (event) => {
  return { userId: event.context.params.id, postId: event.context.params.postId }
})

console.log(`h3 is running on port ${PORT}`)
Bun.serve({
  fetch: app.fetch,
  port: PORT,
})
