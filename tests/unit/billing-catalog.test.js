import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  DEFAULT_BILLING_CATALOG,
  listPlans,
  PLAN_PRICING_USD,
  resolveBillingCatalog,
} from "../../src/utils/plan.js";
import { BillingCatalogSchema } from "../../src/app/services/billing-catalog-service.js";
import { createPublicPlanRoutes } from "../../src/app/routes/public-plan-routes.js";
import { ownerTrialPayload } from "../../src/app/services/trial-entitlement.js";

test("the code default publishes USD 39/79/129 per branch per month and listPlans carries it beside the provisional GTQ figures", () => {
  assert.deepEqual(PLAN_PRICING_USD, { EMPRENDEDOR: 39, NEGOCIO: 79, EMPRESA: 129 });
  const plans = listPlans();
  assert.deepEqual(
    plans.map((p) => [p.plan, p.pricing_usd]),
    [
      ["EMPRENDEDOR", { currency: "USD", per: "branch_month", monthly: 39 }],
      ["NEGOCIO", { currency: "USD", per: "branch_month", monthly: 79 }],
      ["EMPRESA", { currency: "USD", per: "branch_month", monthly: 129 }],
    ],
  );
  // The super console still reads the provisional quetzal figures; nothing public does.
  assert.equal(plans[0].pricing_gtq.monthly, 149);
  assert.equal(plans[1].messaging_gtq.included_messages, 1000);
});

test("the platform billing catalog overrides amounts, falls back on invalid values and keeps the GTQ reference dated", () => {
  assert.deepEqual(resolveBillingCatalog(), DEFAULT_BILLING_CATALOG);
  assert.deepEqual(resolveBillingCatalog(null), DEFAULT_BILLING_CATALOG);
  const custom = resolveBillingCatalog({
    published_at: "2026-12-01",
    usd: { EMPRENDEDOR: 49, NEGOCIO: "oops", EMPRESA: -5 },
    gtq: { EMPRENDEDOR: 300, NEGOCIO: 600, EMPRESA: 999 },
    gtq_reference: { rate: 7.68, as_of: "2026-11-25" },
    providers: { recurrente: { price_ids: { GTQ: { EMPRENDEDOR: "price_a", bogus: "x" } } } },
    unknown: true,
  });
  assert.equal(custom.published_at, "2026-12-01");
  assert.deepEqual(custom.usd, { EMPRENDEDOR: 49, NEGOCIO: 79, EMPRESA: 129 });
  assert.deepEqual(custom.gtq, { EMPRENDEDOR: 300, NEGOCIO: 600, EMPRESA: 999 });
  assert.deepEqual(custom.gtq_reference, { rate: 7.68, as_of: "2026-11-25" });
  assert.deepEqual(custom.providers.recurrente.price_ids.GTQ, { EMPRENDEDOR: "price_a" });
  assert.deepEqual(custom.providers.stripe.price_ids.USD, {});
  assert.equal("unknown" in custom, false);
  assert.equal(
    resolveBillingCatalog({ gtq: { EMPRENDEDOR: 300 } }).gtq,
    null,
    "partial GTQ is not published",
  );
  assert.equal(
    resolveBillingCatalog({ gtq_reference: { rate: 7.7 } }).gtq_reference,
    null,
    "undated rate is dropped",
  );
  assert.equal(
    resolveBillingCatalog({ gtq_reference: { rate: 0, as_of: "2026-11-25" } }).gtq_reference,
    null,
  );
  const withCatalog = listPlans({}, custom);
  assert.equal(withCatalog[0].pricing_usd.monthly, 49);
  assert.equal(withCatalog[0].pricing_usd.gtq_monthly, 300);
});

