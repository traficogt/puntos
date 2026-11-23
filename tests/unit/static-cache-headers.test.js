import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import {
  VERSIONED_ASSET_CACHE_CONTROL,
  hasVersionQuery,
  setStaticCacheHeaders as setHeaders,
} from "../../src/utils/static-cache-headers.js";

const publicDir = path.join(process.cwd(), "public");
let server;
let origin = "";

before(async () => {
  // Same wiring as src/app/server.js: the worker route decides its caching before the static mount.
  const app = express();
  app.get("/sw.js", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    next();
  });
  app.use(express.static(publicDir, { extensions: ["html"], redirect: false, setHeaders }));
  app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

/** @param {string} target */
async function cacheControl(target) {
  const response = await fetch(`${origin}${target}`);
  assert.equal(response.status, 200, target);
  await response.arrayBuffer();
  return response.headers.get("cache-control");
}

test("static assets requested with ?v= are immutable for a year", async () => {
  assert.equal(VERSIONED_ASSET_CACHE_CONTROL, "public, max-age=31536000, immutable");
  for (const target of [
    "/styles.css?v=0123abcd",
    "/styles/fonts.css?v=0123abcd",
    "/icon.svg?v=0123abcd",
    "/theme.js?v=0123abcd",
    "/manifest.webmanifest?v=0123abcd",
    "/fonts/inter-v20-latin-c940764593d0.woff2?other=1&v=c9407645",
  ]) {
    assert.equal(await cacheControl(target), VERSIONED_ASSET_CACHE_CONTROL, target);
  }
});

test("unversioned assets, documents and the worker keep their caching", async () => {
  for (const target of [
    "/styles.css",
    "/styles.css?other=1",
    "/styles.css?v=",
    "/index.html?v=0123abcd",
    "/admin?v=0123abcd",
    "/?v=0123abcd",
    "/admin-dashboard/fragments/program.html?v=0123abcd",
  ]) {
    assert.equal(await cacheControl(target), "public, max-age=0", target);
  }
  assert.equal(await cacheControl("/sw.js?v=0123abcd"), "no-cache, no-store, must-revalidate");
  assert.equal(await cacheControl("/sw.js"), "no-cache, no-store, must-revalidate");
});

test("hasVersionQuery reads the first non-empty v parameter of the original URL", () => {
  assert.equal(hasVersionQuery({ originalUrl: "/a.css?v=1" }), true);
  assert.equal(hasVersionQuery({ originalUrl: "/a.css?x=1&v=abc" }), true);
  assert.equal(hasVersionQuery({ url: "/a.css?v=1" }), true);
  assert.equal(hasVersionQuery({ originalUrl: "/a.css" }), false);
  assert.equal(hasVersionQuery({ originalUrl: "/a.css?v=" }), false);
  assert.equal(hasVersionQuery({ originalUrl: "/a.css?vv=1" }), false);
  assert.equal(hasVersionQuery(undefined), false);
});

test("server.js passes the hook to the public static mount and leaves the API headers alone", () => {
  // Fixed repository source.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../src/app/server.js", import.meta.url), "utf8");
  assert.match(
    source,
    /import \{ setStaticCacheHeaders \} from "\.\.\/utils\/static-cache-headers\.js";/,
  );
  assert.match(source, /const setHeaders = setStaticCacheHeaders;/);
  assert.match(
    source,
    /app\.use\(express\.static\(publicDir,\s*\{[^}]*redirect:\s*false,\s*setHeaders\s*\}\)\);/,
  );
  assert.match(
    source,
    /app\.use\("\/api", \(req, res, next\) => \{\n\s*res\.setHeader\("Cache-Control", "no-store"\);/,
  );
});
