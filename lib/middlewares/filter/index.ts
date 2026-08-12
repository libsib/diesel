import type { ContextType, middlewareFunc } from "../../types.js";
import type { Server } from "bun";

export interface FilterOptions {
  publicRoutes?: string[];
  authenticate: (Function | middlewareFunc)[];
}

/**
 * Route filter middleware for Diesel.
 *
 * Routes listed in `publicRoutes` skip `authenticate`; everything else
 * runs through the given `authenticate` middlewares in order.
 *
 * @example
 * ```ts
 * import { filter } from "diesel-core/filter";
 *
 * app.use(filter({
 *   publicRoutes: ["/api/user/register", "/api/user/login"],
 *   authenticate: [authJwt],
 * }));
 * ```
 */
export const filter = (options: FilterOptions): middlewareFunc => {
  const publicRoutes = new Set<string>();
  for (let route of options.publicRoutes ?? []) {
    if (route.endsWith("/")) route = route.slice(0, -1);
    publicRoutes.add(route);
  }
  const authenticate = options.authenticate ?? [];

  return (async (ctx: ContextType, server: Server) => {
    const pathname = ctx.path!;
    for (const route of publicRoutes) {
      if (pathname.startsWith(route)) return;
    }

    if (!authenticate.length) {
      return Response.json(
        { error: "Protected route, authentication required" },
        { status: 401 },
      );
    }

    for (const fn of authenticate) {
      const resp = await fn(ctx, server);
      if (resp) return resp;
    }
  }) as middlewareFunc;
};
