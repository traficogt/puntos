// Isolated component browser check: no application server, database or POS.
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const output = "/tmp/pf-pos-installation-check";
await mkdir(output, { recursive: true });
const entry = `import React from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme, Container } from "@mantine/core";
import "@mantine/core/styles.css";
import "/src/styles.css";
import PosConnect from "/src/PosConnect.jsx";
const theme = createTheme({primaryColor:"terra",primaryShade:7,autoContrast:true,fontFamily:"Inter, sans-serif",headings:{fontFamily:"Bricolage Grotesque, sans-serif"},colors:{terra:["#fff2ed","#ffded1","#f8b9a2","#ef9678","#df7654","#cb5e3c","#b94d2f","#a43d28","#8d3322","#752b1f"]}});
createRoot(document.getElementById("root")).render(React.createElement(MantineProvider,{theme,forceColorScheme:new URLSearchParams(location.search).get("theme") || "light"},React.createElement(Container,{size:"lg",py:"xl"},React.createElement(PosConnect,{features:{external_awards:true},onDirty:value => {window.__dirty=value}}))));`;
const vite = await createServer({
  configFile: false, root, logLevel: "error", plugins: [react(), {
    name: "isolated-pos-check",
    resolveId(id, importer) {
      if (id === "/__pos-entry.jsx") return "\0pos-entry.jsx";
      if (id === "/lib.js") return "\0pos-base-api";
    },
    load(id) {
      if (id === "\0pos-entry.jsx") return entry;
      if (id === "\0pos-base-api") return "export async function api(path,options={}) { return window.__posApi(path,options); }";
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!/^\/(demostracion|negocio)\//.test(req.url || "")) return next();
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml(req.url, '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comprobación aislada de caja</title></head><body><main id="root"></main><script type="module" src="/__pos-entry.jsx"></script></body></html>'));
      });
    },
  }], server: { host: "127.0.0.1", port: 0 },
});
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [], requests = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => { if (new URL(r.url()).pathname.startsWith("/api/")) requests.push(r.url()); });
  await page.goto(`${origin}/demostracion/`);
  await page.getByRole("heading", { name: "Conectar caja", exact: true }).waitFor().catch(async error => {
    console.error("Initial render:", await page.locator("body").innerText(), errors);
    throw error;
  });
  const select = async (label, option) => { await page.getByRole("combobox", { name: label, exact: true }).click(); await page.getByRole("option", { name: option, exact: true }).click(); };
  await select("Sistema de caja", "Odoo");
  await select("Alojamiento de Odoo", "Odoo Online");
  await select("Plan de Odoo Online", "Standard");
  await page.getByRole("heading", { name: "Confirma el plan de Odoo Online" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Preparar Integración por API", exact: true }).count(), 0);
  await select("Plan de Odoo Online", "Custom");
  await page.getByRole("heading", { name: "Prepara un adaptador con tu integrador" }).waitFor();
  await page.getByRole("button", { name: "Paquete para el instalador", exact: true }).click();
  await page.getByRole("button", { name: "Descargar paquete JSON", exact: true }).click();
  await page.getByText(/Versión del sistema: escribe/).waitFor();
  await page.getByLabel("Versión exacta del POS", { exact: true }).fill("19.0");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar paquete JSON", exact: true }).click();
  const download = await downloadPromise;
  const pkg = JSON.parse(await (await import("node:fs/promises")).readFile(await download.path(), "utf8"));
  assert.equal(pkg.profile.version, "19.0");
  assert.equal(pkg.profile.deployment, "online");
  assert.equal(pkg.configurationTemplate.enabled, false);
  assert.ok(pkg.acceptance.every(step => step.status === "pending"));
  assert.equal(await page.evaluate(() => window.__dirty), false);
  await select("Alojamiento de Odoo", "Servidor del negocio / autohospedado");
  await page.getByLabel("Versión exacta del POS", { exact: true }).fill("18.0");
  await page.getByRole("heading", { name: "Instala el conector de Odoo 18.0" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Descargar módulo Odoo 18.0 (.zip)" }).getAttribute("href"), "/api/public/integrations/odoo/18/pf_pos_connector.zip");
  await page.screenshot({ path: `${output}/odoo18-addon.png`, fullPage: true, animations: "disabled" });
  await page.getByLabel("Versión exacta del POS", { exact: true }).fill("19.0");
  assert.equal(await page.getByRole("link", { name: "Descargar módulo Odoo 18.0 (.zip)" }).count(), 0);
  await page.getByRole("button", { name: "Comprobar formato local", exact: true }).click();
  await page.getByText("Formato válido en este navegador.", { exact: false }).waitFor();
  await page.getByLabel("Venta ficticia en formato PF", { exact: true }).fill('{"currency":"USD"}');
  assert.equal(await page.getByText("Formato válido en este navegador.", { exact: false }).count(), 0);
  await page.getByRole("button", { name: "Comprobar formato local", exact: true }).click();
  await page.getByText("La moneda de la muestra debe ser GTQ.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__dirty), true);
  await page.getByRole("heading", { name: "Devoluciones y conciliación", exact: true }).waitFor();
  await page.getByText("DEV-003", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Revisión de devolución parcial" }).isDisabled(), true);
  await page.getByRole("button", { name: "Comprobar DEV-002 de nuevo" }).click();
  await page.getByRole("dialog", { name: "Reintentar conciliación" }).waitFor();
  await page.getByRole("button", { name: "Reintentar ahora", exact: true }).click();
  await page.getByText("La devolución sigue pendiente.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Comprobar muestra", exact: true }).click();
  await page.getByText("Muestra válida · cliente encontrado", { exact: true }).waitFor();
  await page.getByLabel("Teléfono que aparece en la venta").fill("55559999");
  assert.equal(await page.getByText("Muestra válida · cliente encontrado", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Comprobar muestra", exact: true }).click();
  await page.getByText("La muestra necesita una corrección", { exact: true }).waitFor();
  await page.getByLabel("Teléfono que aparece en la venta").fill("55554444");
  await page.getByRole("button", { name: "Comprobar muestra", exact: true }).click();
  await page.getByText("Muestra válida · cliente encontrado", { exact: true }).waitFor();
  await page.screenshot({ path: `${output}/pos-desktop-light.png`, fullPage: true, animations: "disabled" });
  assert.equal(await page.locator('a[href^="/administracion/"],a[href^="/equipo/"]').count(), 0);
  await page.getByLabel("Habilitar esta conexión para recibir o importar ventas", { exact: true }).check();
  await page.getByRole("button", { name: "Guardar conexión", exact: true }).click();
  await page.getByText("Demostración: configuración guardada solo en esta pestaña.", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/demostracion/?theme=dark`);
  await page.getByRole("heading", { name: "Conectar caja", exact: true }).waitFor();
  await select("Sistema de caja", "Loyverse");
  await page.getByRole("button", { name: "Requisitos y trabajo sin conexión", exact: true }).click();
  await page.getByText(/El recibo aporta customer_id/).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: `${output}/pos-mobile-dark.png`, fullPage: true, animations: "disabled" });
  await page.addScriptTag({ path: path.join(root, "node_modules/axe-core/axe.min.js") });
  const accessibility = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }));
  assert.deepEqual(accessibility.violations.map(v => ({ id: v.id, impact: v.impact })), []);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);

  // Real-mode UI is isolated behind a stub API. Changing the snapshot after
  // initial load must stop the PUT, preserving the other owner's changes.
  await page.addInitScript(() => {
    const saved = { enabled: false, mode: "api", automatic: false, loyverse: { configured: false } };
    window.__calls = [];
    window.__posApi = async (path, options = {}) => {
      window.__calls.push([path, options.method || "GET"]);
      if (path.startsWith("/api/admin/pos/refunds")) return { refunds: [], summary: { total: 0, pending: 0, reconciled: 0 }, limit: 50 };
      if (options.method === "PUT") throw new Error("Unexpected configuration overwrite");
      return { integration: { ...saved, enabled: window.__conflict === true } };
    };
  });
  await page.goto(`${origin}/negocio/`);
  await page.getByRole("heading", { name: "Conectar caja", exact: true }).waitFor();
  await page.getByLabel("Habilitar esta conexión para recibir o importar ventas", { exact: true }).check();
  await page.evaluate(() => { window.__conflict = true; });
  await page.getByRole("button", { name: "Guardar conexión", exact: true }).click();
  await page.getByText("La conexión cambió en otra sesión.", { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.__calls.filter(([, method]) => method === "PUT").length), 0);
  console.log("POS installation: vendor/plan guidance, version requirement, inert download, local JSON validation, dirty state, preflight, mobile layout/axe and concurrency guard passed; zero API requests.");
} finally { await browser.close(); await vite.close(); }
