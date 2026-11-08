import { describe, expect, test, beforeAll } from "bun:test";
import { RadixRouter } from "./radix";
import type { ContextType } from "../types";

let router: RadixRouter;

beforeAll(() => {
  router = new RadixRouter();

  // Static routes
  router.add("GET", "/", () => "root");
  router.add("GET", "/about", () => "about page");
  router.add("GET", "/user/profile", () => "static profile");

  // Dynamic route
  router.add("GET", "/user/:id", () => "dynamic user");

  // Wildcard
  router.add("GET", "/files/*", () => "catch all");

  // Multiple methods
  router.add("GET", "/api/data", () => "GET handler");
  router.add("POST", "/api/data", () => "POST handler");

  // Deeply nested dynamic route
  router.add("GET", "/a/:b/c/:d/e", () => "nested");

  router.add("GET", "/orgs/:orgId/teams/:teamId", () => "team");
});

describe("RadixRouter - Core Routing Tests", () => {
  test("should match org/team route", () => {
    const result = router.find("GET", "/orgs/apple/teams/design");
    expect(result.handler?.[0]({} as any)).toBe("team");
    expect(result.params).toEqual({ orgId: "apple", teamId: "design" });
  });

  test("should match root '/' route", () => {
    const result = router.find("GET", "/");
    expect(result.handler?.[0]({} as any)).toBe("root");
  });

  test("should match static routes", () => {
    const result = router.find("GET", "/about");
    expect(result.handler?.[0]({} as any)).toBe("about page");
  });

  test("should match dynamic route", () => {
    const result = router.find("GET", "/user/123");
    expect(result.handler?.[0]({} as any)).toBe("dynamic user");
    expect(result.params).toEqual({ id: "123" });
  });

  test("should match wildcard route", () => {
    const result = router.find("GET", "/files/images/2025/photo.png");
    expect(result.handler?.[0]({} as any)).toBe("catch all");
    expect(result.params?.["*"]).toBe("images/2025/photo.png");
  });

  test("should correctly handle multiple HTTP methods on same path", () => {
    const getResult = router.find("GET", "/api/data");
    const postResult = router.find("POST", "/api/data");

    expect(getResult.handler?.[0]({} as any)).toBe("GET handler");
    expect(postResult.handler?.[0]({} as any)).toBe("POST handler");
  });

  test("should return undefined handler when method does not match", () => {
    const result = router.find("PUT", "/api/data");
    expect(result.handler).toBeUndefined();
  });

  test("should handle deeply nested dynamic route", () => {
    const result = router.find("GET", "/a/123/c/456/e");
    expect(result.handler?.[0]({} as any)).toBe("nested");
    expect(result.params).toEqual({ b: "123", d: "456" });
  });

  test("should prefer exact match over dynamic match", () => {
    const result = router.find("GET", "/user/profile");
    expect(result.handler?.[0]({} as any)).toBe("static profile");
  });

  test("should return undefined handler for non-existent route", () => {
    const result = router.find("GET", "/non-existent");
    expect(result.handler).toBeUndefined();
  });
});

describe("RadixRouter - Backtracking and Sibling Resolution", () => {
  let r: RadixRouter;

  beforeAll(() => {
    r = new RadixRouter();
    r.add("GET", "/users/:id/posts", () => "posts");
    r.add("GET", "/users/me/settings", () => "settings");
    r.add("GET", "/api/v1/users/new", () => "user_new");
    r.add("GET", "/api/v1/users/:id", () => "user_id");
    r.add("GET", "/api/v1/users/:id/books", () => "user_books");
  });

  test("it should match /users/me/settings", () => {
    const result = r.find("GET", "/users/me/settings");
    expect(result.handler?.[0]({} as any)).toBe("settings");
  });

  test("it should match /users/:id/posts", () => {
    const result = r.find("GET", "/users/123/posts");
    expect(result.handler?.[0]({} as any)).toBe("posts");
    expect(result.params).toEqual({ id: "123" });
  });

  test("it should backtrack and match /users/me/posts (resolving me as :id)", () => {
    const result = r.find("GET", "/users/me/posts");
    expect(result.handler?.[0]({} as any)).toBe("posts");
    expect(result.params).toEqual({ id: "me" });
  });

  test("it should match deep static priority /api/v1/users/new", () => {
    const result = r.find("GET", "/api/v1/users/new");
    expect(result.handler?.[0]({} as any)).toBe("user_new");
  });

  test("it should match deep dynamic sibling /api/v1/users/123/books", () => {
    const result = r.find("GET", "/api/v1/users/123/books");
    expect(result.handler?.[0]({} as any)).toBe("user_books");
    expect(result.params).toEqual({ id: "123" });
  });
});