test("the super-console schema accepts the documented document and rejects malformed amounts", () => {
  assert.equal(
    BillingCatalogSchema.safeParse({ usd: { EMPRENDEDOR: 39, NEGOCIO: 79, EMPRESA: 129 } }).success,
    true,
  );
  assert.equal(
    BillingCatalogSchema.safeParse({
      usd: { EMPRENDEDOR: 39, NEGOCIO: 79, EMPRESA: 129 },
      gtq: null,
      gtq_reference: { rate: 7.7, as_of: "2026-11-25" },
      providers: { recurrente: { price_ids: { GTQ: { NEGOCIO: "price_x" } } } },
    }).success,
    true,
  );
  assert.equal(
    BillingCatalogSchema.safeParse({ usd: { EMPRENDEDOR: 0, NEGOCIO: 79, EMPRESA: 129 } }).success,
    false,
  );
  assert.equal(BillingCatalogSchema.safeParse({ usd: { EMPRENDEDOR: 39 } }).success, false);
  assert.equal(
    BillingCatalogSchema.safeParse({
      usd: { EMPRENDEDOR: 39, NEGOCIO: 79, EMPRESA: 129 },
      gtq_reference: { rate: 7.7, as_of: "yesterday" },
    }).success,
    false,
  );
  assert.equal(
    BillingCatalogSchema.safeParse({
      usd: { EMPRENDEDOR: 39, NEGOCIO: 79, EMPRESA: 129 },
      extra: 1,
    }).success,
    false,
  );
});

test("GET /api/public/plans serves the published catalog as JSON with a short public cache", async (t) => {
  const app = express();
  app.use(
    "/api",
    createPublicPlanRoutes({
      listPlans: async () => listPlans(),
      getBillingCatalog: async () =>
        resolveBillingCatalog({ gtq_reference: { rate: 7.7, as_of: "2026-11-25" } }),
      trialDays: 14,
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  const response = await fetch(`http://127.0.0.1:${port}/api/public/plans`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=300");
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.pricing_status, "published");
  assert.deepEqual(
    body.plans.map((p) => [p.id, p.name, p.pricing.monthly, p.pricing.reference_gtq_monthly]),
    [
      ["EMPRENDEDOR", "Conecta", 39, 300],
      ["NEGOCIO", "Impulsa", 79, 608],
      ["EMPRESA", "Expande", 129, 993],
    ],
  );
  assert.deepEqual(body.trial, {
    days: 14,
    plan: "EMPRENDEDOR",
    plan_name: "Conecta",
    requires_card: false,
    url: "/prueba/",
  });
  assert.deepEqual(body.plans[0].limits, { activeCustomers: 300, branches: 1, rewards: 5 });
  assert.ok(
    Array.isArray(body.plans[2].feature_list) && body.plans[2].feature_list.includes("Webhooks"),
  );
  assert.doesNotMatch(JSON.stringify(body), /pricing_gtq|messaging_gtq|included_messages|overage/);
});

test("the owner trial payload names the plan and carries the banner, lock copy and billing block", () => {
  const now = new Date("2026-11-25T21:00:00.000Z");
  const payload = ownerTrialPayload(
    {
      plan: "EMPRENDEDOR",
      program_json: {},
      billing_currency: null,
      trial_status: "active",
      billing_status: "trialing",
      trial_started_at: now,
      trial_ends_at: new Date(now.getTime() + 14 * 86_400_000),
      locked_at: null,
      purge_after: null,
    },
    { now },
  );
  assert.equal(payload.trial.status, "active");
  assert.equal(payload.trial.days_left, 14);
  assert.equal(payload.trial.plan_name, "Conecta");
  assert.equal(payload.trial.ends_on, "9 de diciembre de 2026");
  assert.equal(payload.trial.upgrade_url, "/negocio/#plan");
  assert.equal(payload.trial.upgrade_available, false);
  assert.equal(payload.trial.copy.banner, "Prueba gratis · te quedan 14 días");
  assert.deepEqual(payload.billing, {
    status: "trialing",
    currency: null,
    provider: null,
    subscription: null,
    purge_after: null,
  });
  const converted = ownerTrialPayload(
    {
      plan: "NEGOCIO",
      program_json: {},
      billing_currency: "USD",
      trial_status: "converted",
      billing_status: "active",
      trial_started_at: now,
      trial_ends_at: now,
    },
    {
      now,
      subscription: /** @type {any} */ ({
        provider: "manual",
        plan: "NEGOCIO",
        quantity: 2,
        currency: "USD",
        unit_amount_minor: 7900,
        status: "active",
        current_period_end: null,
        cancel_at: null,
      }),
    },
  );
  assert.equal(converted.trial.status, "converted");
  assert.equal(converted.trial.plan_name, "Impulsa");
  assert.equal(converted.billing.provider, "manual");
  assert.equal(converted.billing.subscription.unit_amount_minor, 7900);
});
