import { describe, expect, test, beforeAll } from "bun:test";
import { TrieRouter } from "./trie";
import type { ContextType } from "../types";

let router: TrieRouter;

beforeAll(() => {
  router = new TrieRouter();

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

describe("TrieRouter - Router Tests", () => {
  test("should match org/team route", () => {
    const result = router.find("GET", "/orgs/apple/teams/design");
    expect(result.handler?.({} as any)).toBe("team");
  });

  test("should match root '/' route", () => {
    const result = router.find("GET", "/");
    expect(result.handler?.({} as any)).toBe("root");
  });

  test("should match static routes", () => {
    const result = router.find("GET", "/about");
    expect(result.handler?.({} as any)).toBe("about page");
  });

  test("should match dynamic route", () => {
    const result = router.find("GET", "/user/123");
    expect(result.handler?.({} as any)).toBe("dynamic user");
  });

  test("should match wildcard route", () => {
    const result = router.find("GET", "/files/images/2025/photo.png");
    expect(result.handler?.({} as any)).toBe("catch all");
  });

  test("should correctly handle multiple HTTP methods on same path", () => {
    const getResult = router.find("GET", "/api/data");
    const postResult = router.find("POST", "/api/data");

    expect(getResult.handler?.({} as any)).toBe("GET handler");
    expect(postResult.handler?.({} as any)).toBe("POST handler");
  });

  test("should return undefined handler when method does not match", () => {
    const result = router.find("PUT", "/api/data");
    expect(result.handler).toBeUndefined();
    expect(result.middlewares).toBeDefined();
  });

  test("should handle deeply nested dynamic route", () => {
    const result = router.find("GET", "/a/123/c/456/e");
    expect(result.handler?.({} as any)).toBe("nested");
  });

  test("should prefer exact match over dynamic match", () => {
    const result = router.find("GET", "/user/profile");
    expect(result.handler?.({} as any)).toBe("static profile");
  });

  test("should return undefined handler for non-existent route", () => {
    const result = router.find("GET", "/non-existent");
    expect(result.handler).toBeUndefined();
    expect(result.middlewares).toBeDefined();
  });
});

describe("TrieRouter - with Middlewares check", () => {
  let router: TrieRouter;

  beforeAll(() => {
    router = new TrieRouter();

    // Add global middlewares
    router.addMiddleware("/", (ctx: any) => {
      const val = ctx.get("val") || "";
      ctx.set("val", val + "mw1;");
    });

    router.addMiddleware("/", (ctx: any) => {
      const val = ctx.get("val") || "";
      ctx.set("val", val + "mw2;");
    });

    router.addMiddleware("/user/*", (ctx: ContextType) => {
      ctx.set("/user/*", "/user/* middleware");
    });

    router.addMiddleware("/user/:id", (ctx: ContextType) => {
      const params = ctx.params.id;
      ctx.set("id", params);
    });

    router.addMiddleware("/user/static", (ctx: ContextType) => {
      return "user/static";
    });

    router.add("GET", "/user/:id", (ctx: ContextType | any) => {
      const param = ctx.get("id");
      return param;
    });
    router.add("GET", "/user/static", () => {
      return "user/static";
    });
    // Add route handler
    router.add("GET", "/", (ctx: any) => {
      const val = ctx.get("val") || "";
      ctx.set("val", val + "handler;");
      return ctx.get("val");
    });
  });

  test("should run all middlewares in order before handler", () => {
    const result = router.find("GET", "/");

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
    if (result.handler) output = result.handler(ctx);

    expect(output).toBe("mw1;mw2;handler;");
  });

  test("should return middlewares for non-existent route", () => {
    const result = router.find("GET", "/non-existent");
    expect(result.middlewares).toBeDefined();
    expect(result.middlewares).toHaveLength(2);
    expect(result.handler).toBeUndefined();
  });

  test("should return middlewares when method does not match", () => {
    const result = router.find("POST", "/");
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

    const result1 = router.find("GET", "/user/123");
    for (const fn of result1.middlewares ?? []) fn(ctx1);
    if (result1.handler) result1.handler(ctx1);

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

    const result2 = router.find("GET", "/user/static");
    let output: any;
    for (const fn of result2.middlewares ?? []) fn(ctx2);
    if (result2.handler) output = result2.handler(ctx2);

    expect(output).toBe("user/static");
  });
});

describe("path mid check", () => {
  let router: TrieRouter;
  beforeAll(() => {
    router = new TrieRouter();
    // /pradeep only midl , it shouldnt run for /pradeep/anyting
    router.addMiddleware("/pradeep", () => {});
    router.add("GET", "/pradeep/ok", () => {});

    router.addMiddleware("/user/*", () => {});
    router.add("GET", "/user/me", () => {});
  });

  test("it should not run include middleware at all ", () => {
    const result = router.find("GET", "/pradeep/ok");
    expect(result.middlewares).toHaveLength(0);
  });

  test("it should have midl ", () => {
    const result = router.find("GET", "/pradeep/");
    expect(result.middlewares).toHaveLength(1);
  });

  test("it should have midl /user/** ", () => {
    const result = router.find("GET", "/user/me");
    expect(result.middlewares).toHaveLength(1);
    expect(typeof result.handler).toBe("function");
  });
});

describe("dynamic test again with dff", () => {
  let router: any;
  beforeAll(() => {
    router = new TrieRouter();
    router.add("GET", "/users/:id/posts", () => {
      return "posts";
    });
    router.add("GET", "/users/me/settings", () => {
      return "settings";
    });
  });

  test("it should match /users/me/settings", () => {
    const result = router.find("GET", "/users/me/settings");
    expect(result.handler?.(result.params as any)).toBe("settings");
  });

  test("it should match /users/:id/posts", () => {
    const result = router.find("GET", "/users/123/posts");
    expect(result.handler?.(result.params as any)).toBe("posts");
  });

  test("it should match /users/me/posts", () => {
    const result = router.find("GET", "/users/me/posts");
    expect(result.handler?.(result.params as any)).toBe("posts");
  });
});

describe("BUG: param name collision on shared trie nodes", () => {
  // These document a real bug: TrieNodes stores a single mutable `paramName`
  // field per node, but a node at a given tree position can be shared by
  // routes that were registered with different param names (different
  // methods, or different methods, or diverging branches on the same method).
  // Whichever route was inserted LAST wins the name for ALL routes sharing
  // that node. See comments in trie.ts (insert/search) for the mechanics.
  //
  // All three tests below currently FAIL against the buggy implementation.
  // They should pass once paramName/params resolution is scoped per
  // method + route instead of shared per node.

  test("BUG: different param names for same path shape across different methods", () => {
    const router = new TrieRouter();
    router.add("GET", "/user/:id", () => "get");
    router.add("DELETE", "/user/:user_id", () => "delete");

    const getResult = router.find("GET", "/user/123");
    const deleteResult = router.find("DELETE", "/user/123");

    expect(getResult.params).toEqual({ id: "123" });
    expect(deleteResult.params).toEqual({ user_id: "123" });
  });

  test("BUG: different param names for same method on diverging branches", () => {
    const router = new TrieRouter();
    router.add("GET", "/user/:id/profile", () => "profile");
    router.add("GET", "/user/:name/settings", () => "settings");

    const profileResult = router.find("GET", "/user/123/profile");
    const settingsResult = router.find("GET", "/user/123/settings");

    expect(profileResult.params).toEqual({ id: "123" });
    expect(settingsResult.params).toEqual({ name: "123" });
  });

  test("BUG: three methods sharing identical path shape with distinct param names", () => {
    const router = new TrieRouter();
    router.add("GET", "/item/:itemId", () => "get");
    router.add("PUT", "/item/:updateId", () => "put");
    router.add("DELETE", "/item/:deleteId", () => "delete");

    expect(router.find("GET", "/item/9").params).toEqual({ itemId: "9" });
    expect(router.find("PUT", "/item/9").params).toEqual({ updateId: "9" });
    expect(router.find("DELETE", "/item/9").params).toEqual({ deleteId: "9" });
  });
});