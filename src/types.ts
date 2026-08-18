import { Router } from "./router/interface";
import Diesel from "./main";
import type { Context } from "./ctx";
export type ContextType = Context; // backward compat alias
export type {Diesel}
// callback shape for listen(), fires once the server is up
export type listenCalllBackType = () => void;

// Shape of the "server" companion object passed alongside a request.
// Bun's own `Server` (from "bun") satisfies this structurally, as does
// any wrapper an adaptor (Node, Deno, ...) chooses to hand through.
// It's optional/absent under platforms like Cloudflare Workers.
export interface RuntimeServer {
    requestIP?(req: Request): { address: string; port?: number; family?: string } | null;
}

// what a route handler looks like, gets a Context and returns a response
export type handlerFunction = (ctx: Context) => Response | Promise<Response | undefined>;

// shape of app.get/post/etc, e.g. (path, ...handlers) => app
export type RouteHandler = (path: string, ...handlers: handlerFunction[] | middlewareFunc[]) => Diesel;


// what a middleware looks like, return a Response to short-circuit the request, or nothing to let it continue
export type middlewareFunc = (
    ctx: Context | Request | any,
    server: RuntimeServer
) => void | undefined | Response | Promise<undefined | void | Response>;

// what a lifecycle hook (onRequest/preHandler/onSend/onClose) looks like
export type HookFunction = (
    ctx: Context,
    result?: Response | null,
    server?: RuntimeServer
) => undefined | void | null | Response | Promise<void | null | undefined | Response>;

// what the function passed to app.routeNotFound() looks like
export type RouteNotFoundHandler = (
    ctx: Context
) => Response | void | undefined | Promise<Response>;

// http methods diesel understands, ANY/ALL are our own internal catch-alls, not real http verbs
export type HttpMethod =
    | "GET"
    | "POST"
    | "PUT"
    | "DELETE"
    | "PATCH"
    | "OPTIONS"
    | "HEAD"
    | "ANY"
    | "PROPFIND"
    | "ALL"

// method names as they appear as methods on the Diesel instance, e.g. app.get(), app.post()
export type HttpMethodOfApp =
    | 'get'
    | 'post'
    | 'put'
    | 'delete'
    | 'patch'
    | 'options'
    | 'head'
    | 'any'
    | 'propfind'


export type HttpMethodLower = Lowercase<HttpMethod>;

// the hook names you can pass to app.addHooks()
export type HookType =
    | "onRequest"
    | "preHandler"
    | "onSend"
    | "onError"
    | "onClose"

// shape of an onError hook, runs when a handler throws
export interface onError {
    (error: Error, path: string, req: Request):
        | void
        | null
        | Response
        | Promise<void | null | undefined | Response>;
}

// shape of an onRequest hook, runs before middlewares
export interface onRequest {
    (ctx: Context): void
}
// shape of an onSend hook, runs right before the response goes out
export interface onSend {
    (ctx: Context, finalResult: Response): Promise<Response | undefined>
}

// where all the registered hooks live on the app instance
export interface Hooks {
    onRequest: onRequest[] | null;
    preHandler: HookFunction[] | null;
    onSend: onSend[] | null;
    onError: onError[] | null;
    onClose: HookFunction[] | null;
}


// options you can pass to ctx.setCookie()
export interface CookieOptions {
    maxAge?: number;
    expires?: Date;
    path?: string;
    domain?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
}

// shape a matched route takes inside the router
export interface RouteHandlerT {
    method?: string;
    handler: handlerFunction
    isDynamic?: boolean;
    path?: string;
}

// how a route is remembered before route()/sub() copy it over to another router
export interface TempRouteEntry {
    method: string;
    handlers: handlerFunction[];
}

export type corsT = {
    origin?: string | string[] | null;
    methods?: string | string[] | null;
    allowedHeaders?: string | string[] | null;
    exposedHeaders?: string | string[] | null;
    credentials?: boolean | null;
    maxAge?: number;
    preflightContinue?: boolean;
    optionsSuccessStatus?: number;
} | null;


// args you can pass to listen(), just a port/callback or tls cert+key
export type listenArgsT = string | (() => void) | { cert?: string; key?: string };


// what parseBody() in ctx.ts returns, either the parsed body fields directly, or an error key if it couldn't parse
export interface ParseBodyResult {
    error?: string; // Optional error field
    data?: any; // The parsed data field

}

// lets us stash arbitrary stuff on the raw Request object where needed
declare global {
    interface Request {
        [key: string]: any;
    }
}


// unused for now, was meant to track which features an app actually uses so the pipeline can skip unused steps
export interface CompileConfig {
    hasMiddleware: boolean,
    hasOnReqHook: boolean,
    hasPreHandlerHook: boolean,
    hasOnError: boolean,
    hasOnSendHook: boolean
}

export type errorFormat = 'json' | 'text' | 'html' | string

// options you can pass to `new Diesel(options)`
export interface DieselOptions {
    baseApiUrl?: string;
    idleTimeOut?: number;
    prefixApiUrl?: string;
    pipelineArchitecture?: boolean;
    errorFormat?: errorFormat
    router?: string;
    routerInstance?: Router;
}


// what app.fetch / app.cfFetch() look like, pass this straight to your runtime's server
export type DieselFetchHandler = (
  req: Request,
  server?: RuntimeServer,
  env?: Record<string, any>,
  executionContext?: any
) => Promise<Response | undefined> | Response | undefined;