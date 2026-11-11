import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import { chromium, expect } from "@playwright/test";
import { build } from "vite";
import { Resvg } from "@resvg/resvg-js";
import jsQR from "jsqr";
import { brandedQrConfiguration, renderBrandedQr } from "../../../src/app/services/branded-qr-service.js";

const merchant = path.resolve(import.meta.dirname, "..");
const project = path.resolve(merchant, "../..");
const artifacts = "/tmp/puntos-branded-qr-browser";
const outDir = path.join(artifacts, "build");
await fs.mkdir(artifacts, { recursive: true });
await build({
  root: merchant, configFile: path.join(merchant, "vite.config.js"),
  build: { outDir, emptyOutDir: true, rollupOptions: { input: path.join(import.meta.dirname, "fixtures/branded-qr.html") } },
  logLevel: "warn",
});
const app = express();
app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null, imgSrc: ["'self'", "data:", "blob:"] } } }));
app.get("/test-axe.js", (_req, res) => res.sendFile(path.join(merchant, "node_modules/axe-core/axe.min.js")));
app.get("/negocio/qr-test", (_req, res) => res.sendFile(path.join(outDir, "tests/fixtures/branded-qr.html")));
app.use("/negocio", express.static(outDir));
app.use(express.static(path.join(project, "public")));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const business = { id: "own-business", name: "Café Jacaranda", slug: "cafe-jacaranda", customer_branding_json: { primary_color: "#204030", accent_color: "#F0DDA5", customer_logo_url: "https://remote.invalid/logo.svg" } };
const source = { id: "11111111-1111-4111-8111-111111111111", business_id: business.id, name: "Mostrador", code: "abcdefghijklmnop" };
let checks = 0;

async function session(params = {}, width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
  const state = { requests: [], errors: [], failure: false, foreign: false };
  await context.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    state.requests.push(url.pathname);
    assert.ok(["GET", "POST"].includes(route.request().method()));
    if (state.failure) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Unavailable" }) });
    if (url.pathname === "/api/admin/customer-enrollment/branded-qr") {
      const config = brandedQrConfiguration(state.foreign ? { ...business, id: "other-business" } : business, origin);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...config, sources: [source] }) });
    }
    if (url.pathname === "/api/admin/customer-enrollment/branded-qr.svg") {
      const options = route.request().method() === "POST" ? route.request().postDataJSON() : { foreground: url.searchParams.get("foreground"), logo_position: url.searchParams.get("logo_position") || "center", source_id: url.searchParams.get("source_id") };
      assert.equal(options.registration_url, undefined);
      return route.fulfill({ contentType: "image/svg+xml", body: renderBrandedQr(state.wrongQr ? { ...business, slug: "other-business" } : business, origin, options, options.source_id === source.id ? source : null) });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => state.errors.push(error.message));
  await page.addInitScript(() => { window.print = () => { window.__printed = true; }; });
  await page.goto(`${origin}/negocio/qr-test?${new URLSearchParams(params)}`);
  return { context, page, state };
}

async function checkAccess(page, label) {
  await page.addScriptTag({ url: `${origin}/test-axe.js` });
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations);
  await fs.writeFile(path.join(artifacts, `axe-${label}.json`), JSON.stringify(violations, null, 2));
  assert.deepEqual(violations, []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}

