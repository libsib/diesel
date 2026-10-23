import { describe, it, expect } from "bun:test";
import Diesel from "../src/main";
import type { Context } from "../src/ctx";

// The documented app.use() forms (docs/.../middleware.mdx) must all
// register the middleware, and bad input must fail loudly.
const deny = (ctx: Context) => ctx.text("denied", 401);
const ok = (ctx: Context) => ctx.text("secret");

async function status(app: Diesel, path: string) {
  return (await app.fetch(new Request(`http://localhost${path}`))).status;
}

describe("use() — supported forms", () => {
  for (const pipelineArchitecture of [false, true]) {
    const label = pipelineArchitecture ? "pipeline" : "default";

    it(`${label}: use([mw]) is global`, async () => {
      const app = new Diesel({ pipelineArchitecture });
      app.use([deny]);
      app.get("/u", ok);
      expect(await status(app, "/u")).toBe(401);
    });

    it(`${label}: use(mw1, [mw2]) runs both in order`, async () => {
      const calls: string[] = [];
      const app = new Diesel({ pipelineArchitecture });
      app.use(
        () => {
          calls.push("a");
        },
        [
          () => {
            calls.push("b");
          },
        ],
      );
      app.get("/u", ok);
      expect(await status(app, "/u")).toBe(200);
      expect(calls).toEqual(["a", "b"]);
    });

    it(`${label}: use(path, [mw])`, async () => {
      const app = new Diesel({ pipelineArchitecture });
      app.use("/u", [deny]);
      app.get("/u", ok);
      app.get("/open", ok);
      expect(await status(app, "/u")).toBe(401);
      expect(await status(app, "/open")).toBe(200);
    });

    it(`${label}: use([paths], [mw]) and use([paths], mw)`, async () => {
      for (const mw of [[deny], deny]) {
        const app = new Diesel({ pipelineArchitecture });
        app.use(["/u", "/h"], mw as any);
        app.get("/u", ok);
        app.get("/h", ok);
        app.get("/open", ok);
        expect(await status(app, "/u")).toBe(401);
        expect(await status(app, "/h")).toBe(401);
        expect(await status(app, "/open")).toBe(200);
      }
    });
  }
});

describe("use() — unsupported input throws", () => {
  it("non-function middleware", () => {
    const app = new Diesel();
    expect(() => app.use("/u", "nope" as any)).toThrow(TypeError);
    expect(() => app.use([deny, 1 as any])).toThrow(TypeError);
    expect(() => app.use(["/u", deny] as any)).toThrow(TypeError);
  });

  it("no middleware at all", () => {
    const app = new Diesel();
    expect(() => app.use()).toThrow(TypeError);
    expect(() => app.use("/u")).toThrow(TypeError);
    expect(() => app.use([])).toThrow(TypeError);
  });
});
