import type { ContextType, middlewareFunc, RuntimeServer } from "../../types.js";

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
/**
 * Collapses duplicate slashes and strips the trailing slash, so `//admin`
 * and `/admin/` are classified the same as `/admin`. Root stays `/`.
 */
const normalizePath = (path: string): string => {
  let p = path.replace(/\/{2,}/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
};

/**
 * Segment-aware prefix match: `/api` matches `/api` and `/api/x`,
 * but not `/api-admin`. Root `/` only matches `/` itself.
 */
const isPublic = (pathname: string, route: string): boolean => {
  if (pathname === route) return true;
  if (route === "/") return false;
  return pathname.startsWith(route + "/");
};

export const filter = (options: FilterOptions): middlewareFunc => {
  const publicRoutes = new Set<string>();
  for (const route of options.publicRoutes ?? []) {
    publicRoutes.add(normalizePath(route));
  }
  const authenticate = options.authenticate ?? [];

  return (async (ctx: ContextType, server: RuntimeServer) => {
    const pathname = normalizePath(ctx.path ?? "/");
    for (const route of publicRoutes) {
      if (isPublic(pathname, route)) return;
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
