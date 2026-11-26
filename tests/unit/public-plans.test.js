import test from "node:test";
import assert from "node:assert/strict";
import {
  renderPlanComparison,
  publicPlanCatalog,
} from "../../src/app/services/public-plan-service.js";
import { DEFAULT_BILLING_CATALOG, listPlans } from "../../src/utils/plan.js";
test("public catalog publishes the quetzal and USD prices per branch per month with IVA included and the trial, never the provisional GTQ figures", () => {
  const data = publicPlanCatalog(listPlans({ NEGOCIO: { analytics: false } }));
  assert.equal(data.pricing_status, "published");
  assert.equal(data.comparison_currency, "USD");
  assert.equal(data.local_currency, "GTQ");
  assert.equal(data.pricing_unit, "branch_month");
  assert.deepEqual(data.tax, { iva_included: true, rate: 0.12 });
  assert.deepEqual(
    data.plans.map((p) => [p.id, p.name, p.pricing.gtq_monthly, p.pricing.monthly, p.pricing.per]),
    [
      ["EMPRENDEDOR", "Conecta", 300, 39, "branch_month"],
      ["NEGOCIO", "Impulsa", 630, 79, "branch_month"],
      ["EMPRESA", "Expande", 1030, 129, "branch_month"],
    ],
  );
  assert.equal(data.plans[0].pricing.currency, "USD", "`pricing.monthly` stays USD (wave 1)");
  assert.equal(data.plans[0].limits.activeCustomers, 300);
  assert.equal(data.plans[1].features.analytics, false);
  assert.ok(!data.plans[1].feature_list.includes("Análisis de resultados"));
  assert.ok(data.plans[1].feature_list.includes("Automatizaciones"));
  assert.deepEqual(data.trial, {
    days: 14,
    plan: "EMPRENDEDOR",
    plan_name: "Conecta",
    requires_card: false,
    url: "/prueba/",
  });
  assert.equal(data.plans[0].cta.trial_url, "/prueba/");
  assert.equal(data.plans[1].cta.trial_url, "/prueba/?plan=NEGOCIO");
  assert.equal(data.reference_gtq, null);
  assert.equal(data.plans[0].pricing.reference_gtq_monthly, null);
  assert.doesNotMatch(
    JSON.stringify(data),
    /pricing_gtq|\b(149|399|999|1490|3990|9990)\b|included_messages|overage/,
  );
  const html = renderPlanComparison(data);
  assert.match(html, /Precio en Guatemala<\/th><td>Q300 al mes por sucursal<\/td>/);
  assert.match(html, /Q630 al mes por sucursal/);
  assert.match(html, /Q1,030 al mes por sucursal/);
  assert.match(html, /Fuera de Guatemala<\/th><td>USD 39 al mes por sucursal<\/td>/);
  assert.match(html, /USD 129 al mes por sucursal/);
  assert.match(html, /Impuestos<\/th><td>IVA \(12 %\) incluido<\/td>/);
  assert.match(html, /href="\/prueba\/"[^>]*data-umami-event="trial_start_click"/);
  assert.match(html, /Prueba 14 días gratis/);
  assert.match(html, /Empezar con Impulsa/);
  assert.match(html, /Hablar con nosotros/);
  assert.doesNotMatch(
    html,
    /Q149|Q399|Q999|ilimitad|cotización|en revisión|sin impuestos|por escrito|Referencia/i,
  );
});
test("a dated GTQ reference stays in the payload for compatibility but never renders: the quetzal amount is a fixed list price", () => {
  const data = publicPlanCatalog(listPlans(), {
    gtqReference: { rate: 7.7, as_of: "2026-11-25" },
  });
  assert.deepEqual(data.reference_gtq, { rate: 7.7, as_of: "2026-11-25" });
  assert.equal(data.plans[0].pricing.reference_gtq_monthly, 300);
  assert.equal(data.plans[0].pricing.gtq_monthly, 300, "the list price, not the conversion");
  assert.equal(data.plans[1].pricing.reference_gtq_monthly, 608);
  assert.equal(data.plans[1].pricing.gtq_monthly, 630);
  const html = renderPlanComparison(data);
  assert.doesNotMatch(html, /tipo de cambio|Referencia|608/);
  assert.match(html, /Q630 al mes por sucursal/);
  assert.equal(publicPlanCatalog(listPlans(), { gtqReference: null }).reference_gtq, null);
});
test("plan rendering escapes unexpected catalog text and does not claim excluded capabilities", () => {
  const data = publicPlanCatalog(listPlans({ NEGOCIO: { analytics: false } }));
  data.plans[0].name = "<script>bad</script>";
  const html = renderPlanComparison(data);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Precio en Guatemala<\/th>/);
  assert.match(html, /Confirmar alcance/);
});

test("plans page serves live catalog without redirect loops and canonicalizes aliases", async (t) => {
  const { default: express } = await import("express");
  const { createPublicPlans } = await import("../../src/middleware/public-plans.js");
  const { fileURLToPath } = await import("node:url");
  const app = express();
  app.use(
    createPublicPlans({
      publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
      marketingOrigin: "https://pf.example",
      appOrigin: "https://app.pf.example",
      listPlans: async () => listPlans(),
      getBillingCatalog: async () => DEFAULT_BILLING_CATALOG,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const page = await fetch(origin + "/precios", { redirect: "manual" });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store");
  const body = await page.text();
  assert.match(body, /Q630 al mes por sucursal/);
  assert.match(body, /USD 79 al mes por sucursal/);
  assert.match(
    body,
    /Precios con IVA \(12 %\) incluido\. Cada cobro queda registrado en tu panel; por ahora no se emite factura electrónica \(FEL\)/,
  );
  assert.match(body, /Prueba 14 días gratis/);
  assert.doesNotMatch(
    body,
    /<!--PLAN_COMPARISON-->|Q149|Q399|Q999|Solicitar cotización|sin impuestos|por escrito/,
  );
  const { get } = await import("node:http");
  const appPage = await new Promise((resolve, reject) =>
    get(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path: "/precios?from=setup",
        headers: { Host: "app.pf.example" },
      },
      (res) => {
        res.resume();
        resolve(res);
      },
    ).on("error", reject),
  );
  assert.equal(appPage.statusCode, 301);
  assert.equal(appPage.headers.location, "https://pf.example/precios?from=setup");
  for (const path of ["/precios/", "/precios.html"]) {
    const response = await fetch(origin + path, { redirect: "manual" });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("location"), "/precios");
  }
});
