import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import helmet from "helmet";
import { chromium, expect } from "@playwright/test";
import { build } from "vite";
import { createMerchantWeb } from "../../../src/middleware/merchant-web.js";

// Analytics suite (wave 15a) smoke against the built bundle in demo mode: #analitica with its
// executive summary, comparison window, branch filter and benchmark, RFM, cohorts, churn list and
// the IVA CSV download generated offline; then #canjes-por-recompensa with the ledger detail. Runs
// at 1280px and 390px with axe, blocks every /api/ request and ends with a completion receipt.
// The application is built into a disposable directory; the shared Vite config still clears
// public/merchant/recursos at build start, so run `npm --prefix web/merchant run build` afterwards.
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const merchant = path.resolve(import.meta.dirname, "..");
const project = path.resolve(merchant, "../..");
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), "pf-merchant-analytics-"));
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
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: "block", acceptDownloads: true });
    const unexpected = [], errors = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith("/api/")) { unexpected.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const main = page.locator("#contenido");

    // The analytics page: narrative, six-tile summary, comparison window, trend, RFM, cohorts, churn.
    await page.goto(`${origin}/negocio/?demo=1#analitica`);
    await expect(page.locator("#contenido h1")).toHaveText("Analítica avanzada");
    await expect(main.getByText(/^Todas las sucursales tiene \d+ clientes activos en 30 días/)).toBeVisible();
    await expect(main.getByRole("list", { name: "Indicadores de 30 días" }).getByRole("listitem")).toHaveCount(6);
    await expect(main.getByRole("list", { name: "Comparativo de 30 días" }).getByRole("listitem")).toHaveCount(5);
    await expect(main.getByText("Canjes por cada 100 compras registradas", { exact: true })).toBeVisible();
    check((await main.getByText(/retorno de inversión|ROI/i).count()) <= 1, "ROI appears only in the definitions, as something not calculated");
    await expect(main.getByRole("img", { name: /Ventas registradas por día/ })).toBeVisible();
    await expect(main.getByRole("img", { name: /Clientes por segmento RFM/ })).toBeVisible();
    await expect(main.getByRole("cell", { name: "Campeones", exact: true })).toBeVisible();
    await expect(main.getByRole("region", { name: "Retención por cohorte mensual" })).toBeVisible();
    await expect(main.getByRole("columnheader", { name: "+1 m", exact: true })).toBeVisible();
    check((await main.getByLabel("Mes aún no iniciado").count()) > 0, "future cohort months render as pending, not 0 %");
    await expect(main.getByRole("region", { name: "Clientes en riesgo de pérdida" }).getByRole("row")).toHaveCount(10);
    await expect(main.getByText("Ana López", { exact: true }).first()).toBeVisible();
    // The comparison window is its own control; changing it keeps the rest of the page.
    await main.getByLabel("Ventana", { exact: true }).selectOption("90");
    await expect(main.getByRole("heading", { name: "Comparativo de 90 días" })).toBeVisible();
    await expect(main.getByRole("list", { name: "Comparativo de 90 días" }).getByRole("listitem")).toHaveCount(5);
    // Branch filter: the scope line, the narrative and the branch-vs-business benchmark follow it.
    await main.getByLabel("Sucursal", { exact: true }).selectOption({ label: "Zona 4 · demo" });
    await expect(main.getByText("Vista actual: Zona 4 · demo", { exact: true })).toBeVisible();
    await expect(main.getByText(/^Zona 4 · demo tiene \d+ clientes activos en 30 días/)).toBeVisible();
    await expect(main.getByRole("heading", { name: "Sucursal frente al negocio" })).toBeVisible();
    const benchmark = main.locator('section[aria-labelledby="owner-analytics-benchmark"]');
    await expect(benchmark.getByRole("columnheader", { name: "Participación", exact: true })).toBeVisible();
    await expect(benchmark.getByRole("row")).toHaveCount(11, "ten days plus the header");
    const shares = await benchmark.getByRole("cell", { name: /^\d+%$/ }).allTextContents();
    check(shares.length === 10 && shares.every((share) => Number.parseInt(share, 10) >= 40 && Number.parseInt(share, 10) <= 70), `branch share per day ${shares.join(" ")}`);
    await main.getByRole("button", { name: "Quitar filtro", exact: true }).click();
    await expect(main.getByText("Vista actual: Todas las sucursales", { exact: true })).toBeVisible();
    // IVA CSV: generated offline in the preview, downloaded under the server's file name.
    const downloadPromise = page.waitForEvent("download");
    await main.getByRole("button", { name: "Descargar CSV IVA", exact: true }).click();
    const download = await downloadPromise;
    check(download.suggestedFilename() === "reporte_iva_gt.csv", `download name ${download.suggestedFilename()}`);
    const csv = await fs.readFile(await download.path(), "utf8");
    check(csv.startsWith("fecha,transacciones,monto_bruto_q,base_sin_iva_q,iva_12_q\n"), "CSV header");
    check(csv.trim().split("\n").length >= 2, "at least one day in the current month");
    await expect(main.getByText(/Archivo reporte_iva_gt\.csv descargado\./)).toBeVisible();
    await main.getByLabel("Hasta", { exact: true }).fill("2026-01-01");
    await main.getByRole("button", { name: "Descargar CSV IVA", exact: true }).click();
    await expect(main.getByRole("alert").filter({ hasText: "anterior o igual" })).toBeVisible();
    // Definitions keep the measured/estimated distinction.
    await main.getByRole("button", { name: "Qué significan estos números" }).click();
    await expect(main.getByText(/no calculamos rentabilidad ni retorno de inversión/)).toBeVisible();
    await expect(main.getByText(/Datos ficticios de demostración/)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: no horizontal overflow on analytics`);
    await page.addScriptTag({ url: "/test-axe.js" });
    const analyticsViolations = await page.evaluate(async () => (await window.axe.run(document.querySelector("#contenido"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations);
    await fs.writeFile(path.join(artifacts, `analytics-${width}-axe.json`), JSON.stringify(analyticsViolations, null, 2));
    assert.deepEqual(analyticsViolations.map((violation) => violation.id), [], `${width}px analytics axe violations`);
    checks += 1;
    await page.screenshot({ path: path.join(artifacts, `analytics-${width}.png`), fullPage: true });

    // The redemption ledger: reward selector, recent redemptions with the server's consistency rule, detail.
    await main.getByRole("button", { name: "Canjes por recompensa", exact: true }).click();
    await expect(page.locator("#contenido h1")).toHaveText("Canjes por recompensa");
    await expect(page).toHaveURL(/#canjes-por-recompensa$/);
    await main.getByLabel("Recompensa", { exact: true }).selectOption({ index: 1 });
    await expect(main.getByRole("heading", { name: /^Últimos canjes de / })).toBeVisible();
    await expect(main.getByText("5 recientes", { exact: true })).toBeVisible();
    await expect(main.getByText("1 por revisar", { exact: true })).toBeVisible();
    const rows = main.getByRole("region", { name: /^Canjes recientes de / }).getByRole("row");
    await expect(rows).toHaveCount(6);
    await expect(main.getByText("Revisar", { exact: true })).toHaveCount(1);
    await main.getByRole("button", { name: "Ver detalle del canje CJ-DEMO-0003", exact: true }).click();
    await expect(main.getByRole("heading", { name: "Canje CJ-DEMO-0003" })).toBeVisible();
    await expect(main.getByText("Revisar canje", { exact: true })).toBeVisible();
    await expect(main.getByText("No hay movimientos de puntos vinculados a este canje.", { exact: true })).toBeVisible();
    await main.getByRole("button", { name: "Ver detalle del canje CJ-DEMO-0001", exact: true }).click();
    await expect(main.getByRole("heading", { name: "Canje CJ-DEMO-0001" })).toBeVisible();
    await expect(main.getByText("Canje consistente", { exact: true })).toBeVisible();
    await expect(main.getByRole("region", { name: "Movimientos vinculados al canje CJ-DEMO-0001" }).getByRole("row")).toHaveCount(2);
    await main.getByLabel("Recompensa", { exact: true }).selectOption({ index: 2 });
    await expect(main.getByText("0 por revisar", { exact: true })).toBeVisible();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: no horizontal overflow on redemptions`);
    const ledgerViolations = await page.evaluate(async () => (await window.axe.run(document.querySelector("#contenido"), { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations);
    await fs.writeFile(path.join(artifacts, `redemptions-${width}-axe.json`), JSON.stringify(ledgerViolations, null, 2));
    assert.deepEqual(ledgerViolations.map((violation) => violation.id), [], `${width}px redemptions axe violations`);
    checks += 1;
    await page.screenshot({ path: path.join(artifacts, `redemptions-${width}.png`), fullPage: true });

    // Deep link back to the analytics page; nothing left the preview during the whole pass.
    await page.goto(`${origin}/negocio/?demo=1#analitica`);
    await expect(page.locator("#contenido h1")).toHaveText("Analítica avanzada");
    assert.deepEqual(unexpected, [], `${width}px: unexpected requests`);
    assert.deepEqual(errors, [], `${width}px: page errors`);
    checks += 2;
    await context.close();
  }
  console.log(`Analytics browser: executive summary, comparison window, branch benchmark, RFM, cohorts, churn, offline IVA CSV download, redemption ledger detail, axe at 1280/390 passed. Artifacts: ${artifacts}`);
  console.log(JSON.stringify({ kind: "owner-analytics-browser", checks, passed: true }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
