import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import {app} from './server'
const port = process.env.PORT || 3000

let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  server = Bun.serve({ port, fetch: app.fetch() })
  console.log('Server running on '+port)
})
afterAll(async () => {
  server.stop(true)
  console.log("Server closed.");
});

const baseUrl = `http://localhost:${port}`

describe("GET /api/user/register", () => {
  it("should return a message", async () => {
    const response = await fetch(`${baseUrl}/api/user/register`);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.msg).toBe("This is a public route. No authentication needed.");
  });
  it("should return 404 for unsupported method on /api/user/register", async () => {
    const response = await fetch(`${baseUrl}/api/user/register`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });
  it("should return 404 for unsupported method on /api/user/register", async () => {
    const response = await fetch(`${baseUrl}/api/user/register`, {
      method: "PUT",
    });
    expect(response.status).toBe(404);
  });
  it("should return 404 for unsupported method on /api/user/register", async () => {
    const response = await fetch(`${baseUrl}/api/user/register`, {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
  });
  it("should return 200 again for supported method on /api/user/register", async () => {
    const response = await fetch(`${baseUrl}/api/user/register`, {
      method: "GET",
    });
    expect(response.status).toBe(200);
  });

  it("should set Content-Type to application/json for JSON responses", async () => {
    const response = await fetch(`${baseUrl}/api/user/register`);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
  
  
});

describe("GET /error", () => {
  it("should trigger onError hook", async () => {
    const response = await fetch(`${baseUrl}/error`);
    const data = await response.json();
    expect(response.status).toBe(500);
    expect(data.message).toBe("Something went wrong!");
  });
});

describe("GET /api/protected", () => {
  it("should return 401 when no cookie is provided", async () => {
    const response = await fetch(`${baseUrl}/api/protected`);
    const data = await response.json();
    expect(response.status).toBe(401);
    expect(data.message).toBe("Authentication token missing");
  });

  it("should return 200 if accesToken cookie is given", async () => {
    // Simulate sending a valid token
    const response = await fetch(`${baseUrl}/api/protected`, {
      headers: {
        Cookie: "accessToken=validToken",
      },
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.msg).toBe("Authenticated user");
  });
});

describe("CORS Testing", () => {
  it("should allow POST requests from allowed origin", async () => {
    const response = await fetch(`${baseUrl}/api/hello`, {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
      },
    });
    // console.log("Res of POST first testing: =>",await response.json())
    expect(response.status).toBe(200);
  });

  it("should allow requests from allowed origin", async () => {
    const response = await fetch(`${baseUrl}/api/hello`, {
      headers: {
        Origin: "http://localhost:3000",
      },
    });
    const data = await response.json();
    // console.log("DATA of 2nd",data)
    expect(response.status).toBe(200);
    expect(data.msg).toBe("Hello world!");
  });

  it("should deny requests from disallowed origin", async () => {
    const response = await fetch(`${baseUrl}/api/hello`, {
      headers: {
        Origin: "http://evil.com",
      },
    });
    // console.log('DENY 3rd',await response.json())
    expect(response.status).toBe(403);
  });
  it("should deny PUT requests from disallowed origin", async () => {
    const response = await fetch(`${baseUrl}/api/hello`, {
      method: "PUT",
      headers: {
        Origin: "http://evil.com",
      },
    });
    // console.log("DENY 4th",response.json())
    expect(response.status).toBe(403);
  });
});

describe("Testing Dynamic routes - /api/param/:id/:username", () => {
  it("it should return 404 as we have set route- /api/param/:id/:username", async () => {
    const response = await fetch(`${baseUrl}/api/param`);
    console.log('dynamic request response ',await response.json())
    expect(response.status).toBe(404);
  });

  it("it should return 404 as we have give only /id in param", async () => {
    const response = await fetch(`${baseUrl}/api/param/99`);
    expect(response.status).toBe(404);
  });
  it("it should return 200 as we have give only /id/username also in param", async () => {
    const response = await fetch(`${baseUrl}/api/param/99/pradeep`);
    expect(response.status).toBe(200);
  });
});

describe("Testing for Query Route", () => {
 
  it("should return 200 when name and age are provided as query parameters", async () => {
    const response = await fetch(`${baseUrl}/query?name=pradeep&age=23`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ name: "pradeep", age: "23" });
  });

  it("should return 200 when only name is provided as query parameter", async () => {
    const response = await fetch(`${baseUrl}/query?name=pradeep`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ name: "pradeep", age: undefined });
  });

  it("should return 200 when no query parameters are provided", async () => {
    const response = await fetch(baseUrl+"/query");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ name: undefined, age: undefined });
  });
});



describe("Testing for Body Route", () => {

  it("should return 200 and the request body when a valid JSON body is provided", async () => {
    const body = { name: "pradeep", age: 23 };
    const response = await fetch(`${baseUrl}/body`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(body);
  });

  it("should return 200 and an empty object when no body is provided", async () => {
    const response = await fetch(`${baseUrl}/body`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data).toEqual(null);
  });

  it("should return 400 when an invalid JSON body is provided", async () => {
    const response = await fetch(`${baseUrl}/body`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid-json",
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toEqual({ error: "Invalid request body format" });
  });

  it("should return 200 and the request body when a form-urlencoded body is provided", async () => {
    const body = new URLSearchParams({ name: "pradeep", age: "23" });
    const response = await fetch(`${baseUrl}/body`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ name: "pradeep", age: "23" });
  });

  it("should return 200 and the request body when a multipart/form-data body is provided", async () => {
    const formData = new FormData();
    formData.append("name", "pradeep");
    formData.append("age", "23");

    const response = await fetch(`${baseUrl}/body`, {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ name: "pradeep", age: "23" });
  });
});
