// bench.ts
import Diesel  from "../src/main.ts"; // adjust imports if needed
import { Hono } from "hono";
import { performance } from "perf_hooks";
import express from "express";
import http from "http";

// --- Utility: simulate async work ---
function simulateWork(ms: number = 1) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// --- Diesel App ---
const dieselApp = new Diesel({ router: "t2" })
  .use(async (c) => {
    // simulate middleware work
    await simulateWork(1);
  })
  .use(async (c) => {
    await simulateWork(1);
  })
  .get("/", async (c) => {
    await simulateWork(1); // simulate handler work
    return c.text("Hello Diesel!");
  });

// --- Hono App ---
const honoApp = new Hono()
  .use(async (c, next) => {
    await simulateWork(1);
    return next();
  })
  .use(async (c, next) => {
    await simulateWork(1);
    return next();
  })
  .get("/", async (c) => {
    await simulateWork(1);
    return c.text("Hello Hono!");
  });

// --- Choose framework ---
const PORT = parseInt(process.env.PORT || "3000", 10);
const FRAMEWORK = process.env.FRAMEWORK || "diesel"; // "hono" or "diesel"

const handler =
  FRAMEWORK === "hono"
    ? honoApp.fetch.bind(honoApp)
    : dieselApp.fetch.bind(dieselApp);

const server = http.createServer(async (req, res) => {
  try {
    const response = await handler(req);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    const body = await response.text();
    res.end(body);
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end("Internal Server Error");
  }
});

server.listen(PORT, () => {
  console.log(`${FRAMEWORK} listening on http://localhost:${PORT}`);
});

// --- Optional: run built-in microbenchmark ---
async function microBench() {
  const reps = 10000;
  const start = performance.now();
  for (let i = 0; i < reps; i++) {
    await handler(new Request(`http://localhost:${PORT}/`));
  }
  const end = performance.now();
  console.log(`${FRAMEWORK} ${reps} requests in ${(end - start).toFixed(2)} ms`);
}

microBench(); 
