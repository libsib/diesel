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
  RouteHandler,
  RouteNotFoundHandler,
  TempRouteEntry,
  type handlerFunction,
  type Hooks,
  type HttpMethod,
} from "./types.js";

import { Server } from "bun";

import type {
  AdvancedLoggerOptions,
  LoggerOptions,
} from "./middlewares/logger/logger.js";

import {
  build_request_pipeline_latest,
  buildRequestPipeline,
  BunRequestPipline,
} from "./request_pipeline.js";

import { getPath } from "./utils/urls.js";

import { EventEmitter } from "events";
import { Context } from "./ctx.js";

import { handleRouteNotFound, runHooks } from "./utils/request.util.js";

import { HTTPException } from "./http-exception";
import { Router, RouterFactory } from "./router/interface.js";
import { ALL_METHOD, EMPTY_OBJ, supportedMethods } from "./constant.js";
import { isPromise } from "./utils/promise.js";

export default class Diesel {
  private static instance: Diesel;
  routes: Record<string, Function>;
  private tempRoutes: Map<string, TempRouteEntry> | null;
  tempMiddlewares: Map<string, middlewareFunc[]> | null;

  router: Router;
  hasOnReqHook: boolean;
  hasPreHandlerHook: boolean;
  hasPostHandlerHook: boolean;
  hasOnSendHook: boolean;
  hasOnError: boolean;
  hooks: Hooks;
  corsConfig: corsT;
  private serverInstance: Server | null;
  staticFiles: any | undefined;
  user_jwt_secret: string | undefined;
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
  platform: string = "bun";
  // tha path of static files
  staticPath: any;
  // the request path where user wants static files should be server
  staticRequestPath: string | undefined = undefined;

  get!: RouteHandler;
  post!: RouteHandler;
  put!: RouteHandler;
  patch!: RouteHandler;
  delete!: RouteHandler;
  any!: RouteHandler;
  head!: RouteHandler;
  options!: RouteHandler;
  propfind!: RouteHandler;
  all!: RouteHandler;

  /**
   * `.fetch` is the entry point of your app — pass it directly to a server,
   * e.g. `Bun.serve({ fetch: app.fetch })` or `export default { fetch: app.fetch }`.
   *
   * Backed by a self-replacing getter: the first time this property is read,
   * it builds the real handler (freeing `tempRoutes`/`tempMiddlewares` in the
   * process) and replaces itself on the instance with that plain function, so
   * there is zero wrapper overhead on any request after the first read.
   */
  declare fetch: DieselFetchHandler;

  constructor(options: DieselOptions = {}) {
    supportedMethods.forEach((method) => {
      (this as any)[method.toLocaleLowerCase()] = (
        path: string,
        ...handlers: any
      ): this => {
        this.addRoute(method as HttpMethod, path, handlers);
        return this;
      };
    });

    const {
      router = "t2",
      routerInstance,
      errorFormat = "json",
      platform = "bun",
      prefixApiUrl = "",
      baseApiUrl = "",
      jwtSecret,
      idleTimeOut = 10,
      pipelineArchitecture = false,
      onError,
    } = options;

    if (routerInstance) this.router = routerInstance;
    else this.router = RouterFactory.create(router);

    this.errorFormat = errorFormat;
    this.platform = platform;

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
    this.user_jwt_secret = jwtSecret || process.env.DIESEL_JWT_SECRET;
    this.tempRoutes = new Map<string, TempRouteEntry>();
    this.tempMiddlewares = null;
    this.corsConfig = null;
    this.hasOnReqHook = false;
    this.hasPreHandlerHook = false;
    this.hasPostHandlerHook = false;
    this.hasOnSendHook = false;
    this.hasOnError = false;
    this.hooks = {
      onRequest: null,
      preHandler: null,
      postHandler: null,
      onSend: null,
      onError: null,
      onClose: null,
    };

    // if user wants to log Error and respective Res
    if (onError)
      this.addHooks("onError", (err: ErrnoException, path: string) => {
        console.log("Got an exception:", err);
        console.log("Request Path:", path);
      });

    this.serverInstance = null;
    this.staticPath = null;
    this.routeNotFoundFunc = () => {};

    this.compileConfig = null;
  }

