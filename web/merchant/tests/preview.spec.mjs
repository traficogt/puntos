import assert from "node:assert/strict";
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
try {
  const page = await browser.newPage();
  const requests = [],
    errors = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) requests.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  for (const entry of ["/demostracion/index.html", "/negocio/index.html?demo=1", "/merchant/?demo=1", "/demostracion/"]) {
    await page.goto(`${origin}${entry}`);
    await page.getByText("Café Jacaranda · demo", {exact:true}).waitFor();
    assert.equal(new URL(page.url()).pathname, "/demostracion/");
  }
  await page
    .getByText("Vista previa · datos de ejemplo", { exact: true })
    .waitFor();
  await page.getByText("Café Jacaranda · demo", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Preparar mi programa", exact: true })
    .click();
  await page.getByRole("tab", { name: "4. QR y revisión", exact: true }).click();
  await page.getByRole("heading", { name: "QR de demostración" }).waitFor();
  assert.ok(
    await page.getByRole("img", { name: /QR de inscripción/ }).isVisible(),
  );
  await page.getByRole("tab", { name: "1. Puntos", exact: true }).click();
  await page.getByRole("heading", { name: "Una regla fácil de explicar en caja", exact: true }).waitFor();
  assert.ok(page.url().includes("/demostracion/"));
  assert.equal(await page.locator('a[href^="/administracion/"],a[href^="/equipo/"]').count(),0);
  await page.getByRole("button", { name: "Reglas de puntos", exact: true }).click();
  await page.getByRole("button", { name: "Preparar bono por compra" }).click();
  await page.getByRole("button", { name: "Guardar campañas" }).click();
  await page
    .getByText(
      "Demostración: cambios guardados solo en esta pestaña. Ningún negocio real fue modificado.",
    )
    .waitFor();
  await page.getByRole("button", { name: "Resumen", exact: true }).click();
  await page.getByRole("heading",{name:"Cómo se mueven tus ventas"}).waitFor();
  await page.screenshot({
    path: "/var/lib/puntos/releases/spanish-growth-20261110/preview-live-like.png",
    fullPage: true,
  });
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    "Preview: dashboard, QR, local campaign saving and zero real API requests passed.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
