import Diesel from "../../src/main";
import jwt from 'jsonwebtoken'
import type { ContextType } from "../../src/types";
import type { CookieOptions } from "diesel-core";
import type { BunRequest } from "bun";
import { authenticateJwt } from "../../src/middlewares/jwt";

const app = new Diesel()
const SECRET_KEY = "linux";



app.BunRoute("GET","/cookie", (req: BunRequest) => {
    const accessToken = jwt.sign({ userId: "123" }, SECRET_KEY, { expiresIn: '15m' });
    const refreshToken = jwt.sign({ userId: "123" }, SECRET_KEY, { expiresIn: '7d' });
    const cookies = req.cookies
    // Set cookies
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60, 
    };

    // ctx.setCookie('accessToken', accessToken, cookieOptions);
    // ctx.setCookie('refreshToken', refreshToken, cookieOptions);
    cookies.set('accessToken', accessToken, cookieOptions);
    cookies.set('refreshToken', refreshToken, cookieOptions);

    return Response.json({ message: "Cookies set successfully" });
  });

app.BunRoute('GET','/',async (req:Request)=>{
  const cookies = req.cookies
   return Response.json({
    msg:"hello world",
    cookies
   })
})



app.listen(3000)