import { Context } from "../../ctx";

type Props = {
  maxSize: number;
  message?: string;
};

/**
 * Rejects requests whose declared `Content-Length` exceeds `maxSize`,
 * before the body is ever read. Note this only checks the header — a
 * chunked request with no `Content-Length`, or one that lies about its
 * size, isn't caught here; that requires enforcing the limit while the
 * body stream is actually read.
 */
export const bodyLimit = ({ maxSize, message = "Request body too large" }: Props) => {
  if(!maxSize) throw new Error("Please Provide maxSize for the body limit Middleware.")
  return (ctx: Context): Response | undefined => {
    const contentLength = ctx.req.headers.get("Content-Length");
    if (contentLength && Number(contentLength) > maxSize) {
      return ctx.json({ error: message }, 413);
    }
  };
};
