import test from "node:test";
import assert from "node:assert/strict";
import {
  BILLING_PLANS,
  SUBSCRIPTION_FILTERS,
  billingEventLabel,
  billingUnavailableNotice,
  buildCatalogPayload,
  canCancelSubscription,
  catalogPriceIds,
  filterSubscriptions,
  formatMinor,
  parsePlanAmounts,
  sortBillingEvents,
  subscriptionAmountLine,
  subscriptionCounts,
  subscriptionDatesLine,
  subscriptionStatusLabel,
} from "../../public/super/billing-model.js";

const now = new Date("2026-11-25T15:00:00Z");
const day = (offset) => new Date(now.getTime() + offset * 86_400_000).toISOString();
/** @type {import("../../public/super/types.js").SuperBillingSubscriptionRow[]} */
const rows = [
  {
    business_id: "a",
    business_name: "Activa",
    slug: "activa",
    provider: "recurrente",
    status: "active",
    plan: "NEGOCIO",
    quantity: 2,
    currency: "USD",
    monthly_total_minor: 15800,
    current_period_end: day(20),
    cancel_at: null,
    past_due_since: null,
  },
  {
    business_id: "b",
    business_name: "Rechazada",
    slug: "rechazada",
    provider: "recurrente",
    status: "past_due",
    plan: "NEGOCIO",
    quantity: 1,
    currency: "GTQ",
    monthly_total_minor: 60000,
    current_period_end: day(-2),
    cancel_at: null,
    past_due_since: day(-2),
  },
  {
    business_id: "c",
    business_name: "Cancelada",
    slug: "cancelada",
    provider: "recurrente",
    status: "canceled",
    plan: "EMPRESA",
    quantity: 1,
    currency: "USD",
    monthly_total_minor: 12900,
    current_period_end: day(10),
    cancel_at: day(10),
    past_due_since: null,
  },
  {
    business_id: "d",
    business_name: "Manual",
    slug: "manual",
    provider: "manual",
    status: "manual",
    plan: "NEGOCIO",
    quantity: 1,
    currency: "GTQ",
    monthly_total_minor: null,
    current_period_end: null,
    cancel_at: null,
    past_due_since: null,
  },
  {
    business_id: "e",
    business_name: "Sin cobro",
    slug: "sin-cobro",
    status: "none",
    plan: "EMPRENDEDOR",
  },
];

test("filters count and order subscriptions: past due first, then active by period end", () => {
  assert.deepEqual(
    SUBSCRIPTION_FILTERS.map(([key]) => key),
    ["all", "active", "past_due", "canceled", "manual", "trial"],
  );
  assert.deepEqual(subscriptionCounts(rows), {
    all: 4,
    active: 1,
    past_due: 1,
    canceled: 1,
    manual: 1,
    trial: 0,
  });
  assert.deepEqual(
    filterSubscriptions(rows, "all").map((row) => row.business_id),
    ["b", "a", "c", "d"],
  );
  assert.deepEqual(
    filterSubscriptions(rows, "canceled").map((row) => row.business_id),
    ["c"],
  );
  assert.deepEqual(filterSubscriptions(rows, "trial"), []);
});

test("labels, money and date lines read in Spanish", () => {
  assert.equal(subscriptionStatusLabel("active"), "Activa");
  assert.equal(subscriptionStatusLabel("past_due"), "Pago pendiente");
  assert.equal(subscriptionStatusLabel("manual"), "Manual (acuerdo directo)");
  assert.equal(subscriptionStatusLabel(undefined), "Sin suscripción");
  assert.equal(subscriptionStatusLabel("odd"), "Estado: odd");
  assert.equal(formatMinor(15800, "USD"), "USD 158.00");
  assert.equal(formatMinor(60000, "GTQ"), "Q600.00");
  assert.equal(formatMinor(123456, "EUR"), "EUR 1,234.56");
  assert.equal(formatMinor(-200, "GTQ"), "−Q2.00");
  assert.equal(formatMinor(null, "USD"), "—");
  assert.equal(
    subscriptionAmountLine(rows[0]),
    "NEGOCIO · 2 sucursales × USD 79.00 = USD 158.00 al mes",
  );
  assert.equal(subscriptionAmountLine(rows[1]), "NEGOCIO · 1 sucursal × Q600.00 = Q600.00 al mes");
  assert.equal(subscriptionAmountLine(rows[3]), "NEGOCIO · 1 sucursal");
  assert.match(subscriptionDatesLine(rows[0]), /^Proveedor recurrente · Período hasta .*2026$/);
  assert.match(subscriptionDatesLine(rows[1]), /Rechazado desde /);
  assert.match(subscriptionDatesLine(rows[2]), /Termina /);
  assert.equal(subscriptionDatesLine(rows[4]), "");
  assert.equal(billingEventLabel("payment_succeeded"), "Pago exitoso");
  assert.equal(billingEventLabel("subscription.activated"), "Plan activado");
  assert.equal(billingEventLabel("mystery"), "mystery");
  assert.equal(billingEventLabel(null), "Evento");
});

