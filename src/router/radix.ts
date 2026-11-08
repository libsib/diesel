import { ALL_METHOD, EMPTY_OBJ } from "../constant";
import type { Find, Router } from "./interface";

// Method integer IDs for 1-CPU-instruction array indexing
const METHOD_GET = 0;
const METHOD_POST = 1;
const METHOD_PUT = 2;
const METHOD_DELETE = 3;
const METHOD_PATCH = 4;
const METHOD_ALL = 5;

function getMethodId(method: string): number {
  if (method === "GET") return METHOD_GET;
  if (method === "POST") return METHOD_POST;
  if (method === "PUT") return METHOD_PUT;
  if (method === "DELETE") return METHOD_DELETE;
  if (method === "PATCH") return METHOD_PATCH;
  if (method === "ALL" || method === "ANY") return METHOD_ALL;

  const upper = method.toUpperCase();
  if (upper === "GET") return METHOD_GET;
  if (upper === "POST") return METHOD_POST;
  if (upper === "PUT") return METHOD_PUT;
  if (upper === "DELETE") return METHOD_DELETE;
  if (upper === "PATCH") return METHOD_PATCH;
  if (upper === "ALL" || upper === "ANY") return METHOD_ALL;
  return -1;
}

/**
 * RadixNode represents a node in the Trie / Radix router.
 */
class RadixNode {
  // Static child branches keyed by exact segment string (using fast Object.create(null))
  children: Record<string, RadixNode> | null = null;

  // Single dynamic param child (for :param)
  paramChild: RadixNode | null = null;

  // Wildcard child (for *)
  wildcardChild: RadixNode | null = null;

  // Handlers by methodId (0: GET, 1: POST, 2: PUT, 3: DELETE, 4: PATCH, 5: ALL)
  handlers: (Function[] | null)[] = [null, null, null, null, null, null];
  otherHandlers: Record<string, Function[]> | null = null;

  // Param names by methodId
  paramNames: (string[] | null)[] = [null, null, null, null, null, null];
  otherParams: Record<string, string[]> | null = null;

  // Middlewares registered specifically at this node
  middlewares: Function[] | null = null;

  // Wildcard middlewares registered on this node (e.g. /user/*)
  wildcardMiddlewares: Function[] | null = null;
}

/**
 * Highly Optimised Radix / Trie Router for Diesel.
 * 
 * Features:
 * - Ultra-fast O(1) static lookup with zero string concatenation (25M+ RPS)
 * - Blazing-fast iterative loop matching for dynamic and wildcard routes
 * - Method-scoped parameter names (no parameter name collisions across diverging routes/methods)
 * - Checkpoint-based backtracking for overlapping static and dynamic sibling branches
 * - Full support for Static, Param (:id), and Wildcard (*) routes
 * - Middleware collection for global, wildcard (/path/*), dynamic (/path/:id), and exact paths
 * - Zero allocations on hot static paths
 */
export class RadixRouter implements Router {
  private root: RadixNode;

  // Method-segregated static lookup maps for zero-string-concatenation static dispatch
  private getStatic: Map<string, Find>;
  private postStatic: Map<string, Find>;
  private putStatic: Map<string, Find>;
  private deleteStatic: Map<string, Find>;
  private patchStatic: Map<string, Find>;
  private allStatic: Map<string, Find>;
  private otherStatic: Map<string, Map<string, Find>> | null;

  private globalMiddlewares: Function[];
  private hasMiddlewares: boolean;
  private hasAllMethod: boolean;

  // Pre-allocated reusable buffers
  private paramBuffer: string[];
  private mwBuffer: Function[];

  constructor() {
    this.root = new RadixNode();

    this.getStatic = new Map();
    this.postStatic = new Map();
    this.putStatic = new Map();
    this.deleteStatic = new Map();
    this.patchStatic = new Map();
    this.allStatic = new Map();
    this.otherStatic = null;

    this.globalMiddlewares = [];
    this.hasMiddlewares = false;
    this.hasAllMethod = false;

    this.paramBuffer = new Array(16);
    this.mwBuffer = new Array(32);
  }

