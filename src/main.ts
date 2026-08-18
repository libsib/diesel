import {
  CompileConfig,
  corsT,
  DieselFetchHandler,
  DieselOptions,
  errorFormat,
  HookFunction,
  HookType,
  listenArgsT,
  middlewareFunc,
  onError,
  onRequest,
  onSend,
  RouteNotFoundHandler,
  RuntimeServer,
  TempRouteEntry,
  type handlerFunction,
  type Hooks,
  type HttpMethod,
} from "./types.js";

import type {
  AdvancedLoggerOptions,
  LoggerOptions,
} from "./middlewares/logger/logger.js";

import {
  build_request_pipeline_latest,
  BunRequestPipline,
} from "./request_pipeline.js";

import { getPath } from "./utils/urls.js";

import { EventEmitter } from "node:events";
import { Context } from "./ctx.js";

import { handleRouteNotFound, runHooks } from "./utils/request.util.js";

import { HTTPException } from "./http-exception";
import { Router, RouterFactory } from "./router/interface.js";
import { ALL_METHOD, EMPTY_OBJ } from "./constant.js";
import { isPromise } from "./utils/promise.js";

export default class Diesel {
  private static instance: Diesel;
  routes: Record<string, Function>;
  private tempRoutes: Map<string, TempRouteEntry> | null;
  tempMiddlewares: Map<string, middlewareFunc[]> | null;

  router: Router;
  hasOnReqHook: boolean;
  hasPreHandlerHook: boolean;
  hasOnSendHook: boolean;
  hasOnError: boolean;
  hooks: Hooks;
  corsConfig: corsT;
  // private serverInstance: BunServer | null; // unused now that listen()/close() are commented out
  staticFiles: any | undefined;
  baseApiUrl: string;
  idleTimeOut: number;
  routeNotFoundFunc: (
    c: Context,
  ) => void | Promise<void> | Promise<Response> | Response;
  private prefixApiUrl: string | null;
  compileConfig: CompileConfig | null;
  #newPipelineArchitecture: boolean = false;
  emitter: undefined | EventEmitter;
  errorFormat: errorFormat;
  // tha path of static files
  staticPath: any;
  // the request path where user wants static files should be server
  staticRequestPath: string | undefined = undefined;

  /**
   * `.fetch` is the entry point of your app — pass it directly to a server,
   * e.g. `Bun.serve({ fetch: app.fetch })` or `export default { fetch: app.fetch }`.
   * For Cloudflare Workers use `cfFetch()` instead.
   *
   * Backed by a self-replacing getter: the first time this property is read,
   * it builds the real handler (freeing `tempRoutes`/`tempMiddlewares` in the
   * process) and replaces itself on the instance with that plain function, so
   * there is zero wrapper overhead on any request after the first read.
   */
  declare fetch: DieselFetchHandler;

  /**
   * Makes a new Diesel app. Everything is optional, sane defaults kick
   * in if you don't pass anything.
   *
   * @param options - router choice, error format, api prefix, idle timeout, etc.
   */
  constructor(options: DieselOptions = {}) {
    const {
      router = "t2",
      routerInstance,
      errorFormat = "json",
      prefixApiUrl = "",
      baseApiUrl = "",
      idleTimeOut = 10,
      pipelineArchitecture = false,
    } = options;

    if (routerInstance) this.router = routerInstance;
    else this.router = RouterFactory.create(router);

    this.errorFormat = errorFormat;

    if (!Diesel.instance) {
      Diesel.instance = this;
    }
    if (pipelineArchitecture) {
      this.#newPipelineArchitecture = true;
    }

    this.errorFormat = errorFormat;

    this.prefixApiUrl = prefixApiUrl ?? "";
    this.#defineFetch();
    this.routes = {};
    this.idleTimeOut = idleTimeOut ?? 10;
    this.baseApiUrl = baseApiUrl || "";
    this.tempRoutes = null;
    this.tempMiddlewares = null;
    this.corsConfig = null;
    this.hasOnReqHook = false;
    this.hasPreHandlerHook = false;
    this.hasOnSendHook = false;
    this.hasOnError = false;
    this.hooks = {
      onRequest: null,
      preHandler: null,
      onSend: null,
      onError: null,
      onClose: null,
    };

    // this.serverInstance = null; // unused now that listen()/close() are commented out
    this.staticPath = null;
    this.routeNotFoundFunc = () => {};

    this.compileConfig = null;
  }

