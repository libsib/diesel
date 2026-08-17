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

export const authenticateJwt = (options:authenticateJwtT) => {
    if (!options.app) throw new Error("Diesel app is not defined, please provide app to authenticateJwt Function")
    if (!options.jwt) throw new Error("JWT library is not defined, please provide jwt to authenticateJwt Function")
    if (!options.jwtSecret) throw new Error("jwtSecret is required for authenticateJwt")

    const routes: undefined | string[] = options.routes
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
        if (!routes?.length || routes?.includes(ctx.url.pathname)) {
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

    const routes = options.routes
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

    return (ctx:ContextType) => {
        if (routes?.length === 0 || routes?.includes(ctx.url.pathname)) {
            return middleware(ctx);
         }
    }
}