try {
  const real = await session();
  await expect(real.page.getByRole("img", { name: "Cartel de inscripción de Café Jacaranda", exact: true })).toBeVisible();
  await expect(real.page.getByText("Sube el archivo de tu logotipo para incluirlo en el QR.")).toBeVisible();
  await real.page.locator('input[type="file"]').setInputFiles(path.join(import.meta.dirname, "fixtures/qr-logo.png"));
  await expect(real.page.getByText("Se usará el archivo que elegiste.")).toBeVisible();
  await expect(real.page.getByText("Lectura comprobada: el QR conserva el enlace correcto.")).toBeVisible();
  await real.page.getByRole("combobox", { name: "Origen de inscripción" }).click();
  await real.page.getByRole("option", { name: "Mostrador", exact: true }).click();
  await expect(real.page.getByLabel("Enlace de inscripción", { exact: true })).toHaveValue(`${origin}/registro/cafe-jacaranda?origen=${source.code}`);
  await expect(real.page.getByText("Lectura comprobada: el QR conserva el enlace correcto.")).toBeVisible();
  await real.page.screenshot({ path: path.join(artifacts, "desktop.png"), fullPage: true });
  await checkAccess(real.page, "desktop");
  const color = real.page.getByLabel("Color del QR y del texto", { exact: true });
  await color.fill("#FFFFFF");
  await expect(real.page.getByText(/Elige un color más oscuro/)).toBeVisible();
  await expect(real.page.getByRole("button", { name: "Actualizar vista previa" })).toBeDisabled();
  await color.fill("#173B59");
  await color.press("Escape");
  await expect(color).toBeFocused();
  await real.page.getByRole("button", { name: "Actualizar vista previa" }).click();
  await expect(real.page.getByRole("button", { name: "Imprimir cartel" })).toBeEnabled();
  const pendingDownload = real.page.waitForEvent("download");
  await real.page.getByRole("link", { name: "Descargar SVG" }).click();
  const download = await pendingDownload;
  assert.equal(download.suggestedFilename(), "qr-registro-con-marca.svg");
  const svg = await fs.readFile(await download.path(), "utf8");
  assert.match(svg, /#173B59/);
  assert.match(svg.slice(svg.indexOf('<svg x="50"'), svg.indexOf('</svg>')), /<image[^>]+data:image\/png;base64,/);
  const image = new Resvg(svg).render();
  assert.equal(jsQR(new Uint8ClampedArray(image.pixels), image.width, image.height)?.data, `${origin}/registro/cafe-jacaranda?origen=${source.code}`);
  await real.page.getByRole("button", { name: "Imprimir cartel" }).click();
  assert.equal(await real.page.evaluate(() => window.__printed), true);
  await real.page.emulateMedia({ media: "print" });
  await expect(real.page.locator(".branded-qr-print")).toBeVisible();
  await expect(real.page.locator("h1")).toBeHidden();
  const pdf = await real.page.pdf({ path: path.join(artifacts, "print.pdf"), format: "A4" });
  assert.equal((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length, 1, "Print exports exactly one sheet");
  assert.deepEqual(real.state.errors, []);
  await real.context.close();
  checks++;

  for (const params of [{ locked: "1" }, { manager: "1" }]) {
    const blocked = await session(params);
    await expect(blocked.page.getByRole("heading", { name: "QR con tu marca" })).toBeVisible();
    assert.deepEqual(blocked.state.requests, []);
    assert.equal(await blocked.page.locator(".branded-qr-print").count(), 0);
    await blocked.context.close();
    checks++;
  }

  for (const params of [{ demo: "1" }, { demo: "1", dark: "1" }]) {
    const demo = await session(params, 390);
    await expect(demo.page.getByRole("img", { name: /Cartel de demostración/ })).toBeVisible();
    await demo.page.getByRole("combobox", { name: "Origen de inscripción" }).click();
    await demo.page.getByRole("option", { name: "Mostrador · ejemplo", exact: true }).click();
    await expect(demo.page.getByText("Lectura comprobada: el QR conserva el enlace correcto.")).toBeVisible();
    await demo.page.screenshot({ path: path.join(artifacts, params.dark ? "mobile-dark.png" : "mobile.png"), fullPage: true });
    await checkAccess(demo.page, params.dark ? "mobile-dark" : "mobile");
    await demo.page.locator('input[type="file"]').setInputFiles(path.join(import.meta.dirname, 'fixtures/qr-logo.png'));
    await expect(demo.page.getByText('Lectura comprobada: el QR conserva el enlace correcto.')).toBeVisible();
    await demo.page.getByRole('combobox', { name: 'Ubicación del logotipo' }).click();
    await demo.page.getByRole('option', { name: 'Encima del QR', exact: true }).click();
    await expect(demo.page.getByText('Lectura comprobada: el QR conserva el enlace correcto.')).toBeVisible();
    const jpeg = await demo.page.evaluate(() => { const c=document.createElement('canvas'); c.width=80;c.height=80;const x=c.getContext('2d');x.fillStyle='#204030';x.fillRect(0,0,80,80);return c.toDataURL('image/jpeg').split(',')[1]; });
    await demo.page.locator('input[type="file"]').setInputFiles({ name: 'logo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
    await expect(demo.page.getByText('Lectura comprobada: el QR conserva el enlace correcto.')).toBeVisible();
    await demo.page.locator('input[type="file"]').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await expect(demo.page.getByText('No se pudo leer la imagen. Elige un PNG o JPG válido.')).toBeVisible();
    await expect(demo.page.getByRole('button', { name: 'Imprimir cartel' })).toBeDisabled();
    await demo.page.getByRole('button', { name: 'Quitar archivo de logotipo' }).click();
    await expect(demo.page.getByText('Lectura comprobada: el QR conserva el enlace correcto.')).toBeVisible();
    assert.deepEqual(demo.state.requests, []);
    assert.deepEqual(demo.state.errors, []);
    assert.equal(await demo.page.locator('a[href^="/administracion/"]').count(), 0);
    await demo.context.close();
    checks++;
  }
  const mismatch = await session();
  mismatch.state.wrongQr = true;
  await mismatch.page.reload();
  await expect(mismatch.page.getByText(/No pudimos verificar la lectura de este QR/)).toBeVisible();
  await expect(mismatch.page.getByRole('button', { name: 'Imprimir cartel' })).toBeDisabled();
  await mismatch.context.close();
  const retry = await session();
  retry.state.failure = true;
  await retry.page.reload();
  await expect(retry.page.getByRole("alert")).toBeVisible();
  assert.equal(await retry.page.locator(".branded-qr-print").count(), 0);
  retry.state.failure = false;
  await retry.page.getByRole("button", { name: "Reintentar" }).click();
  await expect(retry.page.getByRole("img", { name: /Cartel de inscripción/ })).toBeVisible();
  retry.state.foreign = true;
  await retry.page.reload();
  await expect(retry.page.getByRole("alert")).toBeVisible();
  assert.equal(await retry.page.locator(".branded-qr-print").count(), 0);
  await retry.context.close();
  checks++;
  console.log(`${checks} branded QR browser scenarios passed: decoded download, color contrast, print, owner/plan locks, demo isolation, mobile light/dark, accessibility, retry and tenant mismatch. Artifacts: ${artifacts}`);
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
