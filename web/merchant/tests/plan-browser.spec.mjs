// Actual merchant build in demo mode; the billing scenarios come from ?plan= and no request may
// reach a PF API. Covers "Plan y facturación": the request-form fallback when billing is not
// deployed (404), the trial picker with per-branch math and the checkout return (poll →
// "Tu plan Impulsa está activo"), a pending checkout, the change and cancel dialogs, the
// past-due and canceled states, the banner CTA leading to #plan, and axe at 1280/390.
import strictAssert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { chromium, expect } from "@playwright/test";
import { build } from "vite";

let checks = 0;
const assert = {
  equal: (...args) => {
    strictAssert.equal(...args);
    checks++;
  },
  deepEqual: (...args) => {
    strictAssert.deepEqual(...args);
    checks++;
  },
  match: (...args) => {
    strictAssert.match(...args);
    checks++;
  },
};
const merchant = path.resolve(import.meta.dirname, "..");
const project = path.resolve(merchant, "../..");
const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pf-plan-browser-"));
await build({
  root: merchant,
  configFile: path.join(merchant, "vite.config.js"),
  build: { outDir, emptyOutDir: true },
  logLevel: "warn",
});
const app = express();
app.get(["/negocio/", "/demostracion/"], (_req, res) =>
  res.sendFile(path.join(outDir, "index.html")),
);
app.get("/runtime-config.js", (_req, res) =>
  res.type("js").send("window.__PF_RUNTIME_CONFIG__={};"),
);
app.use("/negocio", express.static(outDir));
app.use(express.static(path.join(project, "public")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const axeSource = await fs.readFile(
  path.join(merchant, "node_modules/axe-core/axe.min.js"),
  "utf8",
);
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 950 },
    serviceWorkers: "block",
  });
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) {
      requests.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  // Optional scope: a modal is audited on its own, since the overlay darkens the page behind it.
  const axe = async (scope = null) => {
    await page.evaluate(axeSource);
    return page.evaluate(
      async (selector) =>
        (
          await window.axe.run(selector ? document.querySelector(selector) : document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      scope,
    );
  };
  const heading = page.getByRole("heading", { name: "Plan y facturación", exact: true, level: 1 });

  // Billing not deployed (404): the page keeps the wave-1 request form and the fallback copy.
  await page.goto(`${origin}/negocio/?demo=1#plan`);
  await expect(heading).toBeVisible();
  await expect(page.getByTestId("billing-unavailable")).toContainText(
    "El pago con tarjeta estará disponible pronto",
  );
  await expect(page.getByRole("button", { name: "Enviar solicitud", exact: true })).toBeVisible();
  assert.equal(await page.getByTestId("plan-picker").count(), 0);
  assert.equal(
    await page.getByTestId("plan-status").count(),
    0,
    "no trial state either, so no status card",
  );
  assert.deepEqual(await axe(), []);

  // Trial without a subscription: status card, the three tiers with per-branch math, FEL note.
  await page.goto(`${origin}/negocio/?demo=1&plan=sin-cobro#plan`);
  await expect(heading).toBeVisible();
  const status = page.getByTestId("plan-status");
  await expect(status).toContainText("Prueba gratis de Conecta");
  await expect(status).toContainText("Te quedan 9 días.");
  assert.equal(await status.getAttribute("data-status"), "trial");
  const picker = page.getByTestId("plan-picker");
  await expect(picker).toContainText(
    "Por ahora no se emite factura electrónica (FEL); cada cobro queda registrado aquí.",
  );
  await expect(picker).toContainText("tu negocio tiene 1 sucursal");
  for (const [code, price] of [
    ["EMPRENDEDOR", "USD 39.00"],
    ["NEGOCIO", "USD 79.00"],
    ["EMPRESA", "USD 129.00"],
  ]) {
    const option = page.getByTestId(`plan-option-${code}`);
    await expect(option).toContainText(price);
    await expect(option).toContainText(`${price} al mes · 1 sucursal`);
  }
  await expect(page.getByTestId("plan-option-EMPRENDEDOR")).toContainText("En prueba");
  assert.equal(await page.getByRole("button", { name: /^Pagar con tarjeta el plan/ }).count(), 3);
  assert.equal(await page.getByTestId("billing-unavailable").count(), 0);
  assert.equal(
    await page.getByText("Plan Conecta", { exact: true }).count(),
    1,
    "the footer shows the trial plan",
  );
  assert.deepEqual(await axe(), []);

  // Checkout: POST → location.assign(url) → return with ?checkout= → poll → active plan.
  await page
    .getByRole("button", { name: "Pagar con tarjeta el plan Impulsa", exact: true })
    .click();
  await page.waitForURL(/plan=activa/);
  await expect(page.getByTestId("checkout-result")).toContainText("Tu plan Impulsa está activo");
  assert.equal(await page.getByTestId("checkout-result").getAttribute("data-tone"), "teal");
  await expect(page.getByTestId("plan-status")).toContainText("Plan Impulsa activo");
  await expect(page.getByTestId("plan-status")).toContainText("USD 79.00 (1 sucursal × USD 79.00)");
  assert.equal(await page.getByTestId("plan-status").getAttribute("data-status"), "active");
  assert.equal(
    await page.getByRole("link", { name: "Ver comprobante", exact: true }).count(),
    2,
    "the invoice list carries the FEL links",
  );
  await expect(page.getByTestId("plan-picker")).toContainText("Cambiar de plan");
  assert.equal(
    await page.getByText("Plan Impulsa", { exact: true }).count(),
    1,
    "the footer follows the paid plan",
  );
  assert.match(new URL(page.url()).hash, /^#plan$/);

  // A pending checkout can be resumed.
  await page.goto(`${origin}/negocio/?demo=1&plan=pago-pendiente#plan`);
  await expect(page.getByTestId("checkout-pending")).toContainText("Tienes un pago en curso");
  await expect(
    page
      .getByTestId("checkout-pending")
      .getByRole("button", { name: "Continuar el pago", exact: true }),
  ).toBeVisible();

  // Change plan: the dialog explains the prorated charge; cancel: the dialog shows the end date.
  await page.goto(`${origin}/negocio/?demo=1&plan=activa#plan`);
  await expect(page.getByTestId("plan-status")).toContainText("Plan Impulsa activo");
  await page.getByRole("button", { name: "Cambiar a Expande", exact: true }).click();
  const change = page.getByRole("dialog", { name: "Cambiar a Expande ahora", exact: true });
  await expect(change).toContainText("diferencia proporcional");
  await expect(change).toContainText("USD 129.00 al mes");
  await change
    .getByRole("button", { name: "Cambiar a Expande y pagar la diferencia", exact: true })
    .click();
  await expect(page.getByTestId("billing-notice")).toContainText("Tu plan Expande está activo");
  await expect(page.getByTestId("plan-status")).toContainText("Plan Expande activo");
  await page.getByRole("button", { name: "Cambiar a Impulsa", exact: true }).click();
  const downgrade = page.getByRole("dialog", {
    name: "Cambiar a Impulsa al final del período",
    exact: true,
  });
  await expect(downgrade).toContainText("no hay reembolso");
  await downgrade.getByRole("button", { name: "Volver", exact: true }).click();
  await expect(downgrade).toBeHidden();
  await page.getByRole("button", { name: "Cancelar al final del período", exact: true }).click();
  const cancel = page.getByRole("dialog", { name: "Cancelar al final del período", exact: true });
  await expect(cancel).toContainText("sigue activo hasta el");
  await expect(cancel).toContainText("No se reembolsan los días ya pagados.");
  // Let the modal's fade-in finish: mid-transition opacity reads as low contrast to axe.
  await page.waitForTimeout(400);
  assert.deepEqual(await axe('[role="dialog"]'), []);
  await cancel.getByRole("button", { name: "Cancelar al final del período", exact: true }).click();
  await expect(page.getByTestId("billing-notice")).toContainText(
    "Plan cancelado al final del período",
  );
  await expect(page.getByTestId("plan-status")).toContainText("Plan Expande cancelado");
  assert.equal(await page.getByTestId("plan-status").getAttribute("data-status"), "canceled");

  // Past due and canceled states explain what happens next; no picker, no new checkout.
  await page.goto(`${origin}/negocio/?demo=1&plan=pago-fallido#plan`);
  await expect(page.getByTestId("plan-status")).toContainText("El último cobro no se completó");
  await expect(page.getByTestId("plan-status")).toContainText("volverá a intentar");
  assert.equal(await page.getByTestId("plan-status").getAttribute("data-status"), "past_due");
  assert.equal(await page.getByTestId("plan-picker").count(), 0);
  await expect(
    page.getByRole("button", { name: "Cancelar al final del período", exact: true }),
  ).toBeVisible();
  await page.goto(`${origin}/negocio/?demo=1&plan=cancelada#plan`);
  await expect(page.getByTestId("plan-status")).toContainText("Plan Impulsa cancelado");
  await expect(page.getByTestId("plan-status")).toContainText("Sigue activo hasta el");
  assert.equal(
    await page.getByRole("button", { name: "Cancelar al final del período", exact: true }).count(),
    0,
  );

  // A canceled return and the banner CTA.
  await page.goto(
    `${origin}/negocio/?demo=1&plan=sin-cobro#plan?checkout=chk_demo_impulsa&resultado=cancelado`,
  );
  await expect(page.getByTestId("checkout-result")).toContainText("Pago cancelado");
  assert.equal(
    await page.getByRole("button", { name: /^Pagar con tarjeta el plan/ }).count(),
    3,
    "the owner can try again",
  );
  await page.goto(`${origin}/negocio/?demo=1&plan=sin-cobro#resumen`);
  const banner = page.getByTestId("trial-banner");
  await expect(banner).toContainText("Te quedan 9 días de prueba gratis con Conecta.");
  await banner.getByRole("button", { name: "Mejorar plan", exact: true }).click();
  await expect(heading).toBeVisible();
  assert.equal(
    await page.getByRole("dialog").count(),
    0,
    "with checkout available the CTA opens #plan, not the request form",
  );
  assert.match(new URL(page.url()).hash, /^#plan$/);

  // Mobile.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/negocio/?demo=1&plan=activa#plan`);
  await expect(page.getByTestId("plan-status")).toContainText("Plan Impulsa activo");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(await axe(), []);
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(JSON.stringify({ kind: "plan-browser", checks, passed: true }));
  console.log(
    "Plan browser: fallback form on 404, trial picker and checkout return, pending checkout, change and cancel dialogs, past-due and canceled states, banner CTA and axe at 1280/390 passed.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(outDir, { recursive: true, force: true });
}
