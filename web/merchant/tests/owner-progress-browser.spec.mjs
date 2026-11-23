import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import helmet from "helmet";
import { chromium, expect } from "@playwright/test";
import { build } from "vite";
import { createMerchantWeb } from "../../../src/middleware/merchant-web.js";
import { navigateMerchant } from "./helpers/navigation.mjs";

// "Tu progreso" smoke against the built bundle in demo mode: the view at #tu-progreso, goal change, the
// first review, the Overview card with its new-milestone notice, hide and show again, at 1280px and 390px.
// The application is built into a disposable directory; the shared Vite config still clears
// public/merchant/recursos at build start, so run `npm --prefix web/merchant run build` afterwards.
const merchant = path.resolve(import.meta.dirname, "..");
const project = path.resolve(merchant, "../..");
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), "pf-merchant-progress-"));
const outDir = path.join(artifacts, "merchant");
const axeSource = await fs.readFile(path.join(merchant, "node_modules/axe-core/axe.min.js"), "utf8");
await build({ root: merchant, configFile: path.join(merchant, "vite.config.js"), build: { outDir, emptyOutDir: true }, logLevel: "warn" });
const app = express();
app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
app.use("/negocio", createMerchantWeb(artifacts), express.static(outDir));
app.get("/runtime-config.js", (_req, res) => res.type("js").send("window.__PF_RUNTIME_CONFIG__={};"));
app.get("/test-axe.js", (_req, res) => res.type("js").send(axeSource));
app.use(express.static(path.join(project, "public")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox"] });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block" });
    const unexpected = [], errors = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith("/api/")) { unexpected.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const main = page.locator("#contenido");
    // The view: launch path complete, the goal with its factual progress, milestone history and momentum.
    await page.goto(`${origin}/negocio/?demo=1#tu-progreso`);
    await expect(page.locator("#contenido h1")).toHaveText("Tu progreso");
    await expect(main.getByText("5 de 5 pasos", { exact: false })).toBeVisible();
    await expect(main.getByText("3 de 5 clientes con una visita posterior registrada", { exact: true })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Hitos alcanzados" })).toBeVisible();
    await expect(main.getByText("Impulso: 3 semanas seguidas con actividad", { exact: false })).toBeVisible();
    assert.equal(await main.getByText(/gamificaci/i).count(), 0, "the word never appears");
    // Switch to one of the alternative goals from the priority list.
    await main.getByRole("button", { name: "Cambiar meta", exact: true }).click();
    await main.getByRole("button", { name: "Revisar un mes de resultados", exact: true }).click();
    await expect(main.getByText("Meta actualizada.", { exact: true })).toBeVisible();
    await expect(main.getByText("Revisar un mes de resultados", { exact: true })).toBeVisible();
    // The first program review records the decision and reaches its milestone.
    await main.getByLabel("Nota (opcional)").fill("La recompensa parece alcanzable.");
    await main.getByRole("button", { name: "Mantener", exact: true }).click();
    await expect(main.getByText("Revisión registrada", { exact: false })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Revisión del programa", exact: true })).toBeVisible();
    await expect(main.getByText("Primera revisión del programa", { exact: false })).toBeVisible();
    await page.addScriptTag({ url: `${origin}/test-axe.js` });
    const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector("#contenido"), { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed filename inside the generated test-only temp directory.
    await fs.writeFile(path.join(artifacts, `axe-view-${width}.json`), JSON.stringify(violations, null, 2));
    assert.deepEqual(violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), [], `axe violations on the view at ${width}px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal overflow on the view");
    await page.screenshot({ path: path.join(artifacts, `view-${width}.png`), fullPage: true });
    // Overview card: the new-milestone notice, dismissal acknowledges and returns focus, hide removes the card.
    await navigateMerchant(page, "Inicio");
    const card = page.locator('section[aria-labelledby="owner-progress-card"]');
    await expect(card.getByRole("heading", { name: "Tu progreso" })).toBeVisible();
    await expect(card.getByText(/^Nuevos? hitos? alcanzados?$/)).toBeVisible();
    await expect(card.getByText("Programa en marcha · Primera revisión del programa", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Cerrar aviso" }).click();
    await expect(card.getByText(/^Nuevos? hitos? alcanzados?$/)).toHaveCount(0);
    await expect(card.getByRole("heading", { name: "Tu progreso" })).toBeFocused();
    await expect(card.getByText("Último hito:", { exact: false })).toBeVisible();
    await expect(card.getByText("Siguiente paso:", { exact: false })).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal overflow on Inicio");
    await page.screenshot({ path: path.join(artifacts, `card-${width}.png`), fullPage: false });
    await card.getByRole("button", { name: "Ocultar", exact: true }).click();
    await expect(card).toHaveCount(0);
    // The hidden state persists and the view offers the one-line way back.
    await navigateMerchant(page, "Tu progreso");
    await expect(page.locator("#contenido h1")).toHaveText("Tu progreso");
    await main.getByRole("button", { name: "Mostrar de nuevo", exact: true }).click();
    await expect(main.getByRole("heading", { name: "Puesta en marcha", exact: true })).toBeVisible();
    assert.deepEqual(errors, [], "No uncaught browser errors");
    assert.deepEqual(unexpected, [], "No API or external requests");
    await context.close();
    console.log(`PASS owner progress view and card at ${width}px`);
  }
  console.log(`Owner progress browser checks passed. Artifacts: ${artifacts}`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
