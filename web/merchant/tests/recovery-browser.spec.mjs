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
  await page.goto(`${origin}/merchant/?demo=1#recovery`);
  await page.getByRole("heading",{name:"Recuperar clientes",exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname,"/demostracion/");
  assert.equal(new URL(page.url()).hash,"#recuperar-clientes");
  await page.getByLabel("Nombre de la lista",{exact:true}).fill("Seguimiento de prueba");
  page.once("dialog",d=>d.dismiss());
  await page.getByRole("button",{name:"Resumen",exact:true}).click();
  assert.equal(await page.getByLabel("Nombre de la lista",{exact:true}).inputValue(),"Seguimiento de prueba");
  await page.getByRole("button",{name:"Guardar lista de seguimiento",exact:true}).click();
  await page.getByRole("heading",{name:"Seguimiento de prueba",exact:true}).waitFor();
  await page.getByRole("button",{name:"Ya lo contacté",exact:true}).first().click();
  page.once("dialog",d=>d.dismiss());
  await page.getByRole("button",{name:"Clientes de septiembre · ejemplo",exact:true}).click();
  assert.equal(await page.getByRole("checkbox",{name:/Confirmo que este cliente/}).isVisible(),true);
  const confirm=page.getByRole("button",{name:"Registrar contacto",exact:true});
  assert.equal(await confirm.isDisabled(),true);
  await page.getByRole("checkbox",{name:/Confirmo que este cliente/}).check();
  await confirm.click();await page.getByText(/Contactado ·/).first().waitFor();
  await page.getByRole("button",{name:"Omitir",exact:true}).first().click();
  await page.getByText("Omitido",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Clientes de septiembre · ejemplo",exact:true}).click();
  await page.getByText(/Volvió el/).waitFor();
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:"/var/lib/puntos/releases/spanish-growth-20261110/recovery-desktop.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("button",{name:"Tema oscuro",exact:true}).click();
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:"/var/lib/puntos/releases/spanish-growth-20261110/recovery-mobile.png",fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const axe = await fs.readFile(path.resolve(import.meta.dirname,"../node_modules/axe-core/axe.min.js"),"utf8");
  await page.evaluate(axe);
  const violations = await page.evaluate(async () => (await window.axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21aa"]}})).violations);
  await fs.writeFile("/var/lib/puntos/releases/spanish-growth-20261110/axe-recovery-mobile.json",JSON.stringify(violations,null,2));
  assert.deepEqual(violations,[]);
  await page.reload();
  await page.getByRole("heading",{name:"Recuperar clientes",exact:true}).waitFor();
  assert.equal(await page.getByRole("button",{name:"Seguimiento de prueba",exact:true}).count(),0);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    "Recovery: create, draft guard, confirmed contact, skip, observed results, demo reload isolation and zero real API requests passed.",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
