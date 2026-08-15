import { Context } from "../../ctx.js";

export const connInfo = (c: Context) => {
  return c.server?.requestIP?.(c.req) ?? null;
}

export const file = (
  c: Context,
  filePath: string,
  mimeType?: string,
  status: number = 200,
  customHeaders?: Record<string, string>,
): Response => {
  const bunFile = Bun.file(filePath);
  const contentType = mimeType ?? bunFile.type;

  if (!c.headers) {
    const headers: Record<string, string> = { "Content-Type": contentType };
    if (customHeaders) {
      for (const k in customHeaders) headers[k] = customHeaders[k];
    }
    return new Response(bunFile, { status, headers });
  }

  if (customHeaders) {
    for (const k in customHeaders) c.headers.set(k, customHeaders[k]);
  }
  if (!c.headers.has("Content-Type")) {
    c.headers.set("Content-Type", contentType);
  }

  return new Response(bunFile, { status, headers: c.headers });
};
