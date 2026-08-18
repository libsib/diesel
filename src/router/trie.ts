import { ALL_METHOD, EMPTY_OBJ } from "../constant";
import { Find } from "./interface";

// one node in the tree, one segment of a path. e.g for "/user/:id",
// there's a node for "user" and a child node for ":" under it.
class TrieNodes {
  children: Record<string, TrieNodes>; // child nodes, keyed by path segment (or ":" for a param, "*" for wildcard)
  handlers: Record<string, Array<Function>>; // handlers at this node, keyed by http method
  middlewares: Function[]; // middlewares registered exactly at this node's path
  params: Record<string, string>; // param name for this node, keyed by method (e.g. GET -> "id" for :id)
  constructor() {
    this.children = {};
    this.handlers = {};
    this.middlewares = [];
    this.params = {};
  }
}

// our default router. Splits every path into segments and walks a
// tree, one node per segment, instead of testing every route with a
// regex. Faster for apps with a lot of routes.
export class TrieRouter {
  root: TrieNodes;
  globalMiddlewares: Function[]; // middlewares added on "/", run for every request
  constructor() {
    this.root = new TrieNodes();
    this.globalMiddlewares = [];
  }

  /**
   * Registers middleware for a path. "/" is treated specially and
   * goes into globalMiddlewares instead of a tree node, since it
   * applies to literally everything.
   *
   * @param path - path this middleware should run for
   * @param handlers - one middleware function, or an array of them
   */
  pushMiddleware(path: string, handlers: Function | Function[]) {
    if (!Array.isArray(handlers)) handlers = [handlers];
    if (path === "/") {
      this.globalMiddlewares.push(...handlers);
      return;
    }

    let node = this.root;
    const pathSegments = path.split("/").filter(Boolean);

    for (const element of pathSegments) {
      let key = element;
      if (element.startsWith(":")) {
        key = ":";
      }

      if (!node.children[key]) node.children[key] = new TrieNodes();

      node = node.children[key];
    }

    node.middlewares.push(...handlers);
  }

  /** Same as pushMiddleware(), this is just what the Router interface expects it to be called. */
  addMiddleware(path: string, handlers: Function | Function[]): void {
    return this.pushMiddleware(path, handlers);
  }

  /**
   * Walks/builds the tree for `path` and stores the handler(s) at the
   * end node, under `method`. `:something` segments become a shared
   * ":" node so different param names on the same shape of path reuse
   * the same tree branch. Won't overwrite a handler if one's already
   * registered for that method+path.
   *
   * @param method - http method to register under
   * @param path - route path, can contain `:param` segments
   * @param handler - one handler, or an array of handlers
   */
  insert(method: string, path: string, handler: Function | Function[]) {
    const handlers = Array.isArray(handler) ? handler : [handler];
    let node = this.root;

    if (path === "/") {
      if (node.handlers[method]) return;
      node.handlers[method] = handlers;
      node.params = EMPTY_OBJ;
      return;
    }

    const pathSegments = path.split("/").filter(Boolean);

    for (let i = 0; i < pathSegments.length; i++) {
      const element = pathSegments[i];
      let key = element;
      let cleanParam = "";
      if (element.startsWith(":")) {
        key = ":";
        cleanParam = element.slice(1);
      }

      if (!node.children[key]) node.children[key] = new TrieNodes();

      node = node.children[key];

      if (cleanParam) {
        node.params[method] = cleanParam;
      }
    }
    if (node.handlers[method]) return;
    node.handlers[method] = handlers;
  }

  /** Same as insert(), this is just what the Router interface expects it to be called. */
  add(method: string, path: string, handler: Function | Function[]) {
    return this.insert(method, path, handler);
  }

