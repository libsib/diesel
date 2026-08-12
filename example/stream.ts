import { file } from "bun";
import { Context } from "../src/ctx";
import Diesel from "../src/main";
import { Database } from 'bun:sqlite'

const app = new Diesel()
const db = new Database('data.db', { create: true })


// db.run(`
//   CREATE TABLE IF NOT EXISTS users (
//     id INTEGER PRIMARY KEY AUTOINCREMENT,
//     name TEXT,
//     age INTEGER
//   )
// `);
// db.run(`INSERT INTO users (name, age) VALUES ('Alice', 25), ('Bob', 30), ('Charlie', 35)`);


app.get('', (c: Context) => c.text("hello"))


app.get('stream', (c: Context) => {

    c.setHeader("Content-Type", "text/event-stream");
    c.setHeader("Cache-Control", "no-cache");
    c.setHeader("Connection", "keep-alive");

    return c.stream(
        async (controller) => {
            const stmt = await db.query(`SELECT * FROM users`);
            for (const row of stmt) {
                const chunk = `data: ${JSON.stringify(row)}\n\n`;
                controller.enqueue(chunk);
                await Bun.sleep(500);
            }
            controller.close();;
        }
    )
})



app.get("/page", (c: Context) => {
    c.setHeader("Content-Type", "text/html; charset=utf-8");

    // Open file as stream
    const htmlFile = file("large.html");

    // Stream file contents directly to client
    return c.stream(async (controller) => {
        const reader = htmlFile.stream().getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value); // send chunk to client
        }
        controller.close();
    });
});


app.get("/stream-html", (c: Context) => {
  c.setHeader("Content-Type", "text/html");

  return c.stream(async (controller) => {
    controller.enqueue("<!DOCTYPE html><html><body>");
    controller.enqueue("<h1>Loading data...</h1>");

    await Bun.sleep(100);
    controller.enqueue("<p>Step 1: connected ✅</p>");
    await Bun.sleep(100);
    controller.enqueue("<p>Step 2: data received ✅</p>");
    await Bun.sleep(100);
    controller.enqueue("<p>Step 3: done ✅</p>");

    controller.enqueue("</body></html>");
    controller.close();
  });
});


app.get("/stream-json", (c: Context) => {
  c.setHeader("Content-Type", "application/json");

  return c.stream(async (controller) => {
    c.setHeader("Content-Type", "text/event-stream");
    controller.enqueue("[");
    for (let i = 0; i < 3; i++) {
      if (i > 0) controller.enqueue(",");
      const data = { id: i, name: `Item ${i}` };
      controller.enqueue(JSON.stringify(data));
      await Bun.sleep(300);
    }
    controller.enqueue("]");
    controller.close();
  });
});



export default { fetch: app.fetch as any }