import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import { chromium } from "playwright";
import { createSpanishWeb, createSpanishWebRedirects } from "../../../src/middleware/spanish-web.js";
const app = express();
app.use(
  helmet({
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
  }),
);
app.use(createSpanishWebRedirects());
app.use(createSpanishWeb(path.resolve(import.meta.dirname, "../../../public")));
app.use(express.static(path.resolve(import.meta.dirname, "../../../public")));
app.get("/runtime-config.js", (_q, r) =>
  r.type("js").send("window.__PF_RUNTIME_CONFIG__={};"),
);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const workerSource = await readFile(new URL("../../../public/sw.js", import.meta.url), "utf8");
const expectedCache = workerSource.match(/^const CACHE = "([^"]+)";/m)?.[1];
assert.ok(expectedCache, "The shipped service worker declares its cache version");
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${origin}/equipo/escaner/`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(async () => !!(await caches.match('/equipo/escaner/')) && !!(await caches.match('/mi-tarjeta/')));
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.goto(`${origin}/equipo/escaner/?sinconexion=1`);
  await page.getByRole('heading',{name:'Cada visita cuenta.',exact:true}).waitFor();
  await page.goto(`${origin}/mi-tarjeta/?sinconexion=1`);
  assert.equal((await page.content()).includes('PuntosFieles'),true);
  const cached = await page.evaluate(() => caches.keys());
  assert.deepEqual(cached, [expectedCache], "Only the shipped worker's cache remains active");
  console.log('Spanish scanner and customer routes load offline from the actual service worker');
  await context.close();
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