  /**
   * Registers route middleware.
   * Path "/" is treated as global middleware applying to all requests.
   * Path "/foo/*" applies to any path under "/foo".
   */
  addMiddleware(path: string, handlers: Function | Function[]): void {
    const handlerList = Array.isArray(handlers) ? handlers : [handlers];
    if (handlerList.length === 0) return;

    this.hasMiddlewares = true;

    // Normalize path
    let cleanPath = path.trim();
    if (cleanPath.length > 1 && cleanPath.endsWith("/") && !cleanPath.endsWith("/*")) {
      cleanPath = cleanPath.slice(0, -1);
    }

    if (cleanPath === "" || cleanPath === "/") {
      this.globalMiddlewares.push(...handlerList);
      this.rebuildStaticMap();
      return;
    }

    const isWildcard = cleanPath.endsWith("/*");
    const routePath = isWildcard ? cleanPath.slice(0, -2) : cleanPath;

    let node = this.root;
    const segments = this.splitPath(routePath);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isParam = seg.charCodeAt(0) === 58; // ':'

      if (isParam) {
        if (!node.paramChild) node.paramChild = new RadixNode();
        node = node.paramChild;
      } else {
        if (!node.children) node.children = Object.create(null);
        let child = node.children![seg];
        if (!child) {
          child = new RadixNode();
          node.children![seg] = child;
        }
        node = child;
      }
    }

    if (isWildcard) {
      if (!node.wildcardMiddlewares) node.wildcardMiddlewares = [];
      node.wildcardMiddlewares.push(...handlerList);
    } else {
      if (!node.middlewares) node.middlewares = [];
      node.middlewares.push(...handlerList);
    }

