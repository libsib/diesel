import Diesel from "../../main";
import { ContextType } from "../../types";
import { authenticateJwtDbMiddleware, authenticateJwtMiddleware } from "../../utils/jwt";

export { authenticateJwtMiddleware, authenticateJwtDbMiddleware };

type authenticateJwtT = {
    app:Diesel,
    jwt:any,
    jwtSecret:string,
    routes?:string[]
}

type authenticateJwtDBT = {
    app:Diesel,
    userModel:any,
    jwt:any,
    jwtSecret:string,
    routes?:string[]
}

// collapse duplicate slashes and drop the trailing one (except root), so
// `/admin/` and `//admin` match a protected `/admin` like the router does
const normalizePath = (path: string): string => {
    const p = path.replace(/\/{2,}/g, "/")
    return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p
}

export const authenticateJwt = (options:authenticateJwtT) => {
    if (!options.app) throw new Error("Diesel app is not defined, please provide app to authenticateJwt Function")
    if (!options.jwt) throw new Error("JWT library is not defined, please provide jwt to authenticateJwt Function")
    if (!options.jwtSecret) throw new Error("jwtSecret is required for authenticateJwt")

    const routes: undefined | string[] = options.routes?.map(normalizePath)
    const jwt = options.jwt
    const jwtSecret = options.jwtSecret

    const middleware = authenticateJwtMiddleware(jwt, jwtSecret);

    // if (!routes || routes.length === 0) {
    //     app.use("/", middleware)
    //     return;
    // }
    // else{
    //     for (const path of routes) {
    //         app.use(path, middleware)
    //     }
    // }
    return (ctx:ContextType) => {
        // console.log(routes?.length)
        // ctx.path is the decoded path the router matched on, url.pathname isn't
        if (!routes?.length || routes.includes(normalizePath(ctx.path ?? ctx.url.pathname))) {
          return middleware(ctx);
        }
    }
}

export const authenticateJwtDB = (options:authenticateJwtDBT) => {
    if (!options.app)
        throw new Error("Diesel app is not defined, please provide app to authenticateJwt Function")

    if (!options.userModel)
        throw new Error("User model is not defined, please provide userModel to authenticateJwt Function")

    if (!options.jwt)
        throw new Error("JWT library is not defined, please provide jwt to authenticateJwt Function")

    if (!options.jwtSecret) throw new Error("jwtSecret is required for authenticateJwtDB")

    const routes = options.routes?.map(normalizePath)
    const jwt = options.jwt
    const jwtSecret = options.jwtSecret
    const userModel = options.userModel

    const middleware = authenticateJwtDbMiddleware(jwt, userModel, jwtSecret);

    // if (!routes || routes.length === 0) {
    //     app.use("/", authenticateJwtDbMiddleware(jwt, userModel, jwtSecret))
    //     return;
    // }

    // for (const path of routes) {
    //     app.use(path, authenticateJwtDbMiddleware(jwt, userModel, jwtSecret))
    // }

    // async so the pipeline (pipelineArchitecture: true) awaits it
    return async (ctx:ContextType) => {
        if (!routes?.length || routes.includes(normalizePath(ctx.path ?? ctx.url.pathname))) {
            return middleware(ctx);
         }
    }
}