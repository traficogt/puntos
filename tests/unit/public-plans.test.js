import test from "node:test";
import assert from "node:assert/strict";
import {
  renderPlanComparison,
  publicPlanCatalog,
} from "../../src/app/services/public-plan-service.js";
import { DEFAULT_BILLING_CATALOG, listPlans } from "../../src/utils/plan.js";
test("public catalog publishes USD prices per branch per month and the trial, never the provisional GTQ figures", () => {
  const data = publicPlanCatalog(listPlans({ NEGOCIO: { analytics: false } }));
  assert.equal(data.pricing_status, "published");
  assert.equal(data.comparison_currency, "USD");
  assert.equal(data.pricing_unit, "branch_month");
  assert.deepEqual(
    data.plans.map((p) => [p.id, p.name, p.pricing.monthly, p.pricing.per]),
    [
      ["EMPRENDEDOR", "Conecta", 39, "branch_month"],
      ["NEGOCIO", "Impulsa", 79, "branch_month"],
      ["EMPRESA", "Expande", 129, "branch_month"],
    ],
  );
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
  assert.doesNotMatch(JSON.stringify(data), /pricing_gtq|1490|3990|9990|included_messages|overage/);
  const html = renderPlanComparison(data);
  assert.match(html, /USD 39 por sucursal al mes/);
  assert.match(html, /USD 129 por sucursal al mes/);
  assert.match(html, /href="\/prueba\/"[^>]*data-umami-event="trial_start_click"/);
  assert.match(html, /Prueba 14 días gratis/);
  assert.match(html, /Empezar con Impulsa/);
  assert.match(html, /Hablar con nosotros/);
  assert.doesNotMatch(html, /Q149|Q399|Q999|ilimitad|cotización|en revisión/i);
});
test("a dated GTQ reference appears only when the platform sets one and is never spot FX", () => {
  const data = publicPlanCatalog(listPlans(), {
    gtqReference: { rate: 7.7, as_of: "2026-11-25" },
  });
  assert.deepEqual(data.reference_gtq, { rate: 7.7, as_of: "2026-11-25" });
  assert.equal(data.plans[0].pricing.reference_gtq_monthly, 300);
  const html = renderPlanComparison(data);
  assert.match(html, /Referencia en quetzales/);
  assert.match(html, /Q300 al mes \(tipo de cambio 7.7, 2026-11-25\)/);
  assert.equal(publicPlanCatalog(listPlans(), { gtqReference: null }).reference_gtq, null);
});
test("plan rendering escapes unexpected catalog text and does not claim excluded capabilities", () => {
  const data = publicPlanCatalog(listPlans({ NEGOCIO: { analytics: false } }));
  data.plans[0].name = "<script>bad</script>";
  const html = renderPlanComparison(data);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Precio<\/th>/);
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
  assert.match(body, /USD 79 por sucursal al mes/);
  assert.match(body, /Prueba 14 días gratis/);
  assert.doesNotMatch(body, /<!--PLAN_COMPARISON-->|Q149|Q399|Q999|Solicitar cotización/);
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
