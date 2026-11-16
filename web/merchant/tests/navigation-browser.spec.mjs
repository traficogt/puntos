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

// Build the actual application into a disposable directory, never public/merchant.
const merchant = path.resolve(import.meta.dirname, "..");
const project = path.resolve(merchant, "../..");
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), "pf-merchant-navigation-"));
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
await new Promise(resolve => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
async function session(width = 1440, colorScheme = "light") {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme, serviceWorkers: "block" });
  const unexpected = [], errors = [];
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) {
      unexpected.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", error => { errors.push(error.message); console.error("Browser error:", error.message); });
  await page.addInitScript(() => {
    window.__navigationCspErrors = [];
    document.addEventListener("securitypolicyviolation", event => window.__navigationCspErrors.push(event.violatedDirective));
  });
  return { context, page, unexpected, errors };
}
const nav = page => page.getByRole("navigation", { name: "Tu negocio" });
const group = (page, name) => nav(page).locator("details").filter({ has: page.locator("summary", { hasText: name }) });
async function openGroup(page, name) {
  const details = group(page, name);
  if (!(await details.evaluate(node => node.open))) await details.locator("summary").click();
}
async function goto(page, hash = "resumen") {
  await page.goto(`${origin}/negocio/?demo=1#${hash}`);
  await expect(page.getByText("Café Jacaranda · demo", { exact: true })).toBeVisible();
}
async function finish(session) {
  assert.deepEqual(session.errors, [], "No uncaught browser errors");
  assert.deepEqual(session.unexpected, [], "No API or external provider requests");
  assert.deepEqual(await session.page.evaluate(() => window.__navigationCspErrors), []);
  await session.context.close();
}

