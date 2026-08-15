import { Context } from "../../ctx.js";

export const connInfo = (c: Context): string | null => {
  return c.req.headers.get('CF-Connecting-IP');
}
