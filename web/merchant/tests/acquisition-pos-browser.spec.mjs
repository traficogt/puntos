import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
  await page.goto(`${origin}/demostracion/#referidos`);
  await page.getByRole("heading",{name:"De una recomendación a una primera compra"}).waitFor();
  await page.getByLabel("Puntos para quien recomienda",{exact:true}).fill("80");
  page.once("dialog", d=>d.dismiss());
  await page.getByRole("button",{name:"Resumen",exact:true}).click();
  assert.equal(await page.getByLabel("Puntos para quien recomienda",{exact:true}).inputValue(),"80");
  await page.getByRole("button",{name:"Guardar incentivos",exact:true}).click();
  await page.getByRole("button",{name:"Guardar incentivos",exact:true}).waitFor();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Guardar incentivos' && b.disabled));
  await page.getByRole("button",{name:"Conectar caja",exact:true}).click();
  await page.getByRole("heading",{name:"Conectar caja",exact:true}).waitFor();
  await page.getByLabel("ID de la venta",{exact:false}).fill("venta-prueba-1");
  await page.getByLabel("Origen de la venta",{exact:false}).fill("caja-demo");
  await page.getByLabel("Teléfono que aparece en la venta",{exact:false}).fill("55554444");
  await page.getByLabel("Importe pagado (GTQ)",{exact:false}).fill("100");
  await page.getByLabel("Cantidad de artículos",{exact:false}).fill("2");
  await page.getByRole("button",{name:/Comprobar muestra/}).click();
  await page.getByText(/No se asignaron puntos/).first().waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:"/var/lib/puntos/releases/spanish-growth-20261110/pos-mobile.png",fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const axe=await fs.readFile(path.resolve(import.meta.dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
  await page.evaluate(axe);
  const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations);
  await fs.writeFile('/var/lib/puntos/releases/spanish-growth-20261110/axe-pos-mobile.json',JSON.stringify(violations,null,2));
  assert.deepEqual(violations,[]);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    "Referrals save/draft protection and POS preflight passed; zero real API requests.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