test("only Recurrente subscriptions that are active or past due can be canceled from the console", () => {
  assert.equal(canCancelSubscription(rows[0]), true);
  assert.equal(canCancelSubscription(rows[1]), true);
  assert.equal(canCancelSubscription(rows[2]), false);
  assert.equal(
    canCancelSubscription(rows[3]),
    false,
    "manual activations are not provider subscriptions",
  );
  assert.equal(canCancelSubscription(rows[4]), false);
  const events = sortBillingEvents([
    { occurred_at: day(-30), type: "payment_succeeded", amount_minor: 7900 },
    { occurred_at: day(-1), type: "payment_failed", amount_minor: 7900 },
    { type: "subscription_created" },
  ]);
  assert.deepEqual(
    events.map((event) => event.type),
    ["payment_failed", "payment_succeeded", "subscription_created"],
  );
});

test("the catalog payload keeps USD as published, validates GTQ and the dated reference, and passes price ids through", () => {
  const current = {
    published_at: "2026-11-25",
    usd: { EMPRENDEDOR: 39, NEGOCIO: 79, EMPRESA: 129 },
    gtq: null,
    gtq_reference: null,
    price_ids: { GTQ: { EMPRENDEDOR: "price_gtq_a" }, USD: { NEGOCIO: "price_usd_b" } },
    providers: {
      recurrente: { price_ids: { USD: { EMPRENDEDOR: "price_usd_a" }, GTQ: {} } },
      stripe: { price_ids: { USD: { EMPRESA: "price_stripe_c" } } },
    },
  };
  assert.deepEqual(catalogPriceIds(current), {
    USD: { EMPRENDEDOR: "price_usd_a", NEGOCIO: "price_usd_b" },
    GTQ: { EMPRENDEDOR: "price_gtq_a" },
  });
  assert.deepEqual(catalogPriceIds(null), { USD: {}, GTQ: {} });
  assert.deepEqual(BILLING_PLANS, ["EMPRENDEDOR", "NEGOCIO", "EMPRESA"]);
  assert.deepEqual(parsePlanAmounts({ EMPRENDEDOR: "", NEGOCIO: " ", EMPRESA: "" }), {
    amounts: null,
    error: null,
  });
  assert.deepEqual(parsePlanAmounts({ EMPRENDEDOR: "300", NEGOCIO: "600", EMPRESA: "999" }), {
    amounts: { EMPRENDEDOR: 300, NEGOCIO: 600, EMPRESA: 999 },
    error: null,
  });
  assert.match(parsePlanAmounts({ EMPRENDEDOR: "300" }).error, /los tres montos/);
  assert.match(
    parsePlanAmounts({ EMPRENDEDOR: "3.5", NEGOCIO: "600", EMPRESA: "999" }).error,
    /entero/,
  );
  assert.match(
    parsePlanAmounts({ EMPRENDEDOR: "0", NEGOCIO: "600", EMPRESA: "999" }).error,
    /entero/,
  );

  const saved = buildCatalogPayload(current, {
    gtq: { EMPRENDEDOR: "300", NEGOCIO: "600", EMPRESA: "999" },
    rate: "7.6812345",
    as_of: "2026-11-25",
  });
  assert.equal(saved.error, null);
  assert.deepEqual(saved.payload, {
    usd: { EMPRENDEDOR: 39, NEGOCIO: 79, EMPRESA: 129 },
    gtq: { EMPRENDEDOR: 300, NEGOCIO: 600, EMPRESA: 999 },
    gtq_reference: { rate: 7.6812, as_of: "2026-11-25" },
    providers: {
      recurrente: {
        price_ids: {
          USD: { EMPRENDEDOR: "price_usd_a", NEGOCIO: "price_usd_b" },
          GTQ: { EMPRENDEDOR: "price_gtq_a" },
        },
      },
      stripe: { price_ids: { USD: { EMPRESA: "price_stripe_c" } } },
    },
    published_at: "2026-11-25",
  });
  const cleared = buildCatalogPayload(current, { gtq: {}, rate: "", as_of: "" });
  assert.equal(cleared.payload.gtq, null);
  assert.equal(cleared.payload.gtq_reference, null);
  assert.match(
    buildCatalogPayload(current, { gtq: {}, rate: "abc", as_of: "2026-11-25" }).error,
    /tasa/,
  );
  assert.match(
    buildCatalogPayload(current, { gtq: {}, rate: "7.7", as_of: "25/11/2026" }).error,
    /AAAA-MM-DD/,
  );
  assert.match(buildCatalogPayload({ usd: {} }, { gtq: {}, rate: "", as_of: "" }).error, /USD/);
});

test("404 and 503 end in a notice; other errors fall back to the generic toast", () => {
  assert.match(billingUnavailableNotice({ status: 404 }), /aún no expone/);
  assert.match(billingUnavailableNotice({ status: 503 }), /Recurrente.*no está configurado/);
  assert.match(
    billingUnavailableNotice({ status: 400, code: "BILLING_UNAVAILABLE" }),
    /no está configurado/,
  );
  assert.equal(billingUnavailableNotice({ status: 500 }), null);
  assert.equal(billingUnavailableNotice(null), null);
});
