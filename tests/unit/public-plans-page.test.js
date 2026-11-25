import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PLAN_FEATURE_LABELS,
  applyPlanCatalog,
  formatGtqReference,
  formatPlanLimits,
  formatPlanPrice,
} from "../../public/precios.js";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository page.
const html = fs.readFileSync(new URL("../../public/precios.html", import.meta.url), "utf8");

test("the pricing page ships the published prices, caps and the trial call to action as static markup", () => {
  for (const amount of ["USD 39", "USD 79", "USD 129"])
    assert.match(html, new RegExp(`data-plan-price>${amount}<`));
  assert.match(html, /por sucursal al mes/);
  assert.match(html, /Prueba 14 días gratis/);
  assert.match(html, /href="\/prueba\/"/);
  assert.match(html, /href="\/prueba\/\?plan=NEGOCIO"/);
  assert.match(html, /href="\/prueba\/\?plan=EMPRESA"/);
  assert.match(html, /Hasta 300 clientes activos · 1 sucursal · hasta 5 recompensas/);
  assert.match(html, /IVA \(12 %\)/);
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

test("price, caps and GTQ reference formatting follow the catalog contract", () => {
  assert.deepEqual(formatPlanPrice({ currency: "USD", per: "branch_month", monthly: 39 }), {
    amount: "USD 39",
    unit: "por sucursal al mes",
  });
  assert.deepEqual(formatPlanPrice({ monthly: 79.5 }), {
    amount: "USD 79.50",
    unit: "por sucursal al mes",
  });
  assert.deepEqual(formatPlanPrice({ currency: "gtq", per: "month", monthly: 300 }), {
    amount: "GTQ 300",
    unit: "al mes",
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
  assert.equal(
    formatGtqReference({ monthly: 320, as_of: "2026-11-25" }),
    "Referencia: Q320 al mes por sucursal (tipo de cambio del 2026-11-25). El cobro en quetzales se confirma al elegir plan.",
  );
  assert.equal(formatGtqReference(null), "");
  assert.equal(Object.keys(PLAN_FEATURE_LABELS).length, 8);
});

function fakeCard(id) {
  const parts = {
    "[data-plan-price]": { textContent: "USD 39" },
    "[data-plan-unit]": { textContent: "por sucursal al mes" },
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
    "[data-plan-reference]": {
      textContent: "",
      hidden: true,
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
  assert.equal(cards.EMPRENDEDOR.parts["[data-plan-price]"].textContent, "USD 39");
  const updated = applyPlanCatalog(root, {
    pricing_status: "published",
    plans: [
      {
        id: "EMPRENDEDOR",
        pricing: { currency: "USD", per: "branch_month", monthly: 41 },
        limits: { activeCustomers: 300, branches: 1, rewards: 5 },
        features: { rewards: true, staff_management: true, analytics: false },
        reference_gtq: { monthly: 320, as_of: "2026-11-25" },
      },
      {
        id: "NEGOCIO",
        pricing: { currency: "USD", monthly: 79 },
        features: { rewards: true, analytics: true, webhooks: false },
      },
      { id: "EMPRESA", pricing: { currency: "USD", monthly: 129 } },
      { id: "NEGOCIO", pricing: { monthly: "not-a-number" } },
    ],
  });
  assert.equal(updated, 2, "EMPRESA has no card in this fixture and the bad price is skipped");
  assert.equal(cards.EMPRENDEDOR.parts["[data-plan-price]"].textContent, "USD 41");
  assert.deepEqual(
    cards.EMPRENDEDOR.parts["[data-plan-features]"].children.map((n) => n.textContent),
    ["Puntos y recompensas", "Accesos para el equipo"],
  );
  assert.equal(cards.EMPRENDEDOR.parts["[data-plan-reference]"].hidden, false);
  assert.match(cards.EMPRENDEDOR.parts["[data-plan-reference]"].textContent, /Q320/);
  assert.equal(
    cards.NEGOCIO.parts["[data-plan-limits]"].textContent,
    "static",
    "missing limits keep the static copy",
  );
  assert.deepEqual(
    cards.NEGOCIO.parts["[data-plan-features]"].children.map((n) => n.textContent),
    ["Puntos y recompensas", "Análisis de resultados"],
  );
  assert.equal(cards.NEGOCIO.parts["[data-plan-reference]"].hidden, true);
});
