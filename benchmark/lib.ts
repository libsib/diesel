import Diesel from "../src/main";
import { Hono } from "hono";

const ITERATIONS = 500_000;
const WARMUP = 20_000;
const ROUTE_COUNT = 5000;
const MIDDLEWARE_COUNT = 3;

const staticResponse = new Response("hello world");

// --------------------------------------------------
// Diesel Setup
// --------------------------------------------------

const diesel = new Diesel();

// global middlewares
for (let i = 0; i < MIDDLEWARE_COUNT; i++) {
  diesel.use(async (ctx: any) => {
    ctx.set("mw" + i, true);
  });
}

// create thousands of routes
for (let i = 0; i < ROUTE_COUNT; i++) {
  diesel.get(`/api/user/${i}/profile`, async (ctx: any) => {
    return staticResponse;
  });
}

// dynamic routes
for (let i = 0; i < ROUTE_COUNT; i++) {
  diesel.get(`/api/post/${i}/:id`, async (ctx: any) => {
    return staticResponse;
  });
}

const dieselFetch = diesel.fetch;

// choose a mid-tree route
const dieselReq = new Request("http://localhost:3000/api/user/2500/profile");

// --------------------------------------------------
// Hono Setup
// --------------------------------------------------

const hono = new Hono();

// middlewares
for (let i = 0; i < MIDDLEWARE_COUNT; i++) {
  hono.use("*", async (c, next) => {
    c.set("mw" + i, true);
    await next();
  });
}

// thousands of routes
for (let i = 0; i < ROUTE_COUNT; i++) {
  hono.get(`/api/user/${i}/profile`, async (c) => {
    return staticResponse;
  });
}

// dynamic routes
for (let i = 0; i < ROUTE_COUNT; i++) {
  hono.get(`/api/post/${i}/:id`, async (c) => {
    return staticResponse;
  });
}

const honoFetch = hono.fetch;
const honoReq = new Request("http://localhost:3000/api/user/2500/profile");

// --------------------------------------------------
// Warmup
// --------------------------------------------------

console.log("Warming up...");

for (let i = 0; i < WARMUP; i++) {
  await dieselFetch(dieselReq, null as any, {}, {});
}

for (let i = 0; i < WARMUP; i++) {
  await honoFetch(honoReq);
}

// --------------------------------------------------
// Diesel Benchmark
// --------------------------------------------------

console.log("Running Diesel...");

let start = performance.now();

for (let i = 0; i < ITERATIONS; i++) {
  await dieselFetch(dieselReq, null as any, {}, {});
}

let end = performance.now();
const dieselTime = end - start;
const dieselOps = (ITERATIONS / dieselTime) * 1000;

console.log("Diesel Time:", dieselTime.toFixed(2), "ms");
console.log("Diesel Ops/sec:", dieselOps.toFixed(0));

// --------------------------------------------------
// Hono Benchmark
// --------------------------------------------------

console.log("Running Hono...");

start = performance.now();

for (let i = 0; i < ITERATIONS; i++) {
  await honoFetch(honoReq);
}

end = performance.now();
const honoTime = end - start;
const honoOps = (ITERATIONS / honoTime) * 1000;

console.log("Hono Time:", honoTime.toFixed(2), "ms");
console.log("Hono Ops/sec:", honoOps.toFixed(0));

// --------------------------------------------------

console.log("--------------------------------------------------");

if (dieselOps > honoOps) {
  console.log(
    "Diesel is faster by",
    ((dieselOps / honoOps - 1) * 100).toFixed(2),
    "%"
  );
} else {
  console.log(
    "Hono is faster by",
    ((honoOps / dieselOps - 1) * 100).toFixed(2),
    "%"
  );
}