  // experimental for sub routing using single ton
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

  // for redirect on a specific path
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

  static(path: string, requestPath?: string) {
    this.staticPath = path;
    this.staticRequestPath = requestPath;
    return this;
  }

  staticHtml(args: Record<string, string>): this {
    if (!this.staticFiles) this.staticFiles = {};
    this.staticFiles = { ...this.staticFiles, ...args };
    return this;
  }

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
      case "postHandler":
        (this.hooks.postHandler ??= []).push(fnc as HookFunction);
        this.hasPostHandlerHook = true;
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
  useLogger(
    loggerFn: (options: LoggerOptions) => void,
    options?: Omit<LoggerOptions, "app">,
  ) {
    loggerFn({ ...options, app: this } as LoggerOptions);
    return this;
  }

  useAdvancedLogger(
    loggerFn: (options: AdvancedLoggerOptions) => void,
    options?: Omit<AdvancedLoggerOptions, "app">,
  ) {
    loggerFn({ ...options, app: this } as AdvancedLoggerOptions);
    return this;
  }

  // this is for high performance api endpoint.
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

  listen(port: any, ...args: listenArgsT[]): Server | void {
    let hostname = "0.0.0.0";
    let callback: (() => void) | undefined = undefined;
    let options: { cert?: string; key?: string } = {};

    for (const arg of args) {
      if (typeof arg === "string") {
        hostname = arg;
      } else if (typeof arg === "function") {
        callback = arg;
      } else if (typeof arg === "object" && arg !== null) {
        options = arg;
      }
    }

    const ServerOptions: any = {
      port,
      hostname,
      idleTimeOut: this.idleTimeOut,
      fetch: this.fetch(),
    };

    if (this.staticFiles) ServerOptions.static = this.staticFiles;

    if (this.routes && Object.keys(this.routes).length > 0) {
      ServerOptions.routes = this.routes;
    }

    if (options.cert && options.key) {
      ServerOptions.certFile = options.cert;
      ServerOptions.keyFile = options.key;
    }

    this.serverInstance = Bun?.serve(ServerOptions);

    callback && callback();

    return this.serverInstance;
  }

  close(callback?: () => void): void {
    if (this.serverInstance) {
      this.serverInstance.stop(true);
      this.serverInstance = null;
      callback ? callback() : console.log("Server has been stopped");
    } else {
      console.warn("Server is not running.");
    }
  }

  // for cloudflare fetch
  cfFetch() {
    this.tempRoutes = null;
    this.tempMiddlewares = null;

    return (request: Request, env: Record<string, any>, executionCtx: any) => {
      return this.#handleRequests(request, undefined, env, executionCtx);
    };
  }