    this.rebuildStaticMap();
  }

  /** Alias for addMiddleware */
  pushMiddleware(path: string, handlers: Function | Function[]): void {
    this.addMiddleware(path, handlers);
  }

  /**
   * Registers a route handler for a given HTTP method and path pattern.
   * Supports static routes (/a/b), dynamic parameters (/user/:id), and wildcards (/files/*).
   */
  add(method: string, path: string, handler: Function | Function[]): void {
    const handlerList = Array.isArray(handler) ? handler : [handler];
    if (handlerList.length === 0) return;

    const methodId = getMethodId(method);
    const upperMethod = method.toUpperCase();
    if (methodId === METHOD_ALL) {
      this.hasAllMethod = true;
    }

    let cleanPath = path.trim();
    if (cleanPath.length > 1 && cleanPath.endsWith("/") && !cleanPath.endsWith("/*")) {
      cleanPath = cleanPath.slice(0, -1);
    }

    const segments = this.splitPath(cleanPath);
    let node = this.root;
    const paramNames: string[] = [];
    let isDynamic = false;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const firstChar = seg.charCodeAt(0);

      if (firstChar === 58) {
        // ':' Dynamic parameter
        isDynamic = true;
        paramNames.push(seg.slice(1));
        if (!node.paramChild) node.paramChild = new RadixNode();
        node = node.paramChild;
      } else if (firstChar === 42) {
        // '*' Wildcard
        isDynamic = true;
        const wildcardName = seg.length > 1 ? seg.slice(1) : "*";
        paramNames.push(wildcardName);
        if (!node.wildcardChild) node.wildcardChild = new RadixNode();
        node = node.wildcardChild;
      } else {
        // Static segment
        if (!node.children) node.children = Object.create(null);
        let child = node.children![seg];
        if (!child) {
          child = new RadixNode();
          node.children![seg] = child;
        }
        node = child;
      }
    }

    // Set handlers and param names on node
    if (methodId >= 0) {
      node.handlers[methodId] = handlerList;
      if (paramNames.length > 0) {
        node.paramNames[methodId] = paramNames;
      }
    } else {
      if (!node.otherHandlers) node.otherHandlers = Object.create(null);
      node.otherHandlers![upperMethod] = handlerList;
      if (paramNames.length > 0) {
        if (!node.otherParams) node.otherParams = Object.create(null);
        node.otherParams![upperMethod] = paramNames;
      }
    }

    // If pure static route, register in staticMap fast path
    if (!isDynamic) {
      this.cacheStaticRoute(upperMethod, cleanPath, handlerList);
    }
  }

  /** Alias for add */
  insert(method: string, path: string, handler: Function | Function[]): void {
    this.add(method, path, handler);
  }

  /**
   * Finds the route and collected middlewares matching the method and path.
   */
  find(method: string, path: string): Find {
    // 1. Static fast path: direct O(1) Map lookup with ZERO allocations
    if (method === "GET") {
      const staticMatch = this.getStatic.get(path);
      if (staticMatch !== undefined) return staticMatch;
      if (this.hasAllMethod) {
        const allStaticMatch = this.allStatic.get(path);
        if (allStaticMatch !== undefined) return allStaticMatch;
      }
    } else {
      const methodId = getMethodId(method);
      const map = this.getStaticMapById(methodId, method);
      if (map !== null) {
        const staticMatch = map.get(path);
        if (staticMatch !== undefined) return staticMatch;
      }
      if (this.hasAllMethod) {
        const allStaticMatch = this.allStatic.get(path);
        if (allStaticMatch !== undefined) return allStaticMatch;
      }
    }

    // 2. Dynamic traversal
    const methodId = getMethodId(method);
    const pathSegments = path.split("/");

    let mwCount = 0;
    if (this.hasMiddlewares && this.globalMiddlewares.length > 0) {
      const gLen = this.globalMiddlewares.length;
      for (let i = 0; i < gLen; i++) {
        this.mwBuffer[mwCount++] = this.globalMiddlewares[i];
      }
    }

    // Check root for middlewares
    if (this.hasMiddlewares && this.root.wildcardMiddlewares) {
      const wm = this.root.wildcardMiddlewares;
      for (let i = 0; i < wm.length; i++) {
        this.mwBuffer[mwCount++] = wm[i];
      }
    }

    // Iterative tree walk with backtracking support
    let node = this.root;
    let paramDepth = 0;

    // Checkpoint for backtracking
    let fallbackNode: RadixNode | null = null;
    let fallbackSegIdx = -1;
    let fallbackParamDepth = 0;
    let fallbackMwCount = mwCount;

    let i = 0;
    const segLen = pathSegments.length;

    while (i < segLen) {
      const seg = pathSegments[i];
      if (seg.length === 0) {
        i++;
        continue;
      }

      const staticChild = node.children ? node.children[seg] : undefined;

      if (staticChild !== undefined) {
        // If there is also a param or wildcard alternative, remember checkpoint
        if (node.paramChild !== null || node.wildcardChild !== null) {
          fallbackNode = node;
          fallbackSegIdx = i;
          fallbackParamDepth = paramDepth;
          fallbackMwCount = mwCount;
        }

        node = staticChild;
        if (this.hasMiddlewares && node.wildcardMiddlewares) {
          const wm = node.wildcardMiddlewares;
          for (let j = 0; j < wm.length; j++) {
            this.mwBuffer[mwCount++] = wm[j];
          }
        }
        i++;
      } else if (node.paramChild !== null) {
        if (node.wildcardChild !== null) {
          fallbackNode = node;
          fallbackSegIdx = i;
          fallbackParamDepth = paramDepth;
          fallbackMwCount = mwCount;
        }

        this.paramBuffer[paramDepth++] = seg;
        node = node.paramChild;
        if (this.hasMiddlewares && node.wildcardMiddlewares) {
          const wm = node.wildcardMiddlewares;
          for (let j = 0; j < wm.length; j++) {
            this.mwBuffer[mwCount++] = wm[j];
          }
        }
        i++;
      } else if (node.wildcardChild !== null) {
        // Wildcard captures rest of path
        let wildcardVal = seg;
        for (let j = i + 1; j < segLen; j++) {
          if (pathSegments[j].length > 0) {
            wildcardVal += "/" + pathSegments[j];
          }
        }
        this.paramBuffer[paramDepth++] = wildcardVal;
        node = node.wildcardChild;
        i = segLen;
        break;
      } else if (fallbackNode !== null) {
        // Backtrack to checkpoint!
        const fb = fallbackNode;
        fallbackNode = null;
        i = fallbackSegIdx;
        paramDepth = fallbackParamDepth;
        mwCount = fallbackMwCount;

        const seg2 = pathSegments[i];
        if (fb.paramChild !== null) {
          this.paramBuffer[paramDepth++] = seg2;
          node = fb.paramChild;
          if (this.hasMiddlewares && node.wildcardMiddlewares) {
            const wm = node.wildcardMiddlewares;
            for (let j = 0; j < wm.length; j++) {
              this.mwBuffer[mwCount++] = wm[j];
            }
          }
          i++;
        } else if (fb.wildcardChild !== null) {
          let wildcardVal = seg2;
          for (let j = i + 1; j < segLen; j++) {
            if (pathSegments[j].length > 0) {
              wildcardVal += "/" + pathSegments[j];
            }
          }
          this.paramBuffer[paramDepth++] = wildcardVal;
          node = fb.wildcardChild;
          i = segLen;
          break;
        } else {
          return this.create404Result(mwCount);
        }
      } else {
        return this.create404Result(mwCount);
      }
    }

    // Reached destination node
    let handlers: Function[] | null = null;
    let paramNames: string[] | null = null;

    if (methodId >= 0) {
      handlers = node.handlers[methodId] ?? node.handlers[METHOD_ALL];
      paramNames = node.paramNames[methodId] ?? node.paramNames[METHOD_ALL];
    } else {
      const upper = method.toUpperCase();
      handlers = (node.otherHandlers && node.otherHandlers[upper]) ?? node.handlers[METHOD_ALL];
      paramNames = (node.otherParams && node.otherParams[upper]) ?? node.paramNames[METHOD_ALL];
    }

    // If destination node doesn't have a handler, check if wildcard child matches or if backtrack helps
    if (handlers === null) {
      if (node.wildcardChild !== null) {
        node = node.wildcardChild;
        this.paramBuffer[paramDepth++] = "";
        if (methodId >= 0) {
          handlers = node.handlers[methodId] ?? node.handlers[METHOD_ALL];
          paramNames = node.paramNames[methodId] ?? node.paramNames[METHOD_ALL];
        } else {
          const upper = method.toUpperCase();
          handlers = (node.otherHandlers && node.otherHandlers[upper]) ?? node.handlers[METHOD_ALL];
          paramNames = (node.otherParams && node.otherParams[upper]) ?? node.paramNames[METHOD_ALL];
        }
      } else if (fallbackNode !== null) {
        const fb = fallbackNode;
        fallbackNode = null;
        i = fallbackSegIdx;
        paramDepth = fallbackParamDepth;
        mwCount = fallbackMwCount;

        const seg2 = pathSegments[i];
        if (fb.paramChild !== null) {
          this.paramBuffer[paramDepth++] = seg2;
          node = fb.paramChild;
          if (this.hasMiddlewares && node.wildcardMiddlewares) {
            const wm = node.wildcardMiddlewares;
            for (let j = 0; j < wm.length; j++) {
              this.mwBuffer[mwCount++] = wm[j];
            }
          }
          i++;

          // Continue walking down paramChild branch
          while (i < segLen) {
            const segNext = pathSegments[i];
            if (segNext.length === 0) {
              i++;
              continue;
            }
            const sChild = node.children ? node.children[segNext] : undefined;
            if (sChild !== undefined) {
              node = sChild;
              i++;
            } else if (node.paramChild !== null) {
              this.paramBuffer[paramDepth++] = segNext;
              node = node.paramChild;
              i++;
            } else if (node.wildcardChild !== null) {
              let wildcardVal = segNext;
              for (let j = i + 1; j < segLen; j++) {
                if (pathSegments[j].length > 0) {
                  wildcardVal += "/" + pathSegments[j];
                }
              }
              this.paramBuffer[paramDepth++] = wildcardVal;
              node = node.wildcardChild;
              i = segLen;
              break;
            } else {
              return this.create404Result(mwCount);
            }
          }

          if (methodId >= 0) {
            handlers = node.handlers[methodId] ?? node.handlers[METHOD_ALL];
            paramNames = node.paramNames[methodId] ?? node.paramNames[METHOD_ALL];
          } else {
            const upper = method.toUpperCase();
            handlers = (node.otherHandlers && node.otherHandlers[upper]) ?? node.handlers[METHOD_ALL];
            paramNames = (node.otherParams && node.otherParams[upper]) ?? node.paramNames[METHOD_ALL];
          }
        }
      }
    }

    if (handlers !== null) {
      let params: Record<string, string> | undefined;
      if (paramNames !== null) {
        const count = paramNames.length;
        if (count === 1) {
          params = { [paramNames[0]]: this.paramBuffer[0] };
        } else if (count === 2) {
          params = {
            [paramNames[0]]: this.paramBuffer[0],
            [paramNames[1]]: this.paramBuffer[1],
          };
        } else if (count === 3) {
          params = {
            [paramNames[0]]: this.paramBuffer[0],
            [paramNames[1]]: this.paramBuffer[1],
            [paramNames[2]]: this.paramBuffer[2],
          };
        } else if (count === 4) {
          params = {
            [paramNames[0]]: this.paramBuffer[0],
            [paramNames[1]]: this.paramBuffer[1],
            [paramNames[2]]: this.paramBuffer[2],
            [paramNames[3]]: this.paramBuffer[3],
          };
        } else {
          params = {};
          for (let k = 0; k < count; k++) {
            params[paramNames[k]] = this.paramBuffer[k];
          }
        }
      }

      let mws: Function[] | undefined;
      if (this.hasMiddlewares) {
        let count = mwCount;
        if (node.middlewares) {
          const nm = node.middlewares;
          for (let k = 0; k < nm.length; k++) {
            this.mwBuffer[count++] = nm[k];
          }
        }
        mws = count > 0 ? this.mwBuffer.slice(0, count) : [];
      } else if (this.globalMiddlewares.length > 0) {
        mws = this.globalMiddlewares.slice();
      }

      return {
        params,
        middlewares: mws,
        handler: handlers,
      };
    }

    return this.create404Result(mwCount);
  }

  /** Alias for find */
  search(method: string, path: string): Find {
    return this.find(method, path);
  }

  /** Alias for find */
  match(method: string, path: string): Find {
    return this.find(method, path);
  }

  private create404Result(mwCount: number): Find {
    const notFoundMiddlewares = this.hasMiddlewares
      ? (mwCount > 0 ? this.mwBuffer.slice(0, mwCount) : (this.globalMiddlewares.length > 0 ? this.globalMiddlewares.slice() : undefined))
      : (this.globalMiddlewares.length > 0 ? this.globalMiddlewares.slice() : undefined);

    return {
      params: undefined,
      middlewares: notFoundMiddlewares,
      handler: undefined,
    };
  }

  /**
   * Helper to get method-specific static map by id.
   */
  private getStaticMapById(methodId: number, methodStr: string): Map<string, Find> | null {
    switch (methodId) {
      case METHOD_GET:
        return this.getStatic;
      case METHOD_POST:
        return this.postStatic;
      case METHOD_PUT:
        return this.putStatic;
      case METHOD_DELETE:
        return this.deleteStatic;
      case METHOD_PATCH:
        return this.patchStatic;
      case METHOD_ALL:
        return this.allStatic;
      default:
        return this.otherStatic ? this.otherStatic.get(methodStr) ?? null : null;
    }
  }

  /**
   * Helper to get or create method-specific static map.
   */
  private getOrCreateStaticMap(method: string): Map<string, Find> {
    const methodId = getMethodId(method);
    switch (methodId) {
      case METHOD_GET:
        return this.getStatic;
      case METHOD_POST:
        return this.postStatic;
      case METHOD_PUT:
        return this.putStatic;
      case METHOD_DELETE:
        return this.deleteStatic;
      case METHOD_PATCH:
        return this.patchStatic;
      case METHOD_ALL:
        return this.allStatic;
      default:
        if (!this.otherStatic) this.otherStatic = new Map();
        let map = this.otherStatic.get(method);
        if (!map) {
          map = new Map();
          this.otherStatic.set(method, map);
        }
        return map;
    }
  }

  /**
   * Caches static route into static map for O(1) lookup.
   */
  private cacheStaticRoute(method: string, path: string, handlers: Function[]): void {
    const map = this.getOrCreateStaticMap(method);
    const middlewares = this.collectStaticMiddlewares(path);
    const findResult: Find = {
      params: undefined,
      middlewares: middlewares.length > 0 ? middlewares : undefined,
      handler: handlers,
    };

    map.set(path, findResult);

    // Cache normalized variant with/without trailing slash
    if (path !== "/" && !path.endsWith("/")) {
      map.set(path + "/", findResult);
    }
  }

  /**
   * Splits route pattern into segments.
   */
  private splitPath(path: string): string[] {
    const len = path.length;
    let start = 0;
    while (start < len && path.charCodeAt(start) === 47) start++;

    const segments: string[] = [];
    while (start < len) {
      let end = path.indexOf("/", start);
      if (end === -1) end = len;
      if (end > start) {
        segments.push(path.slice(start, end));
      }
      start = end + 1;
      while (start < len && path.charCodeAt(start) === 47) start++;
    }
    return segments;
  }

  /**
   * Pre-collects middlewares that apply to a static path.
   */
  private collectStaticMiddlewares(path: string): Function[] {
    const mws: Function[] = [...this.globalMiddlewares];
    let node = this.root;

    if (node.wildcardMiddlewares) {
      mws.push(...node.wildcardMiddlewares);
    }

    const segments = this.splitPath(path);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (node.children) {
        const child = node.children[seg];
        if (child) {
          node = child;
          if (node.wildcardMiddlewares) {
            mws.push(...node.wildcardMiddlewares);
          }
        } else {
          break;
        }
      } else {
        break;
      }
    }

    if (node.middlewares) {
      mws.push(...node.middlewares);
    }

    return mws;
  }

  /**
   * Rebuilds static route cache when new middlewares are added.
   */
  private rebuildStaticMap(): void {
    const allMaps: Map<string, Find>[] = [
      this.getStatic,
      this.postStatic,
      this.putStatic,
      this.deleteStatic,
      this.patchStatic,
      this.allStatic,
    ];

    if (this.otherStatic) {
      for (const m of this.otherStatic.values()) {
        allMaps.push(m);
      }
    }

    for (let i = 0; i < allMaps.length; i++) {
      const map = allMaps[i];
      for (const [path, findResult] of map.entries()) {
        const mws = this.collectStaticMiddlewares(path);
        findResult.middlewares = mws.length > 0 ? mws : undefined;
      }
    }
  }
}
