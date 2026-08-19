import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import type { CookieOptions, ParseBodyResult, RuntimeServer } from "./types";
import { getMimeType } from "./utils/mimeType";
import { EMPTY_OBJ } from "./constant";

// let ejsInstance: any = null;

// async function getEjs() {
//   if (!ejsInstance) {
//     const mod = await import("ejs");
//     ejsInstance = mod.default || mod;
//   }
//   return ejsInstance;
// }

const TEXT_PLAIN_CT = "text/plain; charset=utf-8";
// Shared init objects — Response constructor copies headers internally, safe to reuse
const _TEXT_INIT: ResponseInit = { headers: { "Content-Type": TEXT_PLAIN_CT } };
const _TEXT_INIT_WITH_STATUS = (status: number): ResponseInit => ({
  status,
  headers: { "Content-Type": TEXT_PLAIN_CT },
});

// One Context object gets made per request. It wraps the raw Request
// and gives you helpers to read stuff (query, params, cookies, body)
// and send stuff back (text, json, file, redirect, etc).
export class Context {
  req: Request;
  server?: RuntimeServer;
  path: string | null;
  #param: Record<string, string> | undefined;
  env?: Record<string, any>;
  executionContext?: any;
  headers?: Headers;

  // Lazily initialized
  private parsedQuery: Record<string, string> | null = null;
  private parsedCookies: Record<string, string> | null = null;
  private parsedBody: Promise<any> | null = null;
  private contextData: Record<string, any> = EMPTY_OBJ;
  private urlObject: URL | null = null;

  /**
   * Made once per incoming request, framework does this for you, you
   * don't need to call `new Context()` yourself.
   *
   * @param req - the raw request coming in
   * @param server - runtime server instance (bun/node/etc), optional
   * @param path - matched route path, null if nothing matched
   * @param param - route params, like `:id` in `/user/:id`
   * @param env - env vars / bindings (used on runtimes like cloudflare)
   * @param executionContext - runtime specific execution context (e.g. cloudflare workers)
   */
  constructor(
    req: Request,
    server: RuntimeServer | undefined,
    path: string | null,
    param: Record<string, string> | undefined,
    env: Record<string, any> | undefined,
    executionContext: any | undefined,
  ) {
    this.req = req;
    this.server = server;
    this.path = path;
    this.#param = param;
    this.env = env;
    this.executionContext = executionContext;
  }

  // Methods

  /**
   * Sets a header on the response. Chainable, so you can call
   * `.setHeader().setHeader()` back to back.
   *
   * @param key - header name, e.g. "X-Custom"
   * @param value - header value
   * @returns this, so you can chain more calls
   */
  setHeader(key: string, value: string): this {
    if (!this.headers) this.headers = new Headers();
    this.headers.set(key, value);
    return this;
  }

  /**
   * Removes a header you set earlier. Does nothing if no headers
   * were ever set (nothing to remove from).
   *
   * @param key - header name to remove
   * @returns this, so you can chain more calls
   */
  removeHeader(key: string): this {
    if (this.headers) this.headers.delete(key);
    return this;
  }

  /**
   * Stores your own data on the context, for this request only. Useful
   * for passing stuff between middlewares, like `ctx.set("user", user)`
   * in an auth middleware, then reading it later in the route handler.
   *
   * @param key - name for the data
   * @param value - whatever you want to store
   * @returns this, so you can chain more calls
   */
  set<T>(key: string, value: T): this {
    if (this.contextData === EMPTY_OBJ) this.contextData = {};
    this.contextData[key] = value;
    return this;
  }

  /**
   * Reads back data you stored earlier with `set()`. Returns undefined
   * if nothing was ever set for that key.
   *
   * @param key - name you used in set()
   * @returns the stored value, or undefined
   */
  get<T>(key: string): T | undefined {
    if (this.contextData === EMPTY_OBJ) return undefined;
    return this.contextData[key];
  }

  /**
   * Gives you the request url as a proper URL object. Only built the
   * first time you access it, then reused for the rest of the request.
   */
  get url(): URL {
    if (!this.urlObject) {
      this.urlObject = new URL(this.req.url);
    }
    return this.urlObject;
  }

  /**
   * Query string params as a plain object, e.g. `?page=2` becomes
   * `{ page: "2" }`. Parsed once and cached, empty object if there's
   * no query string.
   */
  get query(): Record<string, string> {
    if (!this.parsedQuery) {
      this.parsedQuery = this.url.search
        ? Object.fromEntries(this.url.searchParams)
        : EMPTY_OBJ;
    }
    return this.parsedQuery;
  }

