/**
 * @module
 * Powered By Middleware for Diesel.
 */

import { ContextType, middlewareFunc } from "../../types"

type PoweredByOptions = {
  /**
   * The value for X-Powered-By header.
   * @default Diesel
   */
  serverName?: string
}

/**
 * Powered By Middleware for Diesel.
 *
 * @param options - The options for the Powered By Middleware.
 * @returns {MiddlewareHandler} The middleware handler function.
 *
 * @example
 * ```ts
 * import { poweredBy } from 'diesel-core/powered-by'
 *
 * const app = new Diesel()
 *
 * app.use(poweredBy()) // With options: poweredBy({ serverName: "My Server" })
 * ```
 */
export const poweredBy = (options?: PoweredByOptions): middlewareFunc => {
  return async function poweredBy(ctx: ContextType) {
    ctx.setHeader('X-Powered-By', options?.serverName ?? 'Diesel')
  }
}