  // HTTP verb methods live on the prototype (shared across every instance)
  // instead of being re-created as per-instance closures in the
  // constructor — avoids allocating 10 closures on every `new Diesel()`.

  /**
   * Registers a GET route. Pass one or more handlers, they run in
   * order, first one to return a response wins.
   *
   * @param path - route path, e.g. "/user/:id"
   * @param handlers - one or more handler functions
   * @returns this, so you can chain more routes
   */
  get(path: string, ...handlers: handlerFunction[]): this {
    this.addRoute("GET", path, handlers);
    return this;
  }
  /** Same as get(), but for POST requests. */
  post(path: string, ...handlers: handlerFunction[]): this {
    this.addRoute("POST", path, handlers);
    return this;
  }
  /** Same as get(), but for PUT requests. */
  put(path: string, ...handlers: handlerFunction[]): this {
    this.addRoute("PUT", path, handlers);
    return this;
  }
  /** Same as get(), but for PATCH requests. */
  patch(path: string, ...handlers: handlerFunction[]): this {
    this.addRoute("PATCH", path, handlers);
    return this;
  }
  /** Same as get(), but for DELETE requests. */
  delete(path: string, ...handlers: handlerFunction[]): this {
    this.addRoute("DELETE", path, handlers);
    return this;
  }
  /** Matches any http method on this path. */
  any(path: string, ...handlers: handlerFunction[]): this {
    this.addRoute("ANY", path, handlers);
    return this;
  }
  /** Same as get(), but for HEAD requests. */
  head(path: string, ...handlers: handlerFunction[]): this {
    this.addRoute("HEAD", path, handlers);
    return this;
  }
  /** Same as get(), but for OPTIONS requests. */
  options(path: string, ...handlers: handlerFunction[]): this {
    this.addRoute("OPTIONS", path, handlers);
    return this;
  }
  /** Same as get(), but for PROPFIND requests (webdav stuff). */
  propfind(path: string, ...handlers: handlerFunction[]): this {
    this.addRoute("PROPFIND", path, handlers);
    return this;
  }
  /** Same as any(), registers the route under the internal "ALL" method. */
  all(path: string, ...handlers: handlerFunction[]): this {
    this.addRoute("ALL", path, handlers);
    return this;
  }

  /**
   * Experimental. Gives you back a proxy over the single shared Diesel
   * instance that auto-prefixes every path you register with `prefix`.
   * Made mostly so you can do sub routing without passing the app
   * instance around everywhere.
   *
   * @param prefix - path prefix to stick in front of every route
   * @returns a proxied Diesel instance
   */
  static router(prefix: string) {
    // this.instance.prefixApiUrl = apiPath;
    if (!this.instance) {
      this.instance = new Diesel();
    }

    // creating proxy to intercept router and add prefix url only for this
    return new Proxy(this.instance, {
      get(target, prop, reciever) {
        return (path: string, handler: any) => {
          let givenHandler = handler;
          let givenPath = "";

          if (typeof path === "string") givenPath = path;
          else if (typeof path === "function") givenHandler = path;
          else if (typeof path !== "string") givenPath = "";

          const fullPath = prefix + givenPath;
          return (target as any)[prop](fullPath, givenHandler);
          // if (typeof path === 'string') return (target as any)[prop](fullPath, handler)
          // else if (typeof path === 'function') return (target as any)[prop](path)
        };
      },
    });
  }

  /**
   * Registers a route that just redirects. Any `:param` in incomingPath
   * gets substituted into redirectPath if it's there, and the query
   * string gets carried over too.
   *
   * @param incomingPath - path to match, can have route params
   * @param redirectPath - where to send the client, can reuse `:param` names
   * @param statusCode - redirect status code, defaults to 302
   * @returns this, so you can chain more routes
   */
  redirect(incomingPath: string, redirectPath: string, statusCode?: 302): this {
    this.any(incomingPath, (ctx: Context) => {
      const params = ctx.params;
      let finalPathToRedirect = redirectPath;

      if (params) {
        for (const key in params) {
          finalPathToRedirect = finalPathToRedirect.replace(
            `:${key}`,
            params[key],
          );
        }
      }

      const queryParams = ctx.url.search;
      if (queryParams) finalPathToRedirect += queryParams;

      return ctx.redirect(finalPathToRedirect, statusCode);
    });
    return this;
  }