  /**
   * Route params matched from the path, e.g. route `/user/:id` hit
   * with `/user/5` gives `{ id: "5" }`. Empty object if the route has
   * no params.
   */
  get params(): Record<string, string> {
    return this.#param ?? EMPTY_OBJ;
  }

  /** Lets the router overwrite the params after the context is made. */
  set params(v: Record<string, string>) {
    this.#param = v;
  }

  /**
   * Parses and gives you the request body. Figures out json, form
   * urlencoded, or multipart automatically from the Content-Type
   * header. GET requests just get an empty object, no parsing done.
   * Parsed once, so calling `await ctx.body` twice is fine and cheap.
   */
  get body(): Promise<any> {
    if (this.req.method === "GET") {
      return Promise.resolve(EMPTY_OBJ);
    }

    if (!this.parsedBody) {
      this.parsedBody = (async () => {
        try {
          const result = await parseBody(this.req);
          if (result.error) {
            throw new Error(result.error);
          }
          return Object.keys(result).length === 0 ? null : result;
        } catch (error) {
          throw new Error("Invalid request body format");
          // const message = error instanceof Error ? error.message : String(error);
          // throw new Error(`Failed to parse request body: ${message}`);
        }
      })();
    }
    return this.parsedBody;
  }

  /**
   * Sends back a plain text response. On HEAD requests the body is
   * dropped automatically, only headers go out.
   *
   * @param data - the text to send
   * @param status - http status code, defaults to 200
   * @param customHeaders - extra headers to add on top of Content-Type
   * @returns the Response object
   */
  text(
    data: string,
    status: number = 200,
    customHeaders?: Record<string, string>,
  ): Response {
    if (!this.headers) {
      if (!customHeaders) {
        return new Response(data, status === 200 ? _TEXT_INIT : _TEXT_INIT_WITH_STATUS(status));
      }
      const h: Record<string, string> = { "Content-Type": TEXT_PLAIN_CT };
      copyHeadersToObject(customHeaders, h);
      return new Response(data, { status, headers: h });
    }

    // slow path , actually not slow , it's normal
    if (customHeaders) applyCustomHeaders(this.headers, customHeaders);

    if (!this.headers?.has("Content-Type")) {
      this.headers?.set("Content-Type", TEXT_PLAIN_CT);
    }

    return new Response(data, { status, headers: this.headers });
  }

  /**
   * Sends back whatever you give it, and picks the right Content-Type
   * on its own: bytes -> octet-stream, objects -> json, strings ->
   * plain text, anything else gets stringified as text. Use this when
   * you don't want to think about which response type to call.
   *
   * @param data - the response body, any type
   * @param status - http status code, defaults to 200
   * @param customHeaders - extra headers to add on top of Content-Type
   * @returns the Response object
   */
  send<T>(
    data: T,
    status: number = 200,
    customHeaders?: Record<string, string>,
  ): Response {
    let contentType: string;
    let responseData: any;

    if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
      contentType = "application/octet-stream";
      responseData = data;
    } else if (data !== null && typeof data === "object") {
      contentType = "application/json; charset=utf-8";
      responseData = JSON.stringify(data);
    } else if (typeof data === "string") {
      contentType = "text/plain; charset=utf-8";
      responseData = data;
    } else {
      contentType = "text/plain; charset=utf-8";
      responseData = String(data);
    }
    if (!this.headers) {
      if (!customHeaders) {
        return new Response(responseData, {
          status,
          headers: { "Content-Type": contentType },
        });
      }

      const h: Record<string, string> = {
        "Content-Type": contentType,
      };
      copyHeadersToObject(customHeaders, h);

      return new Response(responseData, { status, headers: h });
    }

    if (customHeaders) applyCustomHeaders(this.headers, customHeaders);

    if (!this.headers.has("Content-Type")) {
      this.headers.set("Content-Type", contentType);
    }

