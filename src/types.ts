import { Router } from "./router/interface";
import Diesel from "./main";
import type { Context } from "./ctx";
export type ContextType = Context; // backward compat alias
export type {Diesel}
export type listenCalllBackType = () => void;

// Shape of the "server" companion object passed alongside a request.
// Bun's own `Server` (from "bun") satisfies this structurally, as does
// any wrapper an adaptor (Node, Deno, ...) chooses to hand through.
// It's optional/absent under platforms like Cloudflare Workers.
export interface RuntimeServer {
    requestIP?(req: Request): { address: string; port?: number; family?: string } | null;
}

export type handlerFunction = (ctx: Context) => Response | Promise<Response | undefined>;

export type RouteHandler = (path: string, ...handlers: handlerFunction[] | middlewareFunc[]) => Diesel;


export type middlewareFunc = (
    ctx: Context | Request | any,
    server: RuntimeServer
) => void | undefined | Response | Promise<undefined | void | Response>;

export type HookFunction = (
    ctx: Context,
    result?: Response | null,
    server?: RuntimeServer
) => undefined | void | null | Response | Promise<void | null | undefined | Response>;

export type RouteNotFoundHandler = (
    ctx: Context
) => Response | void | undefined | Promise<Response>;

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

export type HookType =
    | "onRequest"
    | "preHandler"
    | "postHandler"
    | "onSend"
    | "onError"
    | "onClose"

export interface onError {
    (error: Error, path: string, req: Request):
        | void
        | null
        | Response
        | Promise<void | null | undefined | Response>;
}

export interface onRequest {
    (ctx: Context): void
}
export interface onSend {
    (ctx: Context, finalResult: Response): Promise<Response | undefined>
}

export interface Hooks {
    onRequest: onRequest[] | null;
    preHandler: HookFunction[] | null;
    postHandler: HookFunction[] | null;
    onSend: onSend[] | null;
    onError: onError[] | null;
    onClose: HookFunction[] | null;
}


export interface CookieOptions {
    maxAge?: number;
    expires?: Date;
    path?: string;
    domain?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
}

export interface RouteHandlerT {
    method?: string;
    handler: handlerFunction
    isDynamic?: boolean;
    path?: string;
}

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


export type listenArgsT = string | (() => void) | { cert?: string; key?: string };


export interface ParseBodyResult {
    error?: string; // Optional error field
    data?: any; // The parsed data field

}

declare global {
    interface Request {
        [key: string]: any;
    }
}


export interface CompileConfig {
    hasMiddleware: boolean,
    hasOnReqHook: boolean,
    hasPreHandlerHook: boolean,
    hasOnError: boolean,
    hasPostHandlerHook: boolean,
    hasOnSendHook: boolean
}

export type errorFormat = 'json' | 'text' | 'html' | string

export interface DieselOptions {
    baseApiUrl?: string;
    idleTimeOut?: number;
    prefixApiUrl?: string;
    pipelineArchitecture?: boolean;
    errorFormat?: errorFormat
    router?: string;
    routerInstance?: Router;
}


export type DieselFetchHandler = (
  req: Request,
  server?: RuntimeServer,
  env?: Record<string, any>,
  executionContext?: any
) => Promise<Response | undefined> | Response | undefined;