  /**
   * Points the app at a folder to serve static files from.
   *
   * @param path - folder on disk to serve files from
   * @param requestPath - url path clients should hit to get those files
   * @returns this, so you can chain more calls
   */
  static(path: string, requestPath?: string) {
    this.staticPath = path;
    this.staticRequestPath = requestPath;
    return this;
  }

  /**
   * Registers static html pages by name, merges with whatever was
   * added before instead of replacing it.
   *
   * @param args - map of name to html content/path
   * @returns this, so you can chain more calls
   */
  staticHtml(args: Record<string, string>): this {
    if (!this.staticFiles) this.staticFiles = {};
    this.staticFiles = { ...this.staticFiles, ...args };
    return this;
  }

  /**
   * Registers a lifecycle hook, one of onRequest, preHandler, onSend,
   * onError, onClose. Hooks run in the order you add them.
   *
   * @param typeOfHook - which hook to add to
   * @param fnc - the function to run for that hook
   * @returns this, so you can chain more calls
   */
  addHooks<T extends HookType>(
    typeOfHook: T,
    fnc: NonNullable<Hooks[T]>[number],
  ): this {
    if (typeof typeOfHook !== "string") {
      throw new Error("hookName must be a string");
    }

    if (typeof fnc !== "function") {
      throw new Error("callback must be a instance of function");
    }

    switch (typeOfHook) {
      case "onRequest":
        (this.hooks.onRequest ??= []).push(fnc as onRequest);
        this.hasOnReqHook = true;
        break;
      case "preHandler":
        (this.hooks.preHandler ??= []).push(fnc as HookFunction);
        this.hasPreHandlerHook = true;
        break;
      case "onSend":
        (this.hooks.onSend ??= []).push(fnc as onSend);
        this.hasOnSendHook = true;
        break;
      case "onError":
        (this.hooks.onError ??= []).push(fnc as onError);
        this.hasOnError = true;
        break;
      case "onClose":
        (this.hooks.onClose ??= []).push(fnc as HookFunction);
        break;
      default:
        throw new Error(`Unknown hook type: ${typeOfHook}`);
    }
    return this;
  }

  // For logging incoming requests. Pass the `logger` implementation
  // (e.g. `import { logger } from "diesel-core/logger"`) so it's only
  // bundled for apps that actually use it.

  /**
   * Wires up request logging. You pass the logger implementation
   * itself (not imported by us) so apps that don't use logging don't
   * pay for it in bundle size.
   *
   * @param loggerFn - the logger implementation to use
   * @param options - logger options, minus `app` which we fill in
   * @returns this, so you can chain more calls
   */
  useLogger(
    loggerFn: (options: LoggerOptions) => void,
    options?: Omit<LoggerOptions, "app">,
  ) {
    loggerFn({ ...options, app: this } as LoggerOptions);
    return this;
  }

  /** Same idea as useLogger(), but for the advanced logger variant. */
  useAdvancedLogger(
    loggerFn: (options: AdvancedLoggerOptions) => void,
    options?: Omit<AdvancedLoggerOptions, "app">,
  ) {
    loggerFn({ ...options, app: this } as AdvancedLoggerOptions);
    return this;
  }

  /**
   * High performance route, skips the normal handler pipeline. Use
   * this only for endpoints where you really need the extra speed.
   *
   * @param method - http method, e.g. "GET"
   * @param path - route path
   * @param handlersOrResponse - handlers (or a direct response) for this route
   * @returns this, so you can chain more routes
   */
  BunRoute(method: string, path: string, ...handlersOrResponse: any[]): this {
    if (!path || typeof path !== "string")
      throw new Error("give a path in string format");
    const handlerFunction = BunRequestPipline(
      this as any,
      method.toUpperCase(),
      path,
      ...handlersOrResponse,
    );
    this.routes[path] = handlerFunction;
    return this;
  }

