import { describe, expect, test } from "bun:test";
import { PeepalRouter } from "./interface";

describe("PeepalRouter", () => {
  test("should match a static route", () => {
    const router = new PeepalRouter();
    router.add("GET", "/about", () => "about page");

    const result = router.find("GET", "/about");
    expect(result.handler?.[0]({} as any)).toBe("about page");
  });

  test("should match a dynamic route and resolve params", () => {
    const router = new PeepalRouter();
    router.add("GET", "/user/:id", () => "user");

    const result = router.find("GET", "/user/123");
    expect(result.params).toEqual({ id: "123" });
  });

  test("should prefer a literal branch over a dynamic sibling", () => {
    const router = new PeepalRouter();
    router.add("GET", "/users/:id", () => "dynamic user");
    router.add("GET", "/users/me/posts", () => "posts");

    const result = router.find("GET", "/users/me/posts");
    expect(result.handler?.[0](result.params as any)).toBe("posts");
  });
});

describe("BUG: param name collision on shared trie nodes (peepal-router)", () => {
  // peepal-router fixes the backtracking bug above (literal-vs-dynamic
  // sibling routes), but still shares this bug with diesel's own TrieRouter
  // (see the identical failing test in trie.test.ts): a node at a given tree
  // position stores a single param name, even when routes registered at that
  // position use different param names. Whichever route was inserted LAST
  // wins the name for ALL routes sharing that node.
  //
  // This test currently FAILS against peepal-router@0.5.1, same as it fails
  // against diesel's own default router - it's a known limitation shared by
  // both implementations, not a peepal-specific regression. Not a blocker on
  // making PeepalRouter the default; it should still be fixed upstream in
  // peepal-router once param resolution is scoped per route instead of
  // shared per node.

  test("BUG: different param names for same method on diverging branches", () => {
    const router = new PeepalRouter();
    router.add("GET", "/user/:id/profile", () => "profile");
    router.add("GET", "/user/:name/settings", () => "settings");

    const profileResult = router.find("GET", "/user/123/profile");
    const settingsResult = router.find("GET", "/user/123/settings");

    expect(profileResult.params).toEqual({ id: "123" });
    expect(settingsResult.params).toEqual({ name: "123" });
  });
});
