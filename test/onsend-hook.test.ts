import { describe, it, expect } from "bun:test";
import Diesel from "../src/main";
import type { Context } from "../src/ctx";

// onSend must see the final Response - including the not-found fallback -
// never `undefined`.
describe("onSend hook", () => {
  for (const pipelineArchitecture of [false, true]) {
    const label = pipelineArchitecture ? "pipeline" : "default";

    it(`${label}: receives the 404 response for unmatched routes`, async () => {
      const seen: (number | undefined)[] = [];
      const app = new Diesel({ pipelineArchitecture });
      app.addHooks("onSend", async (_ctx: Context, res: Response) => {
        seen.push(res?.status);
        return undefined;
      });
      app.get("/a", (ctx: Context) => ctx.text("a"));

      const res = await app.fetch(new Request("http://localhost/missing"));
      expect(res.status).toBe(404);
      expect(seen).toEqual([404]);
    });

    it(`${label}: receives the handler response and can replace it`, async () => {
      const app = new Diesel({ pipelineArchitecture });
      app.addHooks("onSend", async (_ctx: Context, res: Response) => {
        if (res.status === 200)
          return new Response("replaced:" + (await res.text()));
        return undefined;
      });
      app.get("/a", (ctx: Context) => ctx.text("a"));

      const res = await app.fetch(new Request("http://localhost/a"));
      expect(await res.text()).toBe("replaced:a");

      const missing = await app.fetch(new Request("http://localhost/nope"));
      expect(missing.status).toBe(404);
    });
  }
});
