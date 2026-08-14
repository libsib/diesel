import { getPath, tryDecodeURI } from "../src/utils/urls";

export const getPathHono = (url:string): string => {
  const start = url.indexOf('/', url.indexOf(':') + 4)
  let i = start
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i)
    if (charCode === 37) {
      // '%'
      // If the path contains percent encoding, use `indexOf()` to find '?' or '#' and return the result immediately.
      // Although this is a performance disadvantage, it is acceptable since we prefer cases that do not include percent encoding.
      const queryIndex = url.indexOf('?', i)
      const hashIndex = url.indexOf('#', i)
      const end =
        queryIndex === -1
          ? hashIndex === -1
            ? undefined
            : hashIndex
          : hashIndex === -1
            ? queryIndex
            : Math.min(queryIndex, hashIndex)
      const path = url.slice(start, end)
      return tryDecodeURI(path.includes('%25') ? path.replace(/%25/g, '%2525') : path)
    } else if (charCode === 63 || charCode === 35) {
      // '?' or '#'
      break
    }
  }
  return url.slice(start, i)
}

const ITERATIONS = 1_000_000;

// Test URLs (mix of cases)
const urls = [
  "http://localhost:3000/",
  "http://localhost:3000/now",
  "http://localhost:3000/user?id=10",
  "http://localhost:3000/product/view?cat=books&page=2",
  "http://localhost:3000/a/b/c/d/e?x=1&y=2&z=3",
];

function randomUrl() {
  return urls[(Math.random() * urls.length) | 0];
}

// Warmup for JIT
for (let i = 0; i < 100_000; i++) {
  const u = randomUrl();
  new URL(u).pathname;
  getPath(u);
}

console.log("Starting benchmark with", ITERATIONS, "iterations\n");

// Test 1: Native URL parser
console.time("new URL()");
for (let i = 0; i < ITERATIONS; i++) {
  new URL(randomUrl()).pathname;
}
console.timeEnd("new URL()");

// Test 2: Custom parser
console.time("getPath()");
for (let i = 0; i < ITERATIONS; i++) {
  getPath(randomUrl());
}
console.timeEnd("getPath()");

// Test 3: Custom parser with URLSearchParams
console.time("getPathWithParams()");
for (let i = 0; i < ITERATIONS; i++) {
  getPathHono(randomUrl());
}
console.timeEnd("getPathWithParams()");