  #defineFetch(): void {
    Object.defineProperty(this, "fetch", {
      configurable: true,
      enumerable: true,
      get: () => {
        console.log("building")
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

  #buildFetchHandler() {
    this.tempRoutes = null;
    this.tempMiddlewares = null;

    // if user is using for cloudflare workers
    if (this.platform === "cf" || this.platform === "cloudflare") {
      if (this.#newPipelineArchitecture) {
        const pipeline = buildRequestPipeline(this as any);
        return (
          req: Request,
          env?: Record<string, string>,
          executionContext?: any,
        ) => {
          return pipeline(req, this, undefined, env, executionContext).catch(
            async (error: any) => {
              return this.handleError(error, getPath(req.url), req);
            },
          );
        };
      }

      // cloudflare handler
      return (
        request: Request,
        env?: Record<string, any>,
        executionContext?: any,
      ) => {
        return this.#handleRequests(request, undefined, env, executionContext);
      };
    }

    // NORMAL WAY WITH BUN/NODE/DENO

    if (this.#newPipelineArchitecture) {
      const execute_handler = build_request_pipeline_latest(this);
      return (
        req: Request,
        server?: Server,
        env?: Record<string, any>,
        executionContext?: any,
      ) => {
        const path = getPath(req.url);
        const matchedRouteHandler = this.router.find(
          req.method as HttpMethod,
          path,
        );
        const ctx = new Context(
          req,
          server,
          path,
          matchedRouteHandler?.params || EMPTY_OBJ,
          env,
          executionContext,
        );
        return execute_handler(this, ctx, matchedRouteHandler).catch(
          async (error: any) => {
            return this.handleError(error, getPath(req.url), req);
          },
        );
      };
    }

    // Default
    return this.#handleRequests.bind(this);
  }

  #handleRequests(
    req: Request,
    server?: Server,
    env?: Record<string, any>,
    executionContext?: any,
  ): Response | Promise<Response | undefined> {
    const path = getPath(req.url);
    const matchedRouteHandler = this.router.find(
      req.method as HttpMethod,
      path,
    );
    const ctx = new Context(
      req,
      server,
      path,
      matchedRouteHandler?.params || EMPTY_OBJ,
      env,
      executionContext,
    );
    return this.#execute_handlers(ctx, matchedRouteHandler).catch((err: any) =>
      this.handleError(err, path, req),
    );
  }

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
    if (matchedRouteHandler.handler) {
      const handlers = matchedRouteHandler.handler;
      for (let i = 0; i < handlers.length; i++) {
        const result = handlers[i](ctx);
        finalResult = isPromise(result) ? await result : result;
        if (finalResult) break;
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

  // HandleError
  private async handleError(err: unknown, path: string, req: Request) {
    const isDev = process.env.NODE_ENV === "development";

    const format = this.errorFormat;

    // 1. user defined hooks
    if (this.hasOnError) {
      const hookResult = await runHooks("onError", this.hooks.onError, [
        err,
        path,
        req,
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
        ? Response.json({ error: httpErr.message }, { status: httpErr.status })
        : new Response(httpErr.message, { status: httpErr.status });
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
      return Response.json(body, {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    } else {
      const message: string = isDev
        ? `Error: ${errorMessage}\nStack: ${errorStack}`
        : `Error: ${errorMessage}`;

      return new Response(message, {
        headers: { "Content-Type": "text/plain" },
        status: 500,
      });
    }
  }

  /**
   * Mount method
   * we can use 3rd party framework with diesel.js
   * for diesel , i recommend sub method
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

      if (!ctx.headers || !response) return response;

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

  // sub routing ( recommended )
  sub(prefix: string, child: Diesel) {
    const cleanPrefix = prefix.endsWith("/*") ? prefix.slice(0, -2) : prefix;
    const prefixLength = cleanPrefix === "/" ? 0 : cleanPrefix.length;

    const handler = (ctx: Context) => {
      const path = ctx.path?.slice(prefixLength) || "/";
      const matchedRouteHandler = child.router.find(ctx.req.method, path);
      ctx.path = path;
      ctx.params = matchedRouteHandler?.params || EMPTY_OBJ;
      return child
        .#execute_handlers(ctx, matchedRouteHandler)
        .catch((err: any) => this.handleError(err, path, ctx.req));
    };

    this.all(prefix, handler as handlerFunction);
    this.all(cleanPrefix, handler as handlerFunction);
  }

  /**
   * Registers a router instance for subrouting.
   * Allows defining subroutes like:
   *   const userRoute = new Diesel();
   *   app.route("/api/v1/user", userRoute);
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

    this.tempRoutes?.set(path + "::" + method, { method, handlers });
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

  routeNotFound(handler: RouteNotFoundHandler) {
    this.routeNotFoundFunc = handler;
    return this;
  }

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

  on(event: string | symbol, listener: (...args: any[]) => void) {
    if (!this.emitter) this.emitter = new EventEmitter();
    this.emitter.on(event, listener);
    return this;
  }

  emit(event: string | symbol, ...args: any) {
    if (!this.emitter) this.emitter = new EventEmitter();
    this.emitter.emit(event, ...args);
    return this;
  }
}
