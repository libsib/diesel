import { ALL_METHOD, EMPTY_OBJ } from "../constant";
import { Find } from "./interface";

const toHandlerArray = (handler: Function | Function[]): Function[] =>
  Array.isArray(handler) ? handler.slice() : [handler];

class TrieNodes {
  children: Record<string, TrieNodes>;
  handlers: Record<string, Function>;
  middlewares: Record<string, Function[]>;
  params: Record<string, string>;
  constructor() {
    this.children = {};
    this.handlers = {};
    this.middlewares = {};
    this.params = {};
  }
}

export class TrieRouter {
  root: TrieNodes;
  globalMiddlewares: Record<string, Function[]>;
  constructor() {
    this.root = new TrieNodes();
    this.globalMiddlewares = {};
  }

  pushMiddleware(path: string, handlers: Function | Function[], method: string = ALL_METHOD) {
    handlers = toHandlerArray(handlers);
    if (path === "/") {
      if (!this.globalMiddlewares[method]) this.globalMiddlewares[method] = [];
      this.globalMiddlewares[method].push(...handlers);
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

    if (!node.middlewares[method]) node.middlewares[method] = [];
    node.middlewares[method].push(...handlers);
  }

  addMiddleware(path: string, handlers: Function | Function[], method: string = ALL_METHOD): void {
    return this.pushMiddleware(path, handlers, method);
  }

  insert(method: string, path: string, handler: Function | Function[]) {
    const handlers = toHandlerArray(handler);
    const single_handler = handlers.pop();
    if (!single_handler) return;
    const middl = handlers;
    this.addMiddleware(path, middl, method);
    
    let node = this.root;

    if (path === "/") {
      if (node.handlers[method]) return;
      node.handlers[method] = single_handler;
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
    node.handlers[method] = single_handler;
  }

  add(method: string, path: string, handler: Function | Function[]) {
    return this.insert(method, path, handler);
  }

  search(method: string, path: string): Find {
    let node = this.root;
    const isAllMethod = method === ALL_METHOD;

    const pathSegments = path.split("/");

    let collected_middlewares = isAllMethod
      ? (this.globalMiddlewares[ALL_METHOD] ?? []).slice()
      : [
          ...(this.globalMiddlewares[method] ?? []),
          ...(this.globalMiddlewares[ALL_METHOD] ?? []),
        ];
    let paramObject: Record<string, string> | undefined;

    for (let i = 0; i < pathSegments.length; i++) {
      const element = pathSegments[i];
      if (element.length === 0) {
        continue;
      }
      const wildcardChild = node.children["*"];
      if (node.children[element]) {
        if (wildcardChild) {
          const mwMethod = wildcardChild.middlewares[method];
          const mwAll = isAllMethod ? undefined : wildcardChild.middlewares[ALL_METHOD];
          if (mwAll) for (let j = 0; j < mwAll.length; j++) collected_middlewares.push(mwAll[j]);
          if (mwMethod) for (let j = 0; j < mwMethod.length; j++) collected_middlewares.push(mwMethod[j]);
        }
        node = node.children[element]!;
      } else if (node.children[":"]) {
        if (wildcardChild) {
          const mwMethod = wildcardChild.middlewares[method];
          const mwAll = isAllMethod ? undefined : wildcardChild.middlewares[ALL_METHOD];
          if (mwAll) for (let j = 0; j < mwAll.length; j++) collected_middlewares.push(mwAll[j]);
          if (mwMethod) for (let j = 0; j < mwMethod.length; j++) collected_middlewares.push(mwMethod[j]);
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
    
    if (!isAllMethod && node.middlewares[ALL_METHOD]?.length > 0) {
      const mw = node.middlewares[ALL_METHOD];
      for (let j = 0; j < mw.length; j++) {
        collected_middlewares.push(mw[j]);
      }
    }
    if (node.middlewares[method]?.length > 0) {
      const mw = node.middlewares[method];
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

  find(method: string, path: string) {
    return this.search(method, path);
  }
}

const t1 = new TrieRouter()
t1.pushMiddleware("/user/:id/profile", () =>{})
const a = () => { }
const b = () => {}
t1.add("GET", "/user/:id/profile", [a,b, () => "profile"]);
t1.add("GET", "/user/:name/settings", () => "settings");

const profileResult = t1.find("GET", "/user/123/profile");
// const settingsResult = t1.find("DELETE", "/user/123/settings");

console.log("prifleResult ", profileResult)
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
