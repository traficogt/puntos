import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PLAN_FEATURE_LABELS,
  applyPlanCatalog,
  formatPlanLimits,
  formatPlanPrice,
} from "../../public/precios.js";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository page.
const html = fs.readFileSync(new URL("../../public/precios.html", import.meta.url), "utf8");

test("the pricing page leads with the quetzal prices, keeps USD alongside, states IVA included and ships the trial call to action as static markup", () => {
  for (const amount of ["Q300", "Q630", "Q1,030"])
    assert.match(html, new RegExp(`data-plan-price>${amount}<`));
  for (const amount of ["USD 39", "USD 79", "USD 129"])
    assert.match(html, new RegExp(`data-plan-price-usd>${amount} fuera de Guatemala<`));
  assert.match(html, /data-plan-unit>al mes por sucursal</);
  assert.match(html, /Prueba 14 días gratis/);
  assert.match(html, /href="\/prueba\/"/);
  assert.match(html, /href="\/prueba\/\?plan=NEGOCIO"/);
  assert.match(html, /href="\/prueba\/\?plan=EMPRESA"/);
  assert.match(html, /Hasta 300 clientes activos · 1 sucursal · hasta 5 recompensas/);
  assert.match(
    html,
    /Precios con IVA \(12 %\) incluido\. Cada cobro queda registrado en tu panel; por ahora no se emite factura electrónica \(FEL\)\./,
  );
  assert.match(
    html,
    /desde Q300 al mes por sucursal con IVA incluido \(USD 39 fuera de Guatemala\)/,
  );
  assert.doesNotMatch(html, /sin impuestos|se confirman por escrito|data-plan-reference/);
  assert.match(html, /No se realiza ningún cobro desde esta página/);
  assert.match(
    html,
    /<!--PLAN_COMPARISON-->/,
    "the server-rendered comparison table keeps its slot",
  );
  assert.match(html, /<script type="module" src="\/precios\.js/);
  assert.doesNotMatch(html, /en revisión|Solicitar cotización|Q149|Q399|Q999|ilimitad/i);
  for (const key of ["EMPRENDEDOR", "NEGOCIO", "EMPRESA"])
    assert.match(html, new RegExp(`data-plan="${key}"`));
});

test("price and caps formatting follow the catalog contract: quetzales lead, USD is the aside", () => {
  assert.deepEqual(
    formatPlanPrice({ currency: "USD", per: "branch_month", monthly: 39, gtq_monthly: 300 }),
    { amount: "Q300", unit: "al mes por sucursal", aside: "USD 39 fuera de Guatemala" },
  );
  assert.deepEqual(
    formatPlanPrice({ currency: "USD", per: "branch_month", monthly: 129, gtq_monthly: 1030 }),
    { amount: "Q1,030", unit: "al mes por sucursal", aside: "USD 129 fuera de Guatemala" },
  );
  assert.deepEqual(
    formatPlanPrice({ currency: "USD", per: "branch_month", monthly: 39 }),
    { amount: "USD 39", unit: "al mes por sucursal", aside: "" },
    "a catalog without the quetzal amount shows its own currency and no aside",
  );
  assert.deepEqual(formatPlanPrice({ monthly: 79.5 }), {
    amount: "USD 79.50",
    unit: "al mes por sucursal",
    aside: "",
  });
  assert.deepEqual(formatPlanPrice({ currency: "gtq", per: "month", monthly: 300 }), {
    amount: "Q300",
    unit: "al mes",
    aside: "",
  });
  assert.equal(formatPlanPrice(/** @type {any} */ ({ monthly: "39" })), null);
  assert.equal(formatPlanPrice(null), null);
  assert.equal(
    formatPlanLimits({ activeCustomers: 300, branches: 1, rewards: 5 }, "EMPRENDEDOR"),
    "Hasta 300 clientes activos · 1 sucursal · hasta 5 recompensas",
  );
  assert.equal(
    formatPlanLimits({ activeCustomers: 2000, branches: 3, rewards: 9999 }, "NEGOCIO"),
    "Hasta 2,000 clientes activos · Hasta 3 sucursales · recompensas según tu catálogo",
  );
  assert.equal(
    formatPlanLimits({ activeCustomers: 999999, branches: 9999, rewards: 9999 }, "EMPRESA"),
    "Clientes activos y sucursales según alcance · recompensas según tu catálogo",
  );
  assert.equal(Object.keys(PLAN_FEATURE_LABELS).length, 8);
});

function fakeCard(id) {
  const parts = {
    "[data-plan-price]": { textContent: "Q300" },
    "[data-plan-unit]": { textContent: "al mes por sucursal" },
    "[data-plan-limits]": { textContent: "static" },
    "[data-plan-features]": {
      children: [],
      replaceChildren() {
        this.children = [];
      },
      appendChild(node) {
        this.children.push(node);
      },
    },
    "[data-plan-price-usd]": {
      textContent: "USD 39 fuera de Guatemala",
      hidden: false,
      toggleAttribute(name, force) {
        this.hidden = force;
      },
    },
  };
  return { id, querySelector: (selector) => parts[selector] || null, parts };
}

test("a published catalog re-renders the cards and anything else leaves the static fallback alone", (t) => {
  const cards = { EMPRENDEDOR: fakeCard("EMPRENDEDOR"), NEGOCIO: fakeCard("NEGOCIO") };
  const root = /** @type {any} */ ({
    querySelector: (selector) => cards[selector.match(/"([A-Z]+)"/)?.[1]] || null,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => ({ textContent: "" }) },
  });
  t.after(() => delete globalThis.document);
  assert.equal(
    applyPlanCatalog(root, {
      pricing_status: "quotation",
      plans: [{ id: "EMPRENDEDOR", pricing: { monthly: 1 } }],
    }),
    0,
  );
  assert.equal(applyPlanCatalog(root, null), 0);
  assert.equal(cards.EMPRENDEDOR.parts["[data-plan-price]"].textContent, "Q300");
  const updated = applyPlanCatalog(root, {
    pricing_status: "published",
    tax: { iva_included: true, rate: 0.12 },
    plans: [
      {
        id: "EMPRENDEDOR",
        pricing: { currency: "USD", per: "branch_month", monthly: 41, gtq_monthly: 320 },
        limits: { activeCustomers: 300, branches: 1, rewards: 5 },
        features: { rewards: true, staff_management: true, analytics: false },
        reference_gtq: { monthly: 316, as_of: "2026-11-25" },
      },
      {
        id: "NEGOCIO",
        pricing: { currency: "USD", monthly: 79 },
        features: { rewards: true, analytics: true, webhooks: false },
      },
      { id: "EMPRESA", pricing: { currency: "USD", monthly: 129, gtq_monthly: 1030 } },
      { id: "NEGOCIO", pricing: { monthly: "not-a-number" } },
    ],
  });
  assert.equal(updated, 2, "EMPRESA has no card in this fixture and the bad price is skipped");
  assert.equal(cards.EMPRENDEDOR.parts["[data-plan-price]"].textContent, "Q320");
  assert.equal(cards.EMPRENDEDOR.parts["[data-plan-unit]"].textContent, "al mes por sucursal");
  assert.equal(
    cards.EMPRENDEDOR.parts["[data-plan-price-usd]"].textContent,
    "USD 41 fuera de Guatemala",
  );
  assert.equal(cards.EMPRENDEDOR.parts["[data-plan-price-usd]"].hidden, false);
  assert.deepEqual(
    cards.EMPRENDEDOR.parts["[data-plan-features]"].children.map((n) => n.textContent),
    ["Puntos y recompensas", "Accesos para el equipo"],
  );
  assert.equal(
    cards.NEGOCIO.parts["[data-plan-limits]"].textContent,
    "static",
    "missing limits keep the static copy",
  );
  assert.deepEqual(
    cards.NEGOCIO.parts["[data-plan-features]"].children.map((n) => n.textContent),
    ["Puntos y recompensas", "Análisis de resultados"],
  );
  assert.equal(
    cards.NEGOCIO.parts["[data-plan-price]"].textContent,
    "USD 79",
    "a plan without a quetzal amount falls back to its own currency",
  );
  assert.equal(cards.NEGOCIO.parts["[data-plan-price-usd]"].hidden, true);
  assert.equal(cards.NEGOCIO.parts["[data-plan-price-usd]"].textContent, "");
});