  /**
   * Entry point for Cloudflare Workers, use this instead of `.fetch`
   * on that runtime since workers pass `(req, env, executionContext)`
   * instead of `(req, server, env, executionContext)`.
   *
   * @returns a fetch-compatible handler for cloudflare workers
   */
  cfFetch() {
    this.tempRoutes = null;
    this.tempMiddlewares = null;

    if (this.#newPipelineArchitecture) {
      const execute_handler = build_request_pipeline_latest(this);
      return (
        req: Request,
        env: Record<string, string>,
        executionContext: any,
      ) => {
        const path = getPath(req.url);
        let matchedRouteHandler = this.router.find(
          req.method as HttpMethod,
          path,
        );
        if (matchedRouteHandler.handler === undefined && req.method === "HEAD") matchedRouteHandler = this.router.find("GET", path);
        const ctx = new Context(
          req,
          undefined,
          path,
          matchedRouteHandler?.params ?? EMPTY_OBJ,
          env,
          executionContext,
        );
        return execute_handler(this, ctx, matchedRouteHandler).catch(
          async (error: any) => {
            return this.handleError(error, ctx);
          },
        );
      };
    }

    return (request: Request, env: Record<string, any>, executionCtx: any) => {
      return this.#handleRequests(request, undefined, env, executionCtx);
    };
  }