try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox"] });
  await check("guided entry, three steps, free exploration and history preserve real screens", async () => {
    const current = await session();
    const page = current.page;
    await page.goto(`${origin}/negocio/?demo=1`);
    await expect(page.getByRole("heading", { name: "Conoce PF con un ejemplo" })).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, "guide-welcome-desktop.png") });
    await page.getByRole("button", { name: "Ver un ejemplo", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("Recuperar clientes");
    await expect(page.getByRole("region", { name: "Recorrido de ejemplo" })).toContainText("Paso 1 de 3");
    await page.screenshot({ path: path.join(artifacts, "guide-step-desktop.png") });
    const draft = page.getByLabel("Nombre de la lista", { exact: true });
    await draft.fill("Conservar mi ejemplo");
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: "Siguiente: preparar una oferta" }).click();
    await expect(draft).toHaveValue("Conservar mi ejemplo");
    await expect(page).toHaveURL(/vista=guia#recuperar-clientes$/);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Siguiente: preparar una oferta" }).click();
    await expect(page.locator("h1")).toHaveText("Campañas dirigidas");
    await expect(page.locator("#contenido")).toBeFocused();
    await page.getByRole("button", { name: "Siguiente: revisar los costos" }).click();
    await expect(page.getByRole("region", { name: "Recorrido de ejemplo" })).toContainText("Paso 3 de 3");
    await page.goBack();
    await expect(page.locator("h1")).toHaveText("Campañas dirigidas");
    await expect(page.getByRole("region", { name: "Recorrido de ejemplo" })).toContainText("Paso 2 de 3");
    await page.getByRole("button", { name: "Siguiente: revisar los costos" }).click();
    await page.getByRole("button", { name: "Terminar y explorar", exact: true }).click();
    await expect(page).toHaveURL(/vista=libre#resumen$/);
    await page.goBack();
    await page.goBack();
    await page.getByRole("button", { name: "Explorar libremente", exact: true }).click();
    await expect(page.getByRole("region", { name: "Recorrido de ejemplo" })).toHaveCount(0);
    await expect(page.locator("h1")).toHaveText("Campañas dirigidas");
    await page.goBack();
    await expect(page.getByRole("region", { name: "Recorrido de ejemplo" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: "Recorrido de ejemplo" })).toContainText("Paso 2 de 3");
    await page.getByRole("button", { name: "Explorar libremente", exact: true }).click();
    await page.getByRole("button", { name: "Ver el recorrido", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("Recuperar clientes");
    await goto(page, "costos");
    await expect(page.getByRole("region", { name: "Recorrido de ejemplo" })).toHaveCount(0);
    await expect(page.getByText("Funciones según el plan", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Comparar planes", exact: true })).toHaveAttribute("href", "/precios");
    await finish(current);
  });
  await check("narrow dark-theme entry supports keyboard and free exploration", async () => {
    const current = await session(390, "dark");
    const page = current.page;
    await page.goto(`${origin}/negocio/?demo=1`);
    await expect(page.getByRole("button", { name: "Tema claro", exact: true })).toBeVisible();
    const explore = page.getByRole("button", { name: "Explorar todas las funciones", exact: true });
    await explore.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page).toHaveURL(/vista=libre#resumen$/);
    await page.getByRole("button", { name: "Ver el recorrido", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("Recuperar clientes");
    await page.screenshot({ path: path.join(artifacts, "guide-step-mobile-dark.png") });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.addScriptTag({ url: `${origin}/test-axe.js` });
    const result = await page.evaluate(() => axe.run(document.querySelector('[aria-label="Recorrido de ejemplo"]')));
    assert.deepEqual(result.violations.map(v => v.id), []);
    await finish(current);
  });
  const desktop = await session();
  const { page } = desktop;
  await goto(page);
  await check("daily navigation is concise and task groups expand with keyboard controls", async () => {
    await expect(nav(page).locator("details")).toHaveCount(4);
    assert.equal(await nav(page).getByRole("button").count(), 5);
    const summary = group(page, "Clientes y ventas").locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(nav(page).getByRole("button", { name: "Recuperar clientes", exact: true })).toBeVisible();
    await page.keyboard.press("Space");
    await expect(nav(page).getByRole("button", { name: "Recuperar clientes", exact: true })).toBeHidden();
    await expect(summary).toBeFocused();
  });
  await check("all 26 routes are reachable through the grouped menu", async () => {
    const { dailyNavigation, navigationGroups } = await import("../src/merchant-navigation.js");
    const { hashForPage } = await import("../src/navigation.js");
    for (const section of [{ items: dailyNavigation }, ...navigationGroups]) {
      for (const item of section.items) {
        const button = nav(page).getByRole("button", { name: item.label, exact: true });
        await navigateMerchant(page, item.label);
        await expect(button).toHaveAttribute("aria-current", "page");
        await expect(page).toHaveURL(new RegExp(`${hashForPage(item.page)}$`));
        await expect(page.locator("#contenido h1")).toBeVisible();
        await expect(page.getByRole("heading", { name: "El panel no pudo abrirse", exact: true })).toHaveCount(0);
      }
    }
  });
  await check("legacy deep links and browser history reveal the selected group", async () => {
    await goto(page, "recovery");
    await expect(page).toHaveURL(/#recuperar-clientes$/);
    await expect(nav(page).getByRole("button", { name: "Recuperar clientes", exact: true })).toBeVisible();
    await openGroup(page, "Programa y recompensas");
    await nav(page).getByRole("button", { name: "Reglas de puntos", exact: true }).click();
    await group(page, "Clientes y ventas").locator("summary").click();
    await page.goBack();
    await expect(nav(page).getByRole("button", { name: "Recuperar clientes", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(group(page, "Clientes y ventas")).toHaveAttribute("open", "");
    await group(page, "Programa y recompensas").locator("summary").click();
    await page.goForward();
    await expect(nav(page).getByRole("button", { name: "Reglas de puntos", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(group(page, "Programa y recompensas")).toHaveAttribute("open", "");
  });
  await check("unsaved drafts survive group toggles, canceled navigation and canceled history", async () => {
    await goto(page);
    await openGroup(page, "Clientes y ventas");
    await nav(page).getByRole("button", { name: "Recuperar clientes", exact: true }).click();
    const field = page.getByLabel("Nombre de la lista", { exact: true });
    await field.fill("Borrador que se conserva");
    let prompts = 0;
    const dismiss = async dialog => { prompts++; assert.match(dialog.message(), /cambios sin guardar/); await dialog.dismiss(); };
    page.on("dialog", dismiss);
    await openGroup(page, "Programa y recompensas");
    await nav(page).getByRole("button", { name: "Recuperar clientes", exact: true }).click();
    assert.equal(prompts, 0, "Disclosure and active page leave the draft untouched");
    await nav(page).getByRole("button", { name: "Reglas de puntos", exact: true }).click();
    assert.equal(prompts, 1);
    await expect(field).toHaveValue("Borrador que se conserva");
    await page.goBack();
    await expect.poll(() => prompts).toBe(2);
    await expect(page).toHaveURL(/#recuperar-clientes$/);
    await expect(field).toHaveValue("Borrador que se conserva");
    page.off("dialog", dismiss);
    page.once("dialog", dialog => dialog.accept());
    await nav(page).getByRole("button", { name: "Resumen", exact: true }).click();
    await expect(page).toHaveURL(/#resumen$/);
    await nav(page).getByRole("button", { name: "Recuperar clientes", exact: true }).click();
    await expect(field).not.toHaveValue("Borrador que se conserva");
  });
  await finish(desktop);

  await check("plan-restricted pages stay discoverable and retain their access check", async () => {
    const current = await session();
    const fixtures = {
      "/api/staff/me": { staff: { id: "fixture-owner", role: "OWNER", business_id: "fixture-business" } },
      "/api/admin/plan": { plan: "EMPRENDEDOR", features: {} },
      "/api/admin/region": { region: { country: "GT", currency: "GTQ", timezone: "America/Guatemala", locale: "es-GT", minorUnits: 2 } },
      "/api/admin/customer-enrollment": { business: { id: "fixture-business", name: "Negocio de prueba" } },
    };
    const requests = [];
    await current.context.route("**/api/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      requests.push(pathname);
      assert.equal(route.request().method(), "GET");
      assert.ok(Object.hasOwn(fixtures, pathname), `Unexpected fixture request: ${pathname}`);
      await route.fulfill({ json: fixtures[pathname] });
    });
    await current.page.goto(`${origin}/negocio/#campanas`);
    await expect(nav(current.page).getByRole("button", { name: "Reglas de puntos", exact: true })).toBeVisible();
    await expect(current.page.getByText("Esta función no está incluida en el plan actual de tu negocio.", { exact: true })).toBeVisible();
    assert.equal(await nav(current.page).getByRole("button", { includeHidden: true }).count(), 26);
    assert.equal(requests.includes("/api/admin/campaign-rules"), false);
    await finish(current);
  });

  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const current = await session(width, scheme);
    const { page } = current;
    await goto(page, "region");
    await check(`${width}px ${scheme}: selected group, mobile entry, focus, theme and accessible render`, async () => {
      const mobile = width === 390;
      if (mobile) {
        await expect(nav(page)).toBeHidden();
        await page.getByRole("button", { name: "Cambiar sección del negocio", exact: true }).click();
      }
      await expect(nav(page).getByRole("button", { name: "Región del negocio", exact: true })).toBeVisible();
      await expect(group(page, "Configuración y equipo")).toHaveAttribute("open", "");
      await expect(page.getByRole("heading", { name: "Región del negocio", exact: true })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "País", exact: true })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", scheme);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.addScriptTag({ url: `${origin}/test-axe.js` });
      const violations = await page.evaluate(async () => (await window.axe.run(document.querySelector(".sidebar"), { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Generated temp directory and fixed viewport/theme names; no external input.
      await fs.writeFile(path.join(artifacts, `axe-${width}-${scheme}.json`), JSON.stringify(violations, null, 2));
      assert.deepEqual(violations, []);
      await page.screenshot({ path: path.join(artifacts, `navigation-${width}-${scheme}.png`), fullPage: true });
      await page.getByRole("button", { name: /^Tema / }).click();
      await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", scheme === "light" ? "dark" : "light");
      await page.getByRole("button", { name: /^Tema / }).click();
      await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", scheme);
      if (mobile) {
        await group(page, "Configuración y equipo").locator("summary").click();
        await page.getByRole("button", { name: "Cerrar menú del negocio", exact: true }).click();
        await page.getByRole("button", { name: "Cambiar sección del negocio", exact: true }).click();
        await expect(nav(page).getByRole("button", { name: "Región del negocio", exact: true })).toBeVisible();
        await openGroup(page, "Clientes y ventas");
        await nav(page).getByRole("button", { name: "Recuperar clientes", exact: true }).click();
        await expect(nav(page)).toBeHidden();
        await expect(page.locator("#contenido")).toBeFocused();
        await page.getByRole("button", { name: "Cambiar sección del negocio", exact: true }).click();
        await expect(nav(page).getByRole("button", { name: "Recuperar clientes", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(nav(page)).toBeHidden();
        await expect(page.getByRole("button", { name: "Cambiar sección del negocio", exact: true })).toBeFocused();
        const field = page.getByLabel("Nombre de la lista", { exact: true });
        await field.fill("Borrador móvil");
        await page.getByRole("button", { name: "Cambiar sección del negocio", exact: true }).click();
        page.once("dialog", dialog => dialog.dismiss());
        await nav(page).getByRole("button", { name: "Resumen", exact: true }).click();
        await expect(nav(page)).toBeVisible();
        await expect(field).toHaveValue("Borrador móvil");
        page.once("dialog", dialog => dialog.accept());
        await nav(page).getByRole("button", { name: "Resumen", exact: true }).click();
        await expect(nav(page)).toBeHidden();
        await expect(page).toHaveURL(/#resumen$/);
      }
      await goto(page);
      await page.reload();
      await expect(page.locator("#contenido h1")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-mantine-color-scheme", scheme);
      if (mobile) await page.getByRole("button", { name: "Cambiar sección del negocio", exact: true }).click();
      await page.screenshot({ path: path.join(artifacts, `daily-${width}-${scheme}.png`), fullPage: false });
    });
    await finish(current);
  }
  assert.equal(checks, 11, "All navigation checks ran; none were skipped");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed filename inside the generated test-only temp directory.
  await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify({ checks, passed: true, artifacts }, null, 2));
  console.log(`${checks} navigation browser checks passed. Artifacts: ${artifacts}`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