  /**
   * Finds the route that matches `method` + `path`. Walks the tree
   * segment by segment: exact segment match wins first, then a `:`
   * param node, then falls back to a `*` wildcard node if nothing
   * else fits. Collects middlewares along the way (global ones, plus
   * any registered on nodes it passes through or matches). If the
   * exact method has no handler at the matched node, falls back to
   * checking the ALL_METHOD bucket (registered via app.all()/any()).
   *
   * @param method - http method of the incoming request
   * @param path - request path
   * @returns params found, middlewares collected, and the handler(s) if matched
   */
  search(method: string, path: string): Find {
    let node = this.root;

    const pathSegments = path.split("/");

    let collected_middlewares = this.globalMiddlewares.slice();
    let paramObject: Record<string, string> | undefined;

    for (let i = 0; i < pathSegments.length; i++) {
      const element = pathSegments[i];
      if (element.length === 0) {
        continue;
      }
      const wildcardChild = node.children["*"];
      if (node.children[element]) {
        if (wildcardChild) {
          const mw = wildcardChild.middlewares;
          for (let j = 0; j < mw.length; j++) collected_middlewares.push(mw[j]);
        }
        node = node.children[element]!;
      } else if (node.children[":"]) {
        if (wildcardChild) {
          const mw = wildcardChild.middlewares;
          for (let j = 0; j < mw.length; j++) collected_middlewares.push(mw[j]);
        }
        node = node.children[":"];
        if (!paramObject) paramObject = {};
        paramObject[node.params[method]] = element;
      } else if (wildcardChild) {
        node = wildcardChild;
        break;
      } else {
        return {
          params: paramObject,
          middlewares: collected_middlewares,
          handler: undefined,
        };
      }
    }
    if (node.middlewares.length > 0) {
      const mw = node.middlewares;
      for (let j = 0; j < mw.length; j++) {
        collected_middlewares.push(mw[j]);
      }
    }

    // if the handler is found with correct method
    if (node.handlers[method]) {
      return {
        params: paramObject,
        middlewares: collected_middlewares,
        handler: node.handlers[method],
      };
    }
    // else check for ALL method
    if (node.handlers[ALL_METHOD]) {
      return {
        params: paramObject,
        middlewares: collected_middlewares,
        handler: node.handlers[ALL_METHOD],
      };
    }
    return {
      params: paramObject,
      middlewares: collected_middlewares,
      handler: undefined,
    };
  }

  /** Same as search(), this is just what the Router interface expects it to be called. */
  find(method: string, path: string) {
    return this.search(method, path);
  }
}

// const t1 = new TrieRouter()
// t1.add("GET", "/user/:id/profile", () => "profile");
// t1.add("GET", "/user/:name/settings", () => "settings");

// const profileResult = t1.find("GET", "/user/123/profile");
// const settingsResult = t1.find("DELETE", "/user/123/settings");

// console.log("prifleResult ", profileResult)
// console.log("settingsResult ", settingsResult)


// t1.insert('GET', '/user/:id', () => "Hello /")
// t1.insert('DELETE', '/user/:ids', () => "Hello /")

// t1.insert('GET', "/ok/:id/username/:number", () => "Hello /")
// const handler = t1.search('GET', '/user/2')
// console.log('real worldf handler = ',handler)
// t1.insert('GET', '/user/:id/:number/contact', () => "Hello /")
// t1.insert('GET', "/:username", () => "Hell /user")
// t1.insert('GET', '/name', () => 'user/* route')
// t1.insert('GET', '/hello/*', () => '/hello/*')
// t1.insert('GET', '/moon/:id', () => "/moon/:id")

// t1.pushMiddleware('/', function home() {
//     return "Midd /" as any
// })
// t1.pushMiddleware('/user/*', () => "user/* middleware " as any)

// const h = t1.search('GET', '/user/2')

// for (const k of h?.handler!) {
//     console.log(k?.(null as any, null as any))
// }

// const router = new TrieRouter()
// global middleware (applies to all requests)
// router.pushMiddleware('/', () => 'log mid' as any);

// // path-specific middleware
// router.pushMiddleware('/users/*', () => "/user/* middleware" as any);        // applies to /users/* paths
// router.pushMiddleware('/users/:id', () => "id checkmid " as any); // applies to /users/:id/*

// routes
// router.insert('GET', '/users', () => "get user by handlr") as any;
// router.insert('GET', '/users/:id', () => "get user by id handler" as any);
// router.insert('GET', '/users/:id/profile', () => "get user / id / profile");
// router.insert('GET', '/users/hello', () => "Hello /user/hello")

// const matched = router.search('POST', '/users/hello')
// console.log(matched.handler?.length)
// for (const k of matched?.handler!) {
//     console.log(k?.(null as any, null as any))
// }

// for (let i = 0; i < 4; i++) {
//     t1.f
// }

// const t = new TrieRouter2()
// t.add('GET', '/user/:id/:name', () => 'root')
// t.add('GET', '/user/:id/pk', () => 'root /user/:id/pk')
