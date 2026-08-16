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

const typeMap: any = {
  string: "text/plain; charset=utf-8",
  object: "application/json; charset=utf-8",
  Uint8Array: "application/octet-stream",
  ArrayBuffer: "application/octet-stream",
};

const TEXT_PLAIN_CT = "text/plain; charset=utf-8";
// Shared init objects — Response constructor copies headers internally, safe to reuse
const _TEXT_INIT: ResponseInit = { headers: { "Content-Type": TEXT_PLAIN_CT } };
const _TEXT_INIT_WITH_STATUS = (status: number): ResponseInit => ({
  status,
  headers: { "Content-Type": TEXT_PLAIN_CT },
});

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
  setHeader(key: string, value: string): this {
    if (!this.headers) this.headers = new Headers();
    this.headers.set(key, value);
    return this;
  }

  removeHeader(key: string): this {
    if (this.headers) this.headers.delete(key);
    return this;
  }

  set<T>(key: string, value: T): this {
    if (this.contextData === EMPTY_OBJ) this.contextData = {};
    this.contextData[key] = value;
    return this;
  }

  get<T>(key: string): T | undefined {
    if (this.contextData === EMPTY_OBJ) return undefined;
    return this.contextData[key];
  }

  // Removed for now — real client IP resolution is runtime-specific
  // (Bun's server.requestIP(), Deno's connInfo.remoteAddr, Node's
  // req.socket.remoteAddress, Cloudflare's CF-Connecting-IP header) and
  // guessing at it here was dishonest. Use a per-runtime adaptor helper
  // (e.g. `diesel-core/bun`, `diesel-core/deno`) that takes ctx.req /
  // ctx.server and returns the real IP once those adaptors exist.
  //
  // get ip(): string | null {
  //   if (typeof this.server?.requestIP === "function") {
  //     return this.server.requestIP(this.req)?.address ?? null;
  //   }
  //   return (
  //     this.req.headers.get("CF-Connecting-IP") ||
  //     this.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  //     null
  //   );
  // }

  get url(): URL {
    if (!this.urlObject) {
      this.urlObject = new URL(this.req.url);
    }
    return this.urlObject;
  }

  get query(): Record<string, string> {
    if (!this.parsedQuery) {
      this.parsedQuery = this.url.search
        ? Object.fromEntries(this.url.searchParams)
        : EMPTY_OBJ;
    }
    return this.parsedQuery;
  }

  get params(): Record<string, string> {
    return this.#param ?? EMPTY_OBJ;
  }

  set params(v: Record<string, string>) {
    this.#param = v;
  }

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

  redirect(path: string, status: number = 302): Response {
    if (!this.headers) this.headers = new Headers();
    this.headers.set("Location", path);
    return new Response(null, { status, headers: this.headers });
  }

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

  get cookies(): Record<string, string> {
    if (!this.parsedCookies) {
      const cookieHeader = this.req.headers.get("cookie");
      this.parsedCookies = cookieHeader ? parseCookie(cookieHeader) : EMPTY_OBJ;
    }
    return this.parsedCookies;
  }

  // Streams
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

function applyCustomHeaders(
  headers: Headers,
  customHeaders: Record<string, string>,
): void {
  for (const k in customHeaders) {
    headers.set(k, customHeaders[k]);
  }
}

function copyHeadersToObject(
  customHeaders: Record<string, string>,
  obj: Record<string, string>,
): void {
  for (const k in customHeaders) {
    obj[k] = customHeaders[k];
  }
}

function parseCookie(cookieHeader: string): Record<string, string> {
  return Object.fromEntries(
    cookieHeader.split(";").map((cookie) => {
      const [name, ...valueParts] = cookie.trim().split("=");
      return [name, decodeURIComponent(valueParts.join("="))];
    }),
  );
}

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

