// Isolated browser regression: delayed local saves, no API/database/provider.
import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const entry = `import React from "react";
import {createRoot} from "react-dom/client";
import {MantineProvider,Container} from "@mantine/core";
import "@mantine/core/styles.css";
import "/src/styles.css";
import Economics from "/src/Economics.jsx";
import {demoEconomics} from "/src/demo-economics.js";
window.__economicCalls=[];
window.__economicsApi=async(path,options={})=>{
 const method=options.method||"GET";window.__economicCalls.push([path,method]);
 if(method==="PUT")await new Promise(resolve=>{window.__resolveEconomicSave=resolve;});
 const result=demoEconomics(new URL(path,location.origin),options);
 if(window.__emptyRewards&&method==="GET"){result.rewards=[];result.rewards_pagination.total=0;}
 return result;
};
createRoot(document.getElementById("root")).render(React.createElement(MantineProvider,null,React.createElement(Container,{size:"lg",py:"xl"},React.createElement(Economics,{features:{analytics:true}}))));`;
const vite = await createServer({ configFile: false, root, logLevel: "error", plugins: [react(), {
  name: "isolated-economics-check",
  resolveId(id) { if (id === "/__economics-entry.jsx") return "\0economics-entry.jsx"; if (id === "/lib.js") return "\0economics-api"; },
  load(id) { if (id === "\0economics-entry.jsx") return entry; if (id === "\0economics-api") return "export const api=(path,options)=>window.__economicsApi(path,options);"; },
  configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/negocio/")) return next();
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml(req.url, '<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Comprobación de costos</title></head><body><main id="root"></main><script type="module" src="/__economics-entry.jsx"></script></body></html>'));
  }); }
}], server: { host: "127.0.0.1", port: 0 } });
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()); });
  await page.goto(`${origin}/negocio/`);
  await page.getByRole("button", { name: "Editar costo de Café de la casa" }).click();
  await page.getByLabel("Tu costo por unidad (Q)", { exact: true }).fill("7.5");
  await page.getByRole("button", { name: "Guardar costo", exact: true }).click();
  await page.waitForFunction(() => typeof window.__resolveEconomicSave === "function");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole("dialog", { name: "Costo unitario de la recompensa" }).isVisible(), true, "Escape must not dismiss an in-flight cost save");
  await page.locator(".mantine-Modal-overlay").click({ position: { x: 5, y: 5 }, force: true });
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole("dialog").isVisible(), true, "Outside click must not dismiss an in-flight save");
  await page.evaluate(() => { window.__resolveEconomicSave(); window.__resolveEconomicSave = null; });
  await page.getByText("Costo de Café de la casa guardado para futuros canjes.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Editar supuestos", exact: true }).click();
  await page.getByLabel("Margen bruto supuesto (%)", { exact: true }).fill("35");
  await page.getByRole("button", { name: "Guardar supuestos", exact: true }).click();
  await page.waitForFunction(() => typeof window.__resolveEconomicSave === "function");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole("dialog", { name: "Tus supuestos para estimar" }).isVisible(), true);
  await page.evaluate(() => { window.__resolveEconomicSave(); window.__resolveEconomicSave = null; });
  await page.getByText("Supuestos guardados. Las estimaciones usan estos valores; los costos históricos no cambian.", { exact: true }).waitFor();
  await page.evaluate(() => { window.__emptyRewards = true; });
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await page.getByRole("link", { name: "Administrar recompensas" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Administrar recompensas" }).getAttribute("href"), "/administracion/?seccion=recompensas");
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log("Economics browser: delayed cost/assumption saves resist Escape and outside clicks; canonical rewards link; zero API requests passed.");
} finally { await browser.close(); await vite.close(); }