describe("RadixRouter - Param name isolation across diverging branches & methods", () => {
  test("different param names for same path shape across different methods", () => {
    const r = new RadixRouter();
    r.add("GET", "/user/:id", () => "get");
    r.add("DELETE", "/user/:user_id", () => "delete");

    const getResult = r.find("GET", "/user/123");
    const deleteResult = r.find("DELETE", "/user/123");

    expect(getResult.params).toEqual({ id: "123" });
    expect(deleteResult.params).toEqual({ user_id: "123" });
  });

  test("different param names for same method on diverging branches", () => {
    const r = new RadixRouter();
    r.add("GET", "/user/:id/profile", () => "profile");
    r.add("GET", "/user/:name/settings", () => "settings");

    const profileResult = r.find("GET", "/user/123/profile");
    const settingsResult = r.find("GET", "/user/123/settings");

    expect(profileResult.params).toEqual({ id: "123" });
    expect(settingsResult.params).toEqual({ name: "123" });
  });

  test("three methods sharing identical path shape with distinct param names", () => {
    const r = new RadixRouter();
    r.add("GET", "/item/:itemId", () => "get");
    r.add("PUT", "/item/:updateId", () => "put");
    r.add("DELETE", "/item/:deleteId", () => "delete");

    expect(r.find("GET", "/item/9").params).toEqual({ itemId: "9" });
    expect(r.find("PUT", "/item/9").params).toEqual({ updateId: "9" });
    expect(r.find("DELETE", "/item/9").params).toEqual({ deleteId: "9" });
  });
});

describe("RadixRouter - Middlewares check", () => {
  let r: RadixRouter;

  beforeAll(() => {
    r = new RadixRouter();

    // Add global middlewares
    r.addMiddleware("/", (ctx: any) => {
      const val = ctx.get("val") || "";
      ctx.set("val", val + "mw1;");
    });

    r.addMiddleware("/", (ctx: any) => {
      const val = ctx.get("val") || "";
      ctx.set("val", val + "mw2;");
    });

    r.addMiddleware("/user/*", (ctx: ContextType) => {
      ctx.set("/user/*", "/user/* middleware");
    });

    r.addMiddleware("/user/:id", (ctx: ContextType) => {
      const params = ctx.params.id;
      ctx.set("id", params);
    });

    r.addMiddleware("/user/static", (ctx: ContextType) => {
      return "user/static";
    });

    r.add("GET", "/user/:id", (ctx: ContextType | any) => {
      const param = ctx.get("id");
      return param;
    });

    r.add("GET", "/user/static", () => {
      return "user/static";
    });

    // Add route handler
    r.add("GET", "/", (ctx: any) => {
      const val = ctx.get("val") || "";
      ctx.set("val", val + "handler;");
      return ctx.get("val");
    });
  });

  test("should run all middlewares in order before handler", () => {
    const result = r.find("GET", "/");

    const ctx = {
      store: {} as Record<string, any>,
      get(key: string) {
        return this.store[key];
      },
      set(key: string, value: any) {
        this.store[key] = value;
      },
    };

    let output: any = "";

    for (const fn of result.middlewares ?? []) fn(ctx);
    if (result.handler) output = result.handler[0](ctx);

    expect(output).toBe("mw1;mw2;handler;");
  });

  test("should return middlewares for non-existent route", () => {
    const result = r.find("GET", "/non-existent");
    expect(result.middlewares).toBeDefined();
    expect(result.middlewares).toHaveLength(2);
    expect(result.handler).toBeUndefined();
  });

  test("should return middlewares when method does not match", () => {
    const result = r.find("POST", "/");
    expect(result.middlewares).toBeDefined();
    expect(result.middlewares).toHaveLength(2);
    expect(result.handler).toBeUndefined();
  });

  test("should run wildcard and dynamic middlewares correctly", () => {
    const ctx1 = {
      store: {} as Record<string, any>,
      params: { id: "123" },
      get(key: string) {
        return this.store[key];
      },
      set(key: string, value: any) {
        this.store[key] = value;
      },
    };

    const result1 = r.find("GET", "/user/123");
    for (const fn of result1.middlewares ?? []) fn(ctx1);
    if (result1.handler) result1.handler[0](ctx1);

    expect(ctx1.get("/user/*")).toBe("/user/* middleware");
    expect(ctx1.get("id")).toBe("123");

    const ctx2 = {
      store: {} as Record<string, any>,
      params: {},
      get(key: string) {
        return this.store[key];
      },
      set(key: string, value: any) {
        this.store[key] = value;
      },
    };

    const result2 = r.find("GET", "/user/static");
    let output: any;
    for (const fn of result2.middlewares ?? []) fn(ctx2);
    if (result2.handler) output = result2.handler[0](ctx2);

    expect(output).toBe("user/static");
  });
});
