import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { pool } from "../../src/app/database.js";
import { PG_CLIENT_MOUNT_PATHS, mountPgClient } from "../../src/middleware/pg-client.js";

const publicDir = path.join(process.cwd(), "public");
const originalConnect = pool.connect;
let server;
let origin = "";
let connects = 0;
let releases = [];

before(async () => {
  // The same mount helper server.js uses, ahead of the static and page routes.
  const app = express();
  mountPgClient(app);
  app.use(express.static(publicDir, { extensions: ["html"], redirect: false }));
  app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
  app.get(["/api/ping", "/api/v1/ping"], (req, res) => res.json({ pinned: Boolean(req.pgClient) }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  connects = 0;
  releases = [];
  pool.connect = /** @type {any} */ (
    async () => {
      connects += 1;
      return {
        async query() {
          return { rows: [] };
        },
        release(destroy) {
          releases.push(Boolean(destroy));
        },
      };
    }
  );
});
after(async () => {
  pool.connect = originalConnect;
  await new Promise((resolve) => server?.close(resolve));
});

async function settled(predicate, attempts = 50) {
  for (let i = 0; i < attempts && !predicate(); i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return predicate();
}

test("the request client is mounted on the API prefixes only", () => {
  assert.deepEqual(PG_CLIENT_MOUNT_PATHS, ["/api"]);
});

test("static assets and HTML entry pages never acquire a pooled connection", async () => {
  for (const asset of ["/styles.css", "/icon.svg", "/", "/index.html", "/admin"]) {
    const response = await fetch(`${origin}${asset}`);
    assert.equal(response.status, 200, asset);
    await response.arrayBuffer();
  }
  assert.equal(connects, 0, "no static or page request touched the pool");
  assert.deepEqual(releases, []);
});

test("/api and /api/v1 requests pin a connection and return it once the response finishes", async () => {
  for (const route of ["/api/ping", "/api/v1/ping"]) {
    const response = await fetch(`${origin}${route}`);
    assert.equal(response.status, 200, route);
    assert.deepEqual(await response.json(), { pinned: true });
  }
  assert.equal(connects, 2);
  assert.ok(await settled(() => releases.length === 2), "each request released its client");
  assert.deepEqual(releases, [false, false]);
});

test("server.js mounts the request client through the helper, before the API router", () => {
  // Static path is fixed by the test file layout.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../src/app/server.js", import.meta.url), "utf8");
  assert.match(source, /mountPgClient\(app\);/);
  assert.doesNotMatch(source, /app\.use\(\s*withPgClient\s*\)/);
  assert.ok(source.indexOf("mountPgClient(app);") < source.indexOf("app.use(apiRoutes);"));
});