    return new Response(responseData, { status, headers: this.headers });
  }

  /**
   * Sends back a json response, stringifies the object for you and
   * sets Content-Type to application/json.
   *
   * @param object - anything json-serializable
   * @param status - http status code, defaults to 200
   * @param customHeaders - extra headers to add on top of Content-Type
   * @returns the Response object
   */
  json<T>(
    object: T,
    status: number = 200,
    customHeaders?: Record<string, string>,
  ): Response {

    if (!this.headers) {
      if (!customHeaders) {
        // Response.json() sets Content-Type automatically; skip options entirely when status=200
        return status === 200
          ? Response.json(object)
          : Response.json(object, { status });
      }

      const h: Record<string, string> = {
        "Content-Type": "application/json; charset=utf-8",
      };
      copyHeadersToObject(customHeaders, h);
      return Response.json(object, { status, headers: h });
    }

    // slow path
    if (customHeaders) applyCustomHeaders(this.headers, customHeaders);

    if (!this.headers.has("Content-Type")) {
      this.headers.set("Content-Type", "application/json; charset=utf-8");
    }

    return new Response(JSON.stringify(object), {
      status,
      headers: this.headers,
    });
  }

  /**
   * Sends a file back as the response, streams it off disk instead of
   * loading the whole thing into memory. Mime type gets guessed from
   * the file extension if you don't pass one.
   *
   * @param filePath - path to the file on disk
   * @param mimeType - Content-Type to use, guessed from filePath if not given
   * @param status - http status code, defaults to 200
   * @param customHeaders - extra headers to add on top of Content-Type
   * @returns the Response object
   */
  file(
    filePath: string,
    mimeType?: string,
    status: number = 200,
    customHeaders?: Record<string, string>,
  ): Response {
    const isHead = this.req.method === "HEAD";
    const file = isHead
      ? null
      : (Readable.toWeb(createReadStream(filePath)) as ReadableStream);

    if (!this.headers) {
      if (!customHeaders) {
        return new Response(file, {
          status,
          headers: {
            "Content-Type": mimeType ?? getMimeType(filePath),
          },
        });
      }

      const h: Record<string, string> = {
        "Content-Type": mimeType ?? getMimeType(filePath),
      };
      copyHeadersToObject(customHeaders, h);
      return new Response(file, {
        status,
        headers: h,
      });
    }

    if (customHeaders) applyCustomHeaders(this.headers, customHeaders);

    if (!this.headers.has("Content-Type")) {
      this.headers.set("Content-Type", mimeType ?? getMimeType(filePath));
    }

    return new Response(file, { status, headers: this.headers });
  }

  /**
   * Disabled for now, was meant to render an ejs template and send it
   * back as html. Left here so we don't lose the shape of it.
   *
   * @param viewPath - path to the ejs template
   * @param data - variables to pass into the template
   * @param status - http status code, defaults to 200
   */
  async ejs(viewPath: string, data = {}, status: number = 200): Promise<void> {
    console.log("this method is diabled now for some time");
    // this.status = status;
    // const ejs = await getEjs();
    // try {
    //   const template = await Bun.file(viewPath).text()
    //   const rendered = ejs.render(template, data)
    //   const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
    //   return new Response(rendered, { status, headers });
    // } catch (error) {
    //   console.error("EJS Rendering Error:", error);
    //   return new Response("Error rendering template", { status: 500 });
    // }
  }

  /**
   * Redirects the client to another path, just sets the Location
   * header and sends an empty body.
   *
   * @param path - where to redirect to
   * @param status - redirect status code, defaults to 302
   * @returns the Response object
   */
  redirect(path: string, status: number = 302): Response {
    if (!this.headers) this.headers = new Headers();
    this.headers.set("Location", path);
    return new Response(null, { status, headers: this.headers });
  }

  /**
   * Adds a Set-Cookie header to the response. Can be called more than
   * once to set multiple cookies, each call appends, doesn't overwrite.
   *
   * @param name - cookie name
   * @param value - cookie value, gets url-encoded for you
   * @param options - maxAge, expires, path, domain, secure, httpOnly, sameSite
   * @returns this, so you can chain more calls
   */
  setCookie(name: string, value: string, options: CookieOptions = {}): this {
    if (!this.headers) this.headers = new Headers();
    let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(
      value,
    )}`;

    if (options.maxAge) cookieString += `; Max-Age=${options.maxAge}`;
    if (options.expires)
      cookieString += `; Expires=${options.expires.toUTCString()}`;
    if (options.path) cookieString += `; Path=${options.path}`;
    if (options.domain) cookieString += `; Domain=${options.domain}`;
    if (options.secure) cookieString += `; Secure`;
    if (options.httpOnly) cookieString += `; HttpOnly`;
    if (options.sameSite) cookieString += `; SameSite=${options.sameSite}`;

    this.headers.append("Set-Cookie", cookieString);

    return this;
  }

  /**
   * Cookies sent by the client, parsed from the cookie header into a
   * plain object. Parsed once and cached, empty object if no cookies.
   */
  get cookies(): Record<string, string> {
    if (!this.parsedCookies) {
      const cookieHeader = this.req.headers.get("cookie");
      this.parsedCookies = cookieHeader ? parseCookie(cookieHeader) : EMPTY_OBJ;
    }
    return this.parsedCookies;
  }

  // Streams

  /**
   * Sends back a streaming response. You get a controller in the
   * callback, push chunks into it with `controller.enqueue(...)`, it
   * gets closed for you automatically once the callback finishes.
   *
   * @param callback - runs with the stream controller, push your data here
   * @returns the Response object
   */
  stream(
    callback: (controller: ReadableStreamDefaultController) => void,
  ): Response {
    const headers = new Headers(this.headers ?? new Headers());
    const isHead = this.req.method === "HEAD";
    if (isHead) {
      return new Response(null,{headers})
    }
    const stream = new ReadableStream({
      async start(controller) {
        await callback(controller);
        controller.close();
      },
    });
    return new Response(stream, { headers });
  }

  /**
   * Not implemented yet, always sends back an empty response right
   * now. Meant to stream from an async generator eventually.
   *
   * @param callback - would return an async generator to stream from
   */
  yieldStream(callback: () => AsyncIterable<any>): Response {
    return new Response();
    // {
    //   async *[Symbol.asyncIterator]() {
    //     yield* callback();
    //   },
    // },
    // { headers: this.headers }
  }
}

// function parseCookie(cookieHeader: string | undefined): Record<string, string> {
//   const cookies: Record<string, string> = {};

//   const cookiesArray = cookieHeader?.split(";")!;

//   for (let i = 0; i < cookiesArray?.length!; i++) {
//     const [cookieName, ...cookieValeParts] = cookiesArray[i].trim().split("=");
//     const cookieVale = cookieValeParts?.join("=").trim();
//     if (cookieName) {
//       cookies[cookieName.trim()] = decodeURIComponent(cookieVale);
//     }
//   }

//   return cookies;
// }

/**
 * Copies customHeaders onto an existing Headers object, used when
 * `this.headers` already exists on the context.
 *
 * @param headers - the Headers object to write into
 * @param customHeaders - key/value pairs to copy over
 */
function applyCustomHeaders(
  headers: Headers,
  customHeaders: Record<string, string>,
): void {
  for (const k in customHeaders) {
    headers.set(k, customHeaders[k]);
  }
}

/**
 * Copies customHeaders into a plain object, used when `this.headers`
 * doesn't exist yet so we don't need to bother making a Headers object.
 *
 * @param customHeaders - key/value pairs to copy from
 * @param obj - the plain object to write into
 */
function copyHeadersToObject(
  customHeaders: Record<string, string>,
  obj: Record<string, string>,
): void {
  for (const k in customHeaders) {
    obj[k] = customHeaders[k];
  }
}

/**
 * Turns a raw cookie header string like "a=1; b=2" into
 * `{ a: "1", b: "2" }`.
 *
 * @param cookieHeader - the raw "cookie" header value
 * @returns cookies as a plain object
 */
function parseCookie(cookieHeader: string): Record<string, string> {
  return Object.fromEntries(
    cookieHeader.split(";").map((cookie) => {
      const [name, ...valueParts] = cookie.trim().split("=");
      return [name, decodeURIComponent(valueParts.join("="))];
    }),
  );
}

/**
 * Reads and parses the request body based on the Content-Type header.
 * Handles json, x-www-form-urlencoded and multipart/form-data. Returns
 * `{}` if there's no content type or no body, and `{ error: ... }` if
 * the content type isn't one we handle.
 *
 * @param req - the raw request to read the body from
 * @returns the parsed body, or an object with an `error` key
 */
async function parseBody(req: Request): Promise<ParseBodyResult> {
  const contentType: string = req.headers.get("Content-Type") || "";
  if (!contentType) return {};

  if (!req.body) {
    return {};
  }

  if (contentType.startsWith("application/json")) {
    try {
      return await req.json();
    } catch (error) {
      throw new Error("Invalid request body format");
    }
  }

  if (contentType.startsWith("application/x-www-form-urlencoded")) {
    const body = await req.text();
    return Object.fromEntries(new URLSearchParams(body));
  }

  if (contentType.startsWith("multipart/form-data")) {
    const formData: any = await req.formData();
    const obj: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      obj[key] = value;
    }
    return obj;
  }

  return { error: "Unknown request body type" };
}

