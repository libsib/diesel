import { Context } from "../../ctx.js";
import { getMimeType } from "../../utils/mimeType.js";

interface DenoNetAddr {
  transport: string;
  hostname: string;
  port: number;
}

export const connInfo = (c: Context) => {
  const server = c.server as unknown as { remoteAddr?: DenoNetAddr } | undefined;
  return server?.remoteAddr ?? null;
}

export const file = async (
  c: Context,
  filePath: string,
  mimeType?: string,
  status: number = 200,
  customHeaders?: Record<string, string>,
): Promise<Response> => {
  const fsFile = await Deno.open(filePath, { read: true });
  const contentType = mimeType ?? getMimeType(filePath);

  if (!c.headers) {
    const headers: Record<string, string> = { "Content-Type": contentType };
    if (customHeaders) {
      for (const k in customHeaders) headers[k] = customHeaders[k];
    }
    return new Response(fsFile.readable, { status, headers });
  }

  if (customHeaders) {
    for (const k in customHeaders) c.headers.set(k, customHeaders[k]);
  }
  if (!c.headers.has("Content-Type")) {
    c.headers.set("Content-Type", contentType);
  }

  return new Response(fsFile.readable, { status, headers: c.headers });
};
