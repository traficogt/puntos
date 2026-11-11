import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { request as httpRequest } from "node:http";
import express from "express";
import helmet from "helmet";
import { createSpanishWeb, createSpanishWebRedirects } from "../../src/middleware/spanish-web.js";
import { createMobilePreview } from "../../src/middleware/mobile-preview.js";
import { resolveHostSplitRedirect } from "../../src/utils/app-host-routing.js";

async function serveFixture(t, { splitHosts = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "pf-spanish-web-"));
  const fixtures = {
    "merchant/index.html": '<meta name="pf-style-nonce" content="__PF_STYLE_NONCE__"><main>Merchant</main>',
    "merchant/recursos/new.js": 'window.newMerchant = true;',
    "merchant/assets/old.js": 'window.oldMerchant = true;',
    "app-preview/index.html": '<main>App preview</main>',
    "app-preview/_expo/app.js": 'window.preview = true;',
    "admin-dashboard.html": '<main>Administration</main>',
    "admin.html": '<main>Signup</main>',
    "staff-login.html": '<main>Team login</main>',
    "staff.html": '<main>Scanner</main>',
    "customer.html": '<main>Card</main>',
    "super.html": '<main>Platform</main>',
    "join.html": '<main>Registration</main>',
    "ingresar.html": '<main>Customer login</main>',
    "staff.js": 'window.staff = true;'
  };
  for (const [relative, contents] of Object.entries(fixtures)) {
    const file = path.join(directory, relative);
    // Both paths are fixed fixture names under this test's temporary directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await mkdir(path.dirname(file), { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(file, contents);
  }
  const app = express();
  app.use(helmet());
  app.use(createSpanishWebRedirects());
  if (splitHosts) app.use((req, res, next) => {
    const location = resolveHostSplitRedirect({ host: req.get("host"), path: req.path, originalUrl: req.originalUrl, appOrigin: "https://app.example.com", marketingOrigin: "https://example.com" });
    return location ? res.redirect(302, location) : next();
  });
  app.use(createSpanishWeb(directory));
  app.use("/app-preview", createMobilePreview(directory));
  app.use(express.static(directory, { extensions: ["html"], redirect: false }));
  app.all("/api/example", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  return (pathname, options = {}) => new Promise((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:${address.port}${pathname}`, options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode,
        headers: /** @type {Record<string, string>} */ (response.headers)
      })));
    });
    request.on("error", reject);
    request.end();
  });
}

test("browser aliases redirect only GET/HEAD with a permanent same-origin Location", async (t) => {
  const request = await serveFixture(t);
  for (const method of ["GET", "HEAD"]) {
    const response = await request("/admin-dashboard.html?tab=rewards&token=a%2Bb", { method });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), "/administracion/?seccion=recompensas&token=a%2Bb");
  }
  for (const method of ["POST", "PUT", "DELETE"]) {
    const response = await request("/admin-dashboard?tab=rewards", { method });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("location"), null);
  }
  const api = await request("/api/example?tab=rewards", { method: "POST" });
  assert.equal(api.status, 200);
  assert.deepEqual(await api.json(), { ok: true });
});

test("canonical Spanish routes serve their existing HTML", async (t) => {
  const request = await serveFixture(t);
  for (const [route, label] of Object.entries({ "/administracion/": "Administration", "/crear-negocio/": "Signup", "/equipo/ingresar/": "Team login", "/equipo/escaner/": "Scanner", "/mi-tarjeta/": "Card", "/plataforma/": "Platform", "/registro/": "Registration", "/ingresar/": "Customer login" })) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    assert.equal(await response.text(), `<main>${label}</main>`, route);
  }
});

test("merchant and demo HTML retain unique style nonces and strict script CSP", async (t) => {
  const request = await serveFixture(t);
  const nonces = new Set();
  for (const route of ["/negocio/", "/demostracion/"]) {
    const response = await request(route);
    assert.equal(response.status, 200);
    const html = await response.text();
    const nonce = html.match(/name="pf-style-nonce" content="([^"]+)"/)?.[1];
    assert.ok(nonce && nonce !== "__PF_STYLE_NONCE__");
    nonces.add(nonce);
    assert.ok(response.headers.get("content-security-policy").includes(`nonce-${nonce}`));
    assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
    assert.doesNotMatch(response.headers.get("content-security-policy"), /script-src[^;]*'unsafe-inline'/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(nonces.size, 2);
});

test("new resources and old open-tab assets remain available without entry redirects", async (t) => {
  const request = await serveFixture(t);
  for (const [route, contents] of Object.entries({ "/negocio/recursos/new.js": "window.newMerchant = true;", "/merchant/assets/old.js": "window.oldMerchant = true;", "/staff.js": "window.staff = true;", "/app-preview/_expo/app.js": "window.preview = true;", "/vista-previa-app/_expo/app.js": "window.preview = true;" })) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    assert.equal(await response.text(), contents, route);
    assert.equal(response.headers.get("location"), null, route);
  }
  assert.equal((await request("/negocio/recursos/missing.js")).status, 404);
  assert.equal((await request("/unrelated")).status, 404);
  for (const route of ["/vista-previa-app/", "/vista-previa-app/account", "/app-preview/account"]) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    assert.match(await response.text(), /App preview/);
  }
});

test("canonicalization precedes host splitting and keeps assets on the requested host", async (t) => {
  const request = await serveFixture(t, { splitHosts: true });
  const headers = { host: "example.com" };
  const legacy = await request("/merchant/?demo=1&token=a%2Bb", { headers });
  assert.equal(legacy.status, 308);
  assert.equal(legacy.headers.get("location"), "/demostracion/?token=a%2Bb");
  const canonical = await request(legacy.headers.get("location"), { headers });
  assert.equal(canonical.status, 302);
  assert.equal(canonical.headers.get("location"), "https://app.example.com/demostracion/?token=a%2Bb");
  const app = await request("/demostracion/?token=a%2Bb", { headers: { host: "app.example.com" } });
  assert.equal(app.status, 200);
  assert.equal((await request("/negocio/recursos/new.js", { headers })).status, 200);
  assert.equal((await request("/api/example", { headers })).status, 200);
});

test("server mounts canonicalization before host split and Spanish documents before static files", async () => {
  // Fixed repository source for the startup wiring that otherwise starts the database.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const server = await readFile(new URL("../../src/app/server.js", import.meta.url), "utf8");
  const redirects = server.indexOf("app.use(createSpanishWebRedirects())");
  const hostSplit = server.indexOf("const redirectTo = resolveHostSplitRedirect(");
  const documents = server.indexOf("app.use(createSpanishWeb(publicDir))");
  const staticFiles = server.indexOf("app.use(express.static(publicDir");
  assert.ok(redirects >= 0 && redirects < hostSplit);
  assert.ok(documents > hostSplit && documents < staticFiles);
});


test("legacy business registration keeps its identifier, token and temporary redirect", async (t) => {
  const request = await serveFixture(t);
  const response = await request("/join/Cafe-Capital?token=a%2Bb&ref=one+two");
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "/registro/Cafe-Capital?token=a%2Bb&ref=one+two");
});