  /**
   * Sets up `this.fetch` as a self-replacing getter. First time
   * something reads `app.fetch`, this builds the real handler and
   * overwrites the getter with a plain function, so every request
   * after the first read hits the handler directly, no getter cost.
   */
  #defineFetch(): void {
    Object.defineProperty(this, "fetch", {
      configurable: true,
      enumerable: true,
      get: () => {
        const built = this.#buildFetchHandler();
        Object.defineProperty(this, "fetch", {
          value: built,
          writable: true,
          configurable: true,
          enumerable: true,
        });
        return built;
      },
    });
  }

  // NORMAL WAY WITH BUN/NODE/DENO — for Cloudflare Workers use cfFetch() instead.

  /**
   * Builds the real fetch handler, picks between the new pipeline
   * architecture and the default `#handleRequests` path depending on
   * the `pipelineArchitecture` option passed into the constructor.
   * Also clears tempRoutes/tempMiddlewares since they're only needed
   * before the router is built.
   */
  #buildFetchHandler() {
    this.tempRoutes = null;
    this.tempMiddlewares = null;

    if (this.#newPipelineArchitecture) {
      const execute_handler = build_request_pipeline_latest(this);
      return (
        req: Request,
        server?: RuntimeServer,
        env?: Record<string, any>,
        executionContext?: any,
      ) => {
        const path = getPath(req.url);
        let matchedRouteHandler = this.router.find(
          req.method as HttpMethod,
          path,
        );
        if (matchedRouteHandler.handler === undefined && req.method === "HEAD") matchedRouteHandler = this.router.find("GET", path);
        const ctx = new Context(
          req,
          server,
          path,
          matchedRouteHandler?.params ?? EMPTY_OBJ,
          env,
          executionContext,
        );
        return execute_handler(this, ctx, matchedRouteHandler).catch(
          async (error: any) => {
            return this.handleError(error, ctx);
          },
        );
      };
    }

    // Default
    return this.#handleRequests.bind(this);
  }

  /**
   * The default request handler (non-pipeline mode). Finds the
   * matching route, builds a Context for it, and runs the handlers.
   * Falls back to matching a GET route on HEAD requests since HEAD
   * responses reuse the GET handler's headers.
   *
   * @param req - the incoming request
   * @param server - runtime server instance, optional
   * @param env - env vars/bindings, optional
   * @param executionContext - runtime specific execution context, optional
   * @returns the response, or a promise of one
   */
  #handleRequests(
    req: Request,
    server?: RuntimeServer,
    env?: Record<string, any>,
    executionContext?: any,
  ): Response | Promise<Response | undefined> {
    const path = getPath(req.url);

    let matchedRouteHandler = this.router.find(
      req.method as HttpMethod,
      path,
    );
    if (matchedRouteHandler.handler === undefined && req.method === "HEAD") matchedRouteHandler = this.router.find("GET", path);

    const ctx = new Context(
      req,
      server,
      path,
      matchedRouteHandler?.params ?? EMPTY_OBJ,
      env,
      executionContext,
    );
    return this.#execute_handlers(ctx, matchedRouteHandler).catch((err: any) =>
      this.handleError(err, ctx),
    );
  }

  /**
   * Runs the actual request lifecycle for a matched route: onRequest
   * hook, then middlewares, then preHandler hook, then the route
   * handler(s), then onSend hook. Whichever step returns a truthy
   * response first wins and short-circuits the rest. Falls through to
   * the not-found handler if nothing produced a response.
   *
   * @param ctx - the request context
   * @param matchedRouteHandler - whatever the router found for this request
   * @returns the response, or undefined if nothing matched
   */
  async #execute_handlers(
    ctx: Context,
    matchedRouteHandler: any,
  ): Promise<Response | undefined> {
    if (this.hasOnReqHook)
      await runHooks("onRequest", this.hooks.onRequest, [ctx]);

    // Middleware exec
    if (matchedRouteHandler.middlewares?.length) {
      for (const mw of matchedRouteHandler.middlewares) {
        let res = mw(ctx);
        res = isPromise(res) ? await res : res;
        if (res) return res;
      }
    }

    // pre handler
    if (this.hasPreHandlerHook) {
      const result = await runHooks("preHandler", this.hooks.preHandler, [ctx]);
      if (result) return result;
    }

    let finalResult;
    if (matchedRouteHandler.handler !== undefined) {
      const handlers = matchedRouteHandler.handler;
      if (handlers.length === 1) {
        const result = handlers[0](ctx);
        finalResult = isPromise(result) ? await result : result;
      } else {
        for (let i = 0; i < handlers.length; i++) {
          const result = handlers[i](ctx);
          finalResult = isPromise(result) ? await result : result;
          if (finalResult) break;
        }
      }
    }

    // onSend
    if (this.hasOnSendHook) {
      const response = await runHooks("onSend", this.hooks.onSend, [
        ctx,
        finalResult,
      ]);
      if (response) return response;
    }

    if (finalResult) return finalResult;

    return await handleRouteNotFound(this as any, ctx as any, ctx.path!);
  }

  /**
   * Turns whatever got thrown during a request into a response.
   * Checks in order: your own onError hook, then whether it's an
   * HTTPException (has its own status/message), then falls back to a
   * generic 500. Stack traces only get included in the response body
   * when NODE_ENV is "development".
   *
   * @param err - whatever was thrown
   * @param ctx - the request context, used for headers/path
   * @returns an error Response
   */
  private async handleError(err: unknown, ctx: Context) {
    const isDev = process.env.NODE_ENV === "development";

    const format = this.errorFormat;
    const path = ctx.path ?? "";

    const headers = new Headers(ctx.headers ?? ctx.req.headers);

    // 1. user defined hooks
    if (this.hasOnError) {
      const hookResult = await runHooks("onError", this.hooks.onError, [
        err,
        path,
        ctx.req,
      ]);
      if (hookResult) return hookResult;
    }

    // 2. HTTPException
    if (
      err &&
      typeof err === "object" &&
      (err as HTTPException).name === "HTTPException"
    ) {
      // If a custom Response was provided, use it
      const httpErr = err as HTTPException;
      console.error(`HTTPException on path: ${path}`, {
        status: httpErr.status,
        message: httpErr.message,
        cause: httpErr.cause,
        res: httpErr.res,
        stack: httpErr.stack,
      });

      if (httpErr.res) return httpErr.res;

      return format === "json"
        ? Response.json({ error: httpErr.message }, { status: httpErr.status, headers })
        : new Response(httpErr.message, { status: httpErr.status , headers });
    }

    // 3. Default fallback
    const errorMessage =
      err instanceof Error ? err.message : "Internal Server Error";
    const errorStack = err instanceof Error ? err.stack : undefined;

    console.error(`Error on path: ${path}`, {
      message: errorMessage,
      stack: errorStack,
    });

    if (format === "json") {
      const body: Record<string, any> = {
        error: errorMessage,
        ...(isDev && { stack: errorStack }),
        path,
      };
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json")
      }
      return Response.json(body, {
        status: 500,
        headers,
      });
    } else {
      const message: string = isDev
        ? `Error: ${errorMessage}\nStack: ${errorStack}`
        : `Error: ${errorMessage}`;
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "text/plain")
      }
      return new Response(message, {
        headers,
        status: 500,
      });
    }
  }

  /**
   * Mount method
   * we can use 3rd party framework which exposes fetch method
   *
   * @param prefix - path prefix to mount the other app/handler under
   * @param instance - another fetch-compatible app, or a raw fetch function
   */
  mount(prefix: string, instance: DieselFetchHandler | any) {
    const cleanPrefix = prefix.endsWith("/*") ? prefix.slice(0, -2) : prefix;
    const prefixLength = cleanPrefix === "/" ? 0 : cleanPrefix.length;

    const fetchHandler =
      typeof instance === "function"
        ? instance
        : (instance.fetch as DieselFetchHandler);

    const handler = async (ctx: Context) => {
      const path = ctx.path?.slice(prefixLength) || "/";

      const url = new URL(ctx.req.url);
      url.pathname = path;
      const newRequest = new Request(url, ctx.req);
      const response = await fetchHandler(
        newRequest,
        ctx.server,
        ctx.env,
        ctx.executionContext,
      );

      if (ctx.headers === undefined || response === undefined) return response;

      const merged = new Headers(response.headers);
      for (const [key, value] of ctx.headers) {
        if (!merged.has(key)) merged.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: merged,
      });
    };

    this.all(prefix, handler as handlerFunction);
    this.all(cleanPrefix, handler as handlerFunction);
  }

  /**
   * Sub routing ( recommended ). Mounts a whole other Diesel instance
   * under a prefix, it shares the request lifecycle (hooks, error
   * handling)
   *
   * @param prefix - path prefix for the child app's routes
   * @param child - another Diesel instance
   */
  sub(prefix: string, child: Diesel) {
    const cleanPrefix = prefix.endsWith("/*") ? prefix.slice(0, -2) : prefix;
    const prefixLength = cleanPrefix === "/" ? 0 : cleanPrefix.length;

    const handler = (ctx: Context) => {
      const path = ctx.path?.slice(prefixLength) || "/";
      const matchedRouteHandler = child.router.find(ctx.req.method, path);
      ctx.path = path;
      ctx.params = matchedRouteHandler?.params ?? EMPTY_OBJ;
      return child
        .#execute_handlers(ctx, matchedRouteHandler)
        .catch((err: any) => this.handleError(err, ctx));
    };

    this.all(prefix, handler as handlerFunction);
    this.all(cleanPrefix, handler as handlerFunction);
  }

  /**
   * Registers a router instance for subrouting.
   * Allows defining subroutes like:
   *   const userRoute = new Diesel();
   *   app.route("/api/v1/user", userRoute);
   *
   * Copies over the routerInstance's temp routes and middlewares onto
   * this app's router, then nulls out routerInstance so it can't
   * accidentally get reused (also helps it get garbage collected).
   *
   * @param basePath - prefix for all of routerInstance's routes
   * @param routerInstance - the Diesel instance holding the routes to copy
   * @returns this, so you can chain more calls
   */
  route(basePath: string | undefined, routerInstance: Diesel): this {
    basePath =
      basePath && basePath.length > 0
        ? basePath
        : (routerInstance?.prefixApiUrl as string | undefined);

    const tempRoutes =
      routerInstance?.tempRoutes ?? new Map<string, TempRouteEntry>();

    for (const [path, args] of tempRoutes.entries()) {
      const cleanedPath = path.replace(/::\w+$/, "");
      const fullpath = `${basePath}${cleanedPath}`;
      const method = args.method;
      this.router.add(method, fullpath, args.handlers as unknown as Function[]);
    }

    // Middleware assigning
    const tempMiddlewares =
      routerInstance?.tempMiddlewares ?? new Map<string, middlewareFunc[]>();

    for (const [path, handlers] of tempMiddlewares.entries()) {
      const fullPath = path === "/" ? basePath || "/" : `${basePath}${path}`;
      this.router.addMiddleware(fullPath, handlers);
    }

    // Nullify the router instance to prevent accidental reuse.
    // and to prevent memory leak
    routerInstance = null as any;
    return this;
  }

  /**
   same as Route
   */
  // #register(
  //   module: (app: Diesel) => void
  // ): this {
  //   const newAPP = new Diesel()
  //   const wrapper = () => {

  //   }
  //   return this
  // }

  /**
   * Shared internal helper that all the HTTP verb methods (get, post,
   * etc.) call into. Validates the inputs, keeps a temp record of the
   * route (used later by route()/sub() for copying routes over), and
   * adds it to the router.
   *
   * @param method - http method
   * @param path - route path
   * @param handlers - handlers for this route
   */
  private addRoute(
    method: HttpMethod,
    path: string,
    handlers: handlerFunction[],
  ): void {
    // path = this.prefixApiUrl ? this.prefixApiUrl + path : path;

    if (typeof path !== "string")
      throw new Error(
        `Error in ${handlers[handlers.length - 1]}: Path must be a string. Received: ${typeof path}`,
      );
    if (typeof method !== "string")
      throw new Error(
        `Error in addRoute: Method must be a string. Received: ${typeof method}`,
      );

    (this.tempRoutes ??= new Map<string, TempRouteEntry>()).set(
      path + "::" + method,
      { method, handlers },
    );
    method = method === "ANY" ? ALL_METHOD : method;
    this.router.add(method, path, handlers as unknown as Function[]);
  }

  /**
   * Adds middleware to the application.
   * - Middlewares are executed in the order they are added.
   * - Duplicate middleware functions will run multiple times if explicitly included.
   *
   * Examples:
   * - app.use(h1) -> Adds a single global middleware.
   * - app.use("/home", h1) -> Adds `h1` middleware to the `/home` path.
   *
   * @param pathORHandler - a path string, or the first middleware function if you're going global
   * @param handlers - more middleware functions
   * @returns this, so you can chain more calls
   */
  use(
    pathORHandler?:
      | string
      | string[]
      | middlewareFunc
      | middlewareFunc[]
      | Function
      | Function[],
    ...handlers: middlewareFunc | middlewareFunc[] | Function | Function[] | any
  ): this {
    if (!this.tempMiddlewares) this.tempMiddlewares = new Map();
    if (typeof pathORHandler === "string") {
      let path = pathORHandler === "/" ? "/" : pathORHandler;
      if (!this.tempMiddlewares.has(path)) this.tempMiddlewares.set(path, []);
      this.tempMiddlewares.get(path)!.push(...handlers);

      this.router.addMiddleware(path, handlers);
    } else if (typeof pathORHandler === "function") {
      const arrs = [pathORHandler, ...handlers];
      if (!this.tempMiddlewares.has("/")) this.tempMiddlewares.set("/", []);
      this.tempMiddlewares.get("/")!.push(...handlers);

      this.router.addMiddleware("/", arrs);
    }

    return this;
  }

  /**
   * Sets a custom handler for when no route matches, instead of the
   * default 404.
   *
   * @param handler - runs on unmatched requests
   * @returns this, so you can chain more calls
   */
  routeNotFound(handler: RouteNotFoundHandler) {
    this.routeNotFoundFunc = handler;
    return this;
  }

  /**
   * Registers the same handlers for multiple http methods at once,
   * instead of calling `.get()`, `.post()`, etc separately.
   *
   * @param methods - one method, or an array of methods
   * @param path - route path
   * @param handlers - handlers to run for all of these methods
   * @returns this, so you can chain more calls
   */
  onMethod(
    methods: string | (HttpMethod | string)[],
    path: string,
    ...handlers: handlerFunction[]
  ) {
    const methodArray = Array.isArray(methods) ? methods : [methods];

    for (const method of methodArray) {
      const httpMethod = method.toLowerCase();

      if (httpMethod in this) {
        (this as any)[httpMethod](path, ...handlers);
      } else {
        this.addRoute(method.toUpperCase() as HttpMethod, path, handlers);
      }
    }

    return this;
  }

  /**
   * Listens for a custom event on the app, just a thin wrapper over
   * node's EventEmitter, made lazily on first use.
   *
   * @param event - event name
   * @param listener - runs when the event fires
   * @returns this, so you can chain more calls
   */
  on(event: string | symbol, listener: (...args: any[]) => void) {
    if (!this.emitter) this.emitter = new EventEmitter();
    this.emitter.on(event, listener);
    return this;
  }

  /**
   * Fires a custom event on the app.
   *
   * @param event - event name
   * @param args - passed through to the listeners
   * @returns this, so you can chain more calls
   */
  emit(event: string | symbol, ...args: any) {
    if (!this.emitter) this.emitter = new EventEmitter();
    this.emitter.emit(event, ...args);
    return this;
  }
}
