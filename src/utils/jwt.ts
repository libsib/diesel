import { ContextType } from "../types";

function authenticateJwtMiddleware(jwt: any, user_jwt_secret: string) {
  if (!jwt) {
    throw new Error("JWT library is not defined, please provide jwt to authenticateJwt Function");
  }
  return (ctx: ContextType) => {
    try {
      let token = ctx.cookies?.accessToken ?? ctx.req?.headers?.get("Authorization");
      if (!token) {
        return ctx.json({ message: "Unauthorized", error: "No token provided" }, 401);
      }

      if (token.startsWith("Bearer ")) {
        token = token.slice(7);
      }
      const decoded = jwt?.verify(token, user_jwt_secret);
      if (!decoded) {
        return ctx.json({ message: "Unauthorized", error: "Token could not be decoded" }, 401);
      }

      ctx.set("user", decoded);
    } catch (error: any) {
      // console.error("JWT verification error:", error);
      let errMsg = "Invalid token";
      if (error.name === "TokenExpiredError") {
        errMsg = "Token expired";
      } else if (error.name === "JsonWebTokenError") {
        errMsg = "Malformed or tampered token";
      }

      return ctx.json({ message: "Unauthorized", error: errMsg }, 401);
    }
  };
}

function authenticateJwtDbMiddleware(jwt: any, User: any, user_jwt_secret: string) {
  if (!jwt) {
    throw new Error("JWT library is not defined, please provide jwt to authenticateJwtDB Function");
  }
  if (!User) {
    throw new Error("User model is not defined, please provide UserModel to authenticateJwtDB Function")
  }
  return async (ctx: ContextType) => {
    try {
      let token = ctx.cookies?.accessToken ?? ctx.req?.headers?.get("Authorization");

      if (!token) {
        return ctx.json({ message: "Unauthorized", error: "No token provided" }, 401);
      }


      if (token.startsWith("Bearer ")) {
        token = token.slice(7);
      }

      const decodedToken = jwt?.verify(token, user_jwt_secret);

      if (!decodedToken) {
        return ctx.json({ message: "Unauthorized", error: "Token could not be decoded" }, 401);
      }

      const user = await User.findById(decodedToken._id).select("-password -refreshToken");

      if (!user) {
        return ctx.json({ message: "Unauthorized: User not found" }, 404);
      }

      ctx.set("user", user);
      return;
    } catch (error: any) {
      // console.error("JWT verification error:", error);
      let errMsg = "Invalid token";
      if (error.name === "TokenExpiredError") {
        errMsg = "Token expired";
      } else if (error.name === "JsonWebTokenError") {
        errMsg = "Malformed or tampered token";
      }

      return ctx.json({ message: "Unauthorized", error: errMsg }, 401);
    }
  };
}

export { authenticateJwtMiddleware, authenticateJwtDbMiddleware };
