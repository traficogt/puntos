import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  businessPaysInGtq,
  catalogReadiness,
  createSubscriptionService,
  defaultCurrency,
  prorationMode,
  quantityForBranches,
  PAST_DUE_GRACE_DAYS,
} from "../../src/app/services/billing/subscription-service.js";
import { createManualProvider } from "../../src/app/services/billing/manual-provider.js";
import { trialState } from "../../src/app/services/trial-state.js";
import { resolveBillingCatalog } from "../../src/utils/plan.js";
import {
  createFakeProvider,
  createMemoryBillingRepo,
  FIXTURE_BUSINESS_ID as BIZ,
  FIXTURE_CHECKOUT_ID as CHK,
  fixtureCatalog,
  loadGtqFixture as loadFixture,
  gtqFixtureCatalog,
} from "../fixtures/billing/memory-billing-repo.mjs";

import { stripeCatalog, stripeFixture } from "../fixtures/billing/stripe.mjs";

const DAY = 86_400_000;
/** @param {unknown} e @returns {any} */
const err = (e) => e;

/**
 * @param {{ stripe?: boolean, configured?: boolean, branches?: number, business?: Record<string, unknown>, catalog?: any, now?: Date }} [options]
 */
function harness({
  configured = true,
  stripe = false,
  branches = 1,
  business = {},
  catalog = gtqFixtureCatalog(),
  now = new Date("2026-12-01T14:10:00.000Z"),
} = {}) {
  const clock = { now, branches };
  const businesses = new Map();
  businesses.set(BIZ, {
    id: BIZ,
    name: "Café Uno",
    slug: "cafe-uno",
    email: "owner@example.com",
    phone: null,
    plan: "EMPRENDEDOR",
    program_json: {},
    signup_source: "self_serve",
    trial_status: "active",
    billing_status: "trialing",
    billing_currency: null,
    trial_started_at: new Date("2026-11-20T15:00:00Z"),
    trial_ends_at: new Date("2026-12-09T15:00:00Z"),
    locked_at: null,
    purge_after: null,
    ...business,
  });
  const repo = createMemoryBillingRepo({ businesses });
  const provider = configured
    ? createFakeProvider({ catalog, currency: "GTQ", now: () => clock.now })
    : null;
  const processor = stripe ? stripeFixture({ catalog, now: () => clock.now }) : null;
  const billingEvents = [];
  const counts = [];
  const transitions = [];
  const ids = [CHK];
  let savedCatalog = catalog;
  const service = createSubscriptionService({
    repo,
    getBusiness: async (id) => businesses.get(id) ?? null,
    countBranches: async () => clock.branches,
    getCatalog: async () => savedCatalog,
    saveCatalogPrices: async (_provider, next) => {
      savedCatalog = resolveBillingCatalog(next);
      return savedCatalog;
    },
    provider,
    stripeProvider: processor?.provider ?? null,
    manualProvider: createManualProvider({
      getSubscription: (id) => repo.getSubscriptionByProviderId("manual", id),
      now: () => clock.now,
    }),
    platform: async (fn) => fn(),
    tenant: async (_id, fn) => fn(),
    transaction: async (fn) => fn(),
    emitBillingEvent: async (event) => {
      billingEvents.push(event);
      if (String(event.eventType).startsWith("payment."))
        repo.state.paymentEvents.push({
          business_id: event.businessId,
          event_type: event.eventType,
          metadata: event.metadata,
          created_at: clock.now,
        });
    },
    countEvent: (type) => counts.push(type),
    countTransition: (to) => transitions.push(to),
    config: {
      APP_ORIGIN: "https://app.test",
      BILLING_RETURN_ORIGIN: "https://app.test",
      BILLING_PROVIDER: "recurrente",
      TRIAL_RETENTION_DAYS: 30,
    },
    now: () => clock.now,
    uuid: () => ids.shift() ?? crypto.randomUUID(),
    log: { warn() {}, info() {} },
  });
  const webhook = (name, id, headers = {}) =>
    service.handleWebhook({
      provider: "recurrente",
      rawBody: JSON.stringify(loadFixture(name)),
      headers: { "svix-id": id, ...headers },
    });
  const events = (type) => billingEvents.filter((e) => err(e).eventType === type);
  return {
    service,
    repo,
    provider,
    clock,
    processor,
    businesses,
    business: () => businesses.get(BIZ),
    billingEvents,
    events,
    counts,
    transitions,
    webhook,
    getCatalog: () => savedCatalog,
  };
}

test("pure helpers: quantity clamp, proration mode and catalog readiness", () => {
  assert.deepEqual(quantityForBranches(0), { ok: true, quantity: 1 });
  assert.deepEqual(quantityForBranches(9), { ok: true, quantity: 9 });
  assert.deepEqual(quantityForBranches(10), { ok: false, quantity: 10 });
  assert.equal(
    prorationMode({ fromPlan: "EMPRENDEDOR", toPlan: "NEGOCIO", fromQuantity: 1, toQuantity: 1 }),
    "now_and_charge",
  );
  assert.equal(
    prorationMode({ fromPlan: "EMPRESA", toPlan: "NEGOCIO", fromQuantity: 1, toQuantity: 1 }),
    "next_cycle",
  );
  assert.equal(
    prorationMode({ fromPlan: "NEGOCIO", toPlan: "NEGOCIO", fromQuantity: 1, toQuantity: 2 }),
    "now_and_charge",
  );
  assert.equal(
    prorationMode({ fromPlan: "NEGOCIO", toPlan: "NEGOCIO", fromQuantity: 3, toQuantity: 2 }),
    "next_cycle",
  );
  assert.deepEqual(catalogReadiness(fixtureCatalog()), { usd: false, gtq: false });
  assert.deepEqual(
    catalogReadiness(fixtureCatalog({ gtq: { EMPRENDEDOR: 300, NEGOCIO: 600, EMPRESA: 999 } })),
    { usd: false, gtq: true },
  );
  assert.deepEqual(
    catalogReadiness(resolveBillingCatalog({})),
    { usd: false, gtq: false },
    "no price ids yet",
  );
});

test("unconfigured provider: 503 on checkout, upgrade_available false, webhook 503, manual activation still visible", async () => {
  const h = harness({ configured: false });
  assert.equal(h.service.isConfigured(), false);
  await assert.rejects(
    h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" }),
    (e) => err(e).statusCode === 503 && err(e).code === "BILLING_UNAVAILABLE",
  );
  const overview = await h.service.overview(BIZ);
  assert.equal(overview.billing.upgrade_available, false);
  assert.equal(overview.billing.change_available, false);
  assert.equal(overview.billing.provider, null);
  assert.equal(overview.billing.status, "trialing");
  assert.equal(overview.catalog.currency, "GTQ");
  assert.deepEqual(
    overview.catalog.plans.map((p) => [p.id, p.unit_amount_minor]),
    [
      ["EMPRENDEDOR", 30000],
      ["NEGOCIO", 63000],
      ["EMPRESA", 103000],
    ],
  );
  assert.equal(overview.branches, 1);
  assert.equal(overview.trial.status, "active");
  const hook = await h.service.handleWebhook({
    provider: "recurrente",
    rawBody: "{}",
    headers: {},
  });
  assert.equal(hook.status, 503);
  assert.equal(hook.body.code, "BILLING_UNAVAILABLE");
  // A wave-1 manual subscription keeps showing through the overview.
  await h.repo.insertSubscription({
    id: crypto.randomUUID(),
    businessId: BIZ,
    provider: "manual",
    providerSubscriptionId: "manual:x",
    checkoutId: null,
    plan: "NEGOCIO",
    quantity: 1,
    currency: "GTQ",
    unitAmountMinor: 63000,
    status: "active",
    currentPeriodStart: h.clock.now,
    currentPeriodEnd: null,
    cancelAt: null,
    metadata: {},
  });
  h.business().billing_status = "active";
  const manual = await h.service.overview(BIZ);
  assert.equal(manual.billing.provider, "manual");
  assert.equal(manual.billing.subscription.plan, "NEGOCIO");
  assert.equal(manual.billing.upgrade_available, false);
});

test("checkout: reuse while pending, quantity limit, already active and the created record", async () => {
  const h = harness();
  const created = await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  assert.equal(created.reused, false);
  assert.equal(created.checkout.id, CHK);
  assert.equal(created.checkout.url, "https://app.recurrente.com/checkout-session/ch_fixture01");
  assert.equal(created.checkout.unit_amount_minor, 63000);
  assert.equal(created.checkout.currency, "GTQ", "GTQ by default");
  const call = h.provider.calls.find((c) => c.method === "createCheckout").args[0];
  assert.equal(call.idempotencyKey, CHK);
  assert.deepEqual(call.metadata, {
    business_id: BIZ,
    checkout_id: CHK,
    plan: "NEGOCIO",
    quantity: "1",
    currency: "GTQ",
  });
  assert.equal(call.successUrl, `https://app.test/negocio/#plan?checkout=${CHK}&resultado=exito`);
  assert.equal(
    call.cancelUrl,
    `https://app.test/negocio/#plan?checkout=${CHK}&resultado=cancelado`,
  );
  assert.equal(h.provider.calls.filter((c) => c.method === "createCustomer").length, 1);
  assert.equal(h.events("checkout.created").length, 1);

  const again = await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  assert.equal(again.reused, true);
  assert.equal(again.checkout.id, CHK, "a pending checkout for the same plan is reused");
  assert.equal(h.provider.calls.filter((c) => c.method === "createCheckout").length, 1);
  assert.equal(
    h.provider.calls.filter((c) => c.method === "createCustomer").length,
    1,
    "customer created once",
  );

  const status = await h.service.checkoutStatus({ businessId: BIZ, checkoutId: CHK });
  assert.equal(status.status, "pending");
  await assert.rejects(
    h.service.checkoutStatus({
      businessId: "33333333-3333-4333-8333-333333333333",
      checkoutId: CHK,
    }),
    (e) => err(e).statusCode === 404 && err(e).code === "BILLING_CHECKOUT_NOT_FOUND",
  );
  await assert.rejects(
    h.service.startCheckout({ businessId: BIZ, plan: "PLATINO" }),
    (e) => err(e).code === "BILLING_PLAN_INVALID",
  );
  await assert.rejects(
    h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO", currency: "USD" }),
    (e) => err(e).statusCode === 400 && err(e).code === "BILLING_CURRENCY_UNAVAILABLE",
  );

  const many = harness({ branches: 10 });
  await assert.rejects(
    many.service.startCheckout({ businessId: BIZ, plan: "EMPRESA" }),
    (e) => err(e).statusCode === 409 && err(e).code === "BILLING_QUANTITY_LIMIT",
  );
});

test("regional currency and processor stay fixed when catalog or credentials are missing", async () => {
  const abroad = {
    billing_currency: null,
    trial_phone: null,
    program_json: { region: { country: "SV", timezone: "America/El_Salvador" } },
  };
  assert.equal(businessPaysInGtq(abroad), false);
  assert.equal(businessPaysInGtq({ ...abroad, billing_currency: "GTQ" }), false);
  assert.equal(businessPaysInGtq({ ...abroad, trial_phone: "50212345678" }), false);
  assert.equal(
    defaultCurrency({
      business: {
        ...abroad,
        trial_phone: "+50255512345",
        program_json: { region: { country: "SV", timezone: "America/Guatemala" } },
      },
    }),
    "USD",
  );
  assert.equal(
    businessPaysInGtq({ ...abroad, program_json: {}, trial_phone: "50255512345" }),
    true,
  );
  assert.equal(
    businessPaysInGtq({ ...abroad, program_json: {}, trial_phone: "50371234567" }),
    false,
  );
  assert.equal(defaultCurrency({ business: abroad }), "USD");
  assert.equal(defaultCurrency({ business: abroad, active: { currency: "GTQ" } }), "GTQ");
  const gt = harness({ catalog: fixtureCatalog() });
  const view = await gt.service.overview(BIZ);
  assert.equal(view.catalog.currency, "GTQ");
  assert.equal(view.billing.upgrade_available, false);
  await assert.rejects(gt.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" }), {
    code: "BILLING_UNAVAILABLE",
  });
  await assert.rejects(
    gt.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO", currency: "USD" }),
    { code: "BILLING_CURRENCY_UNAVAILABLE" },
  );
  const sv = harness({ business: abroad });
  assert.equal((await sv.service.overview(BIZ)).billing.provider, null);
  await assert.rejects(sv.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" }), {
    code: "BILLING_UNAVAILABLE",
  });
  await assert.rejects(
    sv.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO", currency: "GTQ" }),
    { code: "BILLING_CURRENCY_UNAVAILABLE" },
  );
});

test("state machine: checkout paid -> converted, duplicate, renewal, past_due, recovery, cancel -> locked, unknown", async () => {
  const h = harness({ business: { trial_ends_at: new Date("2026-11-30T15:00:00Z") } });
  assert.equal(
    trialState(h.business(), { now: h.clock.now }).locked,
    true,
    "the trial already ended",
  );
  await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  h.provider.program("subscription-get.json");

  const paid = await h.webhook("intent-succeeded-first.json", "msg_1");
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.handled, true);
  const business = h.business();
  assert.equal(business.plan, "NEGOCIO");
  assert.equal(business.billing_status, "active");
  assert.equal(business.trial_status, "converted");
  assert.equal(business.billing_currency, "GTQ");
  assert.equal(business.purge_after, null);
  assert.equal(trialState(business, { now: h.clock.now }).locked, false, "the lock lifts");
  assert.equal(h.repo.state.subscriptions.length, 1);
  const sub = h.repo.state.subscriptions[0];
  assert.equal(sub.provider_subscription_id, "su_fixture01");
  assert.equal(sub.status, "active");
  assert.equal(sub.quantity, 1);
  assert.equal(sub.unit_amount_minor, 63000);
  assert.equal(sub.checkout_id, CHK);
  assert.equal(sub.metadata.first_payment_at, "2026-12-01T14:03:21.000Z");
  assert.equal(sub.metadata.latest_tax_invoice_url, "https://app.recurrente.com/fel/in_fixture001");
  assert.equal(
    sub.current_period_end.toISOString(),
    "2027-01-01T14:03:21.000Z",
    "periods come from the provider read",
  );
  assert.equal((await h.repo.getCheckout(CHK)).status, "paid");
  for (const type of [
    "checkout.completed",
    "trial.converted",
    "subscription.activated",
    "payment.succeeded",
  ])
    assert.equal(h.events(type).length, 1, type);
  assert.equal(h.events("payment.succeeded")[0].metadata.fee_minor, 357, "fee logged to metadata");
  assert.deepEqual(h.transitions, ["converted"]);
  assert.ok(h.counts.includes("payment_succeeded"));
  const event = h.repo.state.providerEvents[0];
  assert.equal(event.status, "processed");
  assert.equal(event.event_type, "intent.succeeded");
  assert.equal(event.business_id, BIZ);
  assert.equal(event.subscription_id, sub.id);

  // The companion subscription.create converges without a second activation.
  const created = await h.webhook("subscription-create.json", "msg_2");
  assert.equal(created.status, 200);
  assert.equal(h.repo.state.subscriptions.length, 1);
  assert.equal(h.events("subscription.activated").length, 1);

  // Redelivery of the same svix-id is acknowledged and ignored.
  const dup = await h.webhook("intent-succeeded-first.json", "msg_1");
  assert.deepEqual(dup, { status: 200, body: { ok: true, duplicate: true } });
  assert.ok(h.counts.includes("duplicate"));
  assert.equal(h.events("payment.succeeded").length, 1);

  // A renewal records the payment and the renewed fact.
  h.clock.now = new Date("2027-01-01T14:10:00.000Z");
  const renewal = await h.webhook("intent-succeeded-renewal.json", "msg_3");
  assert.equal(renewal.status, 200);
  assert.equal(h.events("subscription.renewed").length, 1);
  assert.equal(h.events("payment.succeeded").length, 2);
  assert.equal(h.events("subscription.activated").length, 1, "renewals never re-activate");
  const invoices = await h.service.invoices(BIZ);
  assert.equal(invoices.length, 2);
  assert.equal(invoices[0].status, "paid");
  assert.equal(invoices[0].amount_minor, 63000);
  assert.equal(invoices[0].tax_invoice_url, "https://app.recurrente.com/fel/in_fixture002");

  // A failed charge: past_due with full access during the grace period.
  h.clock.now = new Date("2027-02-01T14:10:00.000Z");
  h.provider.program("subscription-get-past-due.json");
  const failed = await h.webhook("intent-failed.json", "msg_4");
  assert.equal(failed.status, 200);
  assert.equal(h.business().billing_status, "past_due");
  assert.equal(sub.status, "past_due");
  assert.equal(sub.metadata.past_due_since, "2027-02-01T14:05:00.000Z");
  assert.equal(sub.metadata.provider_next_payment_attempt_at, "2027-02-02T14:05:00.000Z");
  assert.equal(h.events("subscription.past_due").length, 1);
  assert.equal(h.events("payment.failed").length, 1);
  assert.equal(
    trialState(h.business(), { now: h.clock.now }).locked,
    false,
    "grace: still not locked",
  );
  const pastDueAgain = await h.webhook("subscription-past-due.json", "msg_5");
  assert.equal(pastDueAgain.status, 200);
  assert.equal(h.events("subscription.past_due").length, 1, "the transition is recorded once");
  const overview = await h.service.overview(BIZ);
  assert.equal(overview.billing.status, "past_due");
  assert.equal(overview.billing.past_due_since, "2027-02-01T14:05:00.000Z");
  assert.equal(overview.billing.next_payment_attempt_at, "2027-02-02T14:05:00.000Z");
  assert.equal(overview.billing.change_available, true);
  assert.equal(overview.billing.upgrade_available, false, "an open subscription exists");

  // Recovery: the retry succeeds.
  h.provider.program("subscription-get.json");
  const recovered = await h.webhook("intent-succeeded-renewal.json", "msg_6");
  assert.equal(recovered.status, 200);
  assert.equal(h.business().billing_status, "active");
  assert.equal(sub.status, "active");
  assert.equal(sub.metadata.past_due_since, null);
  assert.equal(h.events("subscription.renewed").at(-1).metadata.recovered, true);

  // Final cancellation after exhausted retries: the paid period ended, the business locks.
  h.clock.now = new Date("2027-02-16T15:00:00.000Z");
  h.provider.program("subscription-get-cancelled.json");
  const canceled = await h.webhook("subscription-cancel.json", "msg_7");
  assert.equal(canceled.status, 200);
  assert.equal(sub.status, "canceled");
  assert.equal(h.business().billing_status, "locked");
  assert.equal(h.business().trial_status, "converted", "history untouched");
  assert.equal(h.business().purge_after.getTime(), h.clock.now.getTime() + 30 * DAY);
  assert.equal(trialState(h.business(), { now: h.clock.now }).locked, true, "the lock returns");
  assert.equal(h.events("subscription.canceled")[0].metadata.reason, "payment_failed");
  const locked = await h.service.overview(BIZ);
  assert.equal(locked.billing.lock_reason, "canceled");
  assert.equal(locked.billing.upgrade_available, true, "a new checkout is the way out");

  // Unknown event types are stored as ignored and never fail.
  const unknown = await h.webhook("unknown-event.json", "msg_8");
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.type, "ignored");
  assert.equal(h.repo.state.providerEvents.at(-1).status, "ignored");

  // Refunds and disputes land in the tenant ledger.
  await h.webhook("refund-create.json", "msg_9");
  await h.webhook("dispute-create.json", "msg_10");
  assert.equal(h.events("payment.refunded").length, 1);
  assert.equal(h.events("payment.disputed").length, 1);

  // Bad signature answers 401 and stores nothing.
  const before = h.repo.state.providerEvents.length;
  const bad = await h.webhook("intent-succeeded-renewal.json", "msg_11", {
    "x-fixture-signature": "invalid",
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, "WEBHOOK_SIGNATURE_INVALID");
  assert.equal(h.repo.state.providerEvents.length, before);
});

test("subscription.create waits for a confirmed payment to activate", async () => {
  const h = harness();
  await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  h.provider.program("subscription-get.json");
  const created = await h.webhook("subscription-create.json", "msg_1");
  assert.equal(created.status, 200);
  assert.equal(h.business().billing_status, "trialing");
  assert.equal((await h.repo.getCheckout(CHK)).status, "open");
  assert.equal(h.events("subscription.activated").length, 0);
  assert.equal(h.events("payment.succeeded").length, 0);
  const paid = await h.webhook("intent-succeeded-first.json", "msg_2");
  assert.equal(paid.status, 200);
  assert.equal(h.events("payment.succeeded").length, 1);
  assert.equal(h.events("subscription.renewed").length, 0, "the first payment is not a renewal");
  assert.equal(h.events("subscription.activated").length, 1);
  assert.equal(h.repo.state.subscriptions.length, 1);
});

test("a failing provider read fails the event (500) and a redelivery is reprocessed", async () => {
  const h = harness();
  await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  h.provider.program("subscription-get.json");
  await h.webhook("intent-succeeded-first.json", "msg_1");
  h.provider.failNext = new Error("recurrente down");
  const failed = await h.webhook("subscription-cancel.json", "msg_2");
  assert.equal(failed.status, 500);
  assert.equal(failed.body.code, "BILLING_WEBHOOK_FAILED");
  assert.equal(h.repo.state.providerEvents.at(-1).status, "failed");
  assert.equal(h.business().billing_status, "active");
  h.clock.now = new Date("2027-02-16T15:00:00.000Z");
  h.provider.program("subscription-get-cancelled.json");
  const retried = await h.webhook("subscription-cancel.json", "msg_2");
  assert.equal(retried.status, 200);
  assert.equal(retried.body.duplicate, undefined, "a failed delivery is not a duplicate");
  assert.equal(h.repo.state.providerEvents.at(-1).status, "processed");
  assert.equal(h.business().billing_status, "locked");
});

test("plan change: upgrades now_and_charge update the entitlement, downgrades wait for the next cycle", async () => {
  const h = harness();
  await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  h.provider.program("subscription-get.json");
  await h.webhook("intent-succeeded-first.json", "msg_1");

  const up = await h.service.changePlan({ businessId: BIZ, plan: "EMPRESA" });
  const change = h.provider.calls.filter((c) => c.method === "changeSubscription").at(-1).args[1];
  assert.deepEqual(change, { plan: "EMPRESA", quantity: 1, mode: "now_and_charge" });
  assert.equal(up.plan, "EMPRESA");
  assert.equal(up.unit_amount_minor, 103000);
  assert.equal(h.business().plan, "EMPRESA");
  assert.equal(h.events("subscription.changed").at(-1).metadata.applied, true);

  const down = await h.service.changePlan({ businessId: BIZ, plan: "NEGOCIO" });
  assert.equal(
    h.provider.calls.filter((c) => c.method === "changeSubscription").at(-1).args[1].mode,
    "next_cycle",
  );
  assert.equal(down.plan, "EMPRESA", "the paid plan stays until the cycle turns");
  assert.equal(down.pending_plan, "NEGOCIO");
  assert.equal(h.business().plan, "EMPRESA");

  const same = await h.service.changePlan({ businessId: BIZ, plan: "EMPRESA" });
  assert.equal(same.plan, "EMPRESA");

  const crowded = harness();
  await crowded.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  crowded.provider.program("subscription-get.json");
  await crowded.webhook("intent-succeeded-first.json", "msg_1");
  crowded.clock.branches = 4;
  await assert.rejects(
    crowded.service.changePlan({ businessId: BIZ, plan: "EMPRENDEDOR" }),
    (e) => err(e).statusCode === 409 && err(e).code === "BILLING_PLAN_LIMITS",
  );
  const none = harness();
  await assert.rejects(
    none.service.changePlan({ businessId: BIZ, plan: "NEGOCIO" }),
    (e) => err(e).code === "BILLING_NO_SUBSCRIPTION",
  );
});

test("owner cancel schedules the end of the period; the reconcile locks once it passes", async () => {
  const h = harness();
  await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  h.provider.program("subscription-get.json");
  await h.webhook("intent-succeeded-first.json", "msg_1");
  const scheduled = await h.service.cancel({ businessId: BIZ, atPeriodEnd: true, by: "owner-1" });
  assert.equal(scheduled.status, "active");
  assert.equal(scheduled.cancel_at, "2027-01-01T14:03:21.000Z");
  assert.equal(h.business().billing_status, "active", "access continues until the period end");
  assert.equal(h.events("subscription.cancel_requested").length, 1);

  // The provider ends it at the period end (webhook or reconcile read).
  h.clock.now = new Date("2027-01-01T15:00:00.000Z");
  const snap = h.provider.snapshots.get("su_fixture01");
  snap.status = "canceled";
  snap.metadata.provider_ended_at = "2027-01-01T14:03:21.000Z";
  snap.metadata.provider_cancellation_reason = "cancellation_requested";
  const summary = await h.service.reconcileOnce({ now: h.clock.now });
  assert.equal(summary.subscriptions_checked, 1);
  assert.equal(h.business().billing_status, "locked");
  assert.equal(h.events("subscription.canceled").at(-1).metadata.source, "reconcile");
  assert.equal(h.business().purge_after.getTime(), h.clock.now.getTime() + 30 * DAY);
});

test("reconcile: stale checkouts expire, the past-due grace lock applies after 7 days and a later payment unlocks", async () => {
  const h = harness();
  await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  h.clock.now = new Date(h.clock.now.getTime() + 2 * DAY);
  let summary = await h.service.reconcileOnce({ now: h.clock.now });
  assert.equal(summary.checkouts_expired, 1);
  assert.equal(h.events("checkout.expired").length, 1);
  assert.equal(
    (await h.service.checkoutStatus({ businessId: BIZ, checkoutId: CHK })).status,
    "expired",
  );

  const second = await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  assert.notEqual(second.checkout.id, CHK);
  h.provider.program("subscription-get.json");
  h.provider.program("subscription-get.json", { checkoutId: second.checkout.id });
  const paid = JSON.stringify({
    ...loadFixture("intent-succeeded-first.json", { checkoutId: second.checkout.id }),
    checkout: {
      ...loadFixture("intent-succeeded-first.json", { checkoutId: second.checkout.id }).checkout,
      id: "ch_fixture02",
    },
  });
  const hook = await h.service.handleWebhook({
    provider: "recurrente",
    rawBody: paid,
    headers: { "svix-id": "msg_1" },
  });
  assert.equal(hook.status, 200, JSON.stringify(hook.body));
  assert.equal(h.business().billing_status, "active");

  // The provider reports past_due; day 0 keeps access, day 7 locks without a retention clock.
  h.clock.now = new Date("2027-02-01T14:10:00.000Z");
  const pastDue = h.provider.program("subscription-get-past-due.json");
  summary = await h.service.reconcileOnce({ now: h.clock.now });
  assert.equal(summary.subscriptions_checked, 1);
  assert.equal(h.business().billing_status, "past_due");
  h.clock.now = new Date(h.clock.now.getTime() + (PAST_DUE_GRACE_DAYS - 1) * DAY);
  await h.service.reconcileOnce({ now: h.clock.now });
  assert.equal(h.business().billing_status, "past_due", "day 6 still in grace");
  h.clock.now = new Date(h.clock.now.getTime() + 1 * DAY);
  await h.service.reconcileOnce({ now: h.clock.now });
  assert.equal(h.business().billing_status, "locked");
  assert.equal(h.business().purge_after, null, "a payment lock has no retention clock");
  assert.equal(h.events("subscription.locked").at(-1).metadata.reason, "past_due");
  assert.equal((await h.service.overview(BIZ)).billing.lock_reason, "payment_failed");
  assert.equal(pastDue.status, "past_due");

  // The retry succeeds: unlocked.
  h.provider.program("subscription-get.json");
  const recovered = await h.webhook("intent-succeeded-renewal.json", "msg_2");
  assert.equal(recovered.status, 200);
  assert.equal(h.business().billing_status, "active");
  assert.equal(h.business().locked_at, null);
});

test("branch hook: quantity follows the branch count, charges now when adding, waits a cycle when removing, never throws", async () => {
  const h = harness();
  await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  h.provider.program("subscription-get.json");
  await h.webhook("intent-succeeded-first.json", "msg_1");
  assert.equal(h.repo.state.subscriptions[0].quantity, 1);
  assert.deepEqual(
    await h.service.syncBranchQuantity({ businessId: BIZ, reason: "branch_added" }),
    {
      skipped: "unchanged",
    },
  );

  h.clock.branches = 2;
  const grown = await h.service.syncBranchQuantity({ businessId: BIZ, reason: "branch_added" });
  assert.deepEqual(grown, { changed: true, quantity: 2, mode: "now_and_charge", applied: true });
  assert.equal(h.repo.state.subscriptions[0].quantity, 2);
  assert.deepEqual(h.provider.calls.filter((c) => c.method === "changeSubscription").at(-1).args, [
    "su_fixture01",
    { quantity: 2, mode: "now_and_charge" },
  ]);
  assert.equal(h.events("subscription.changed").at(-1).metadata.reason, "branch_added");

  // Fewer branches: next cycle, the paid quantity stays until the provider applies it.
  h.clock.branches = 1;
  const shrunk = await h.service.syncBranchQuantity({ businessId: BIZ, reason: "branch_removed" });
  assert.deepEqual(shrunk, { changed: true, quantity: 1, mode: "next_cycle", applied: false });
  assert.equal(h.repo.state.subscriptions[0].quantity, 2);
  assert.equal(h.repo.state.subscriptions[0].metadata.pending_quantity, 1);
  // The provider later reports the new quantity; the reconcile converges and clears the pending mark.
  h.provider.snapshots.get("su_fixture01").quantity = 1;
  await h.service.reconcileOnce({ now: h.clock.now });
  assert.equal(h.repo.state.subscriptions[0].quantity, 1);
  assert.equal(h.repo.state.subscriptions[0].metadata.pending_quantity, null);

  // Provider failure: logged and recorded, never thrown.
  h.clock.branches = 3;
  h.provider.failNext = new Error("boom");
  const failed = await h.service.syncBranchQuantity({ businessId: BIZ, reason: "branch_added" });
  assert.deepEqual(failed, { failed: "SYNC_ERROR" });
  assert.equal(h.events("subscription.sync_failed").length, 1);

  const noSub = await h.service.syncBranchQuantity({
    businessId: "33333333-3333-4333-8333-333333333333",
    reason: "branch_removed",
  });
  assert.deepEqual(noSub, { skipped: "no_provider_subscription" });

  // The tenth branch exceeds the provider's quantity limit: recorded, not blocking.
  h.clock.branches = 10;
  assert.deepEqual(
    await h.service.syncBranchQuantity({ businessId: BIZ, reason: "branch_added" }),
    {
      failed: "BILLING_QUANTITY_LIMIT",
    },
  );
  assert.equal(h.events("subscription.sync_failed").at(-1).metadata.code, "BILLING_QUANTITY_LIMIT");

  // Manual subscriptions are never synced to a provider.
  const manual = harness({
    configured: false,
    business: { billing_status: "active", trial_status: "converted" },
  });
  await manual.repo.insertSubscription({
    id: crypto.randomUUID(),
    businessId: BIZ,
    provider: "manual",
    providerSubscriptionId: "manual:1",
    checkoutId: null,
    plan: "NEGOCIO",
    quantity: 1,
    currency: "USD",
    unitAmountMinor: 63000,
    status: "active",
    currentPeriodStart: manual.clock.now,
    currentPeriodEnd: null,
    cancelAt: null,
    metadata: {},
  });
  assert.deepEqual(
    await manual.service.syncBranchQuantity({ businessId: BIZ, reason: "branch_added" }),
    {
      skipped: "no_provider_subscription",
    },
  );
});

test("super cancel ends a provider or manual subscription now and locks with the retention clock", async () => {
  const h = harness();
  await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  h.provider.program("subscription-get.json");
  await h.webhook("intent-succeeded-first.json", "msg_1");
  const out = await h.service.superCancel({
    businessId: BIZ,
    atPeriodEnd: false,
    by: "super@example.com",
  });
  assert.equal(out.ended, true);
  assert.equal(out.subscription.status, "canceled");
  assert.equal(h.business().billing_status, "locked");
  assert.equal(h.business().purge_after.getTime(), h.clock.now.getTime() + 30 * DAY);
  assert.equal(
    h.provider.calls.filter((c) => c.method === "cancel").at(-1).args[1].atPeriodEnd,
    false,
  );

  const manual = harness({
    configured: false,
    business: { billing_status: "active", trial_status: "converted", plan: "NEGOCIO" },
  });
  await manual.repo.insertSubscription({
    id: crypto.randomUUID(),
    businessId: BIZ,
    provider: "manual",
    providerSubscriptionId: "manual:1",
    checkoutId: null,
    plan: "NEGOCIO",
    quantity: 1,
    currency: "USD",
    unitAmountMinor: 63000,
    status: "active",
    currentPeriodStart: manual.clock.now,
    currentPeriodEnd: null,
    cancelAt: null,
    metadata: {},
  });
  const ended = await manual.service.superCancel({
    businessId: BIZ,
    atPeriodEnd: false,
    by: "super@example.com",
  });
  assert.equal(ended.ended, true);
  assert.equal(manual.business().billing_status, "locked");
  await assert.rejects(
    manual.service.superCancel({ businessId: BIZ }),
    (e) => err(e).code === "BILLING_NO_SUBSCRIPTION",
  );
});

test("catalog sync creates the six products (USD and GTQ for every plan) from the code defaults, keeps existing ids unless forced", async () => {
  const empty = harness({ catalog: resolveBillingCatalog({}) });
  const first = await empty.service.syncCatalog();
  assert.deepEqual(
    first.created.map((c) => `${c.currency}:${c.plan}`),
    [
      "USD:EMPRENDEDOR",
      "USD:NEGOCIO",
      "USD:EMPRESA",
      "GTQ:EMPRENDEDOR",
      "GTQ:NEGOCIO",
      "GTQ:EMPRESA",
    ],
  );
  assert.equal(first.kept.length, 0);
  assert.equal(first.live_mode, false);
  assert.equal(empty.getCatalog().providers.recurrente.price_ids.USD.NEGOCIO, "price_negocio_usd");
  assert.equal(empty.getCatalog().providers.recurrente.price_ids.GTQ.NEGOCIO, "price_negocio_gtq");
  const products = empty.provider.calls
    .filter((c) => c.method === "createProduct")
    .map((c) => c.args[0]);
  assert.equal(products[1].unitAmountMinor, 7900);
  assert.equal(products[1].billingInfoRequired, false);
  assert.match(products[1].name, /Impulsa \(USD\)/);
  assert.match(products[1].description, /USD 79 por sucursal al mes, IVA incluido/);
  const gtqProduct = products.find((p) => p.currency === "GTQ");
  assert.equal(
    gtqProduct.billingInfoRequired,
    false,
    "the NIT is never collected: PF does not issue FEL",
  );
  assert.equal(gtqProduct.unitAmountMinor, 30000, "Q300 list price from the code default");
  assert.deepEqual(
    products.filter((p) => p.currency === "GTQ").map((p) => p.unitAmountMinor),
    [30000, 63000, 103000],
  );
  assert.deepEqual(catalogReadiness(empty.getCatalog()), { usd: false, gtq: true });

  const second = await empty.service.syncCatalog();
  assert.equal(second.created.length, 0);
  assert.equal(second.kept.length, 6);

  const withGtq = harness({
    catalog: resolveBillingCatalog({ gtq: { EMPRENDEDOR: 350, NEGOCIO: 600, EMPRESA: 999 } }),
  });
  const six = await withGtq.service.syncCatalog();
  assert.equal(six.created.length, 6);
  const overridden = withGtq.provider.calls
    .filter((c) => c.method === "createProduct")
    .find((c) => c.args[0].currency === "GTQ").args[0];
  assert.equal(overridden.unitAmountMinor, 35000, "the platform setting overrides the default");

  const forced = await withGtq.service.syncCatalog({ force: true });
  assert.equal(forced.created.length, 6);

  const unconfigured = harness({ configured: false });
  await assert.rejects(
    unconfigured.service.syncCatalog(),
    (e) => err(e).statusCode === 503 && err(e).code === "BILLING_UNAVAILABLE",
  );
});

test("live-mode mismatch and unmatched events are stored as ignored, never as failures", async () => {
  const h = harness();
  h.provider.liveMode = true;
  const mismatch = await h.webhook("intent-succeeded-renewal.json", "msg_1");
  assert.equal(mismatch.status, 200);
  assert.equal(mismatch.body.handled, false);
  assert.equal(h.repo.state.providerEvents.at(-1).error, "live_mode_mismatch");
  h.provider.liveMode = false;
  const unmatched = await h.webhook("intent-succeeded-renewal.json", "msg_2");
  assert.equal(unmatched.status, 200);
  assert.equal(unmatched.body.note, "unmatched_payment");
  assert.equal(h.repo.state.providerEvents.at(-1).status, "ignored");
});

function stripeHarness() {
  return harness({
    stripe: true,
    catalog: stripeCatalog(),
    business: {
      program_json: { region: { country: "SV", timezone: "America/El_Salvador" } },
    },
  });
}

test("Stripe USD checkout, price/quantity limits, one pending session, paid confirmation and deduplicated renewal", async () => {
  const h = stripeHarness();
  const f = h.processor;
  const hook = (type, object, id = undefined) =>
    h.service.handleWebhook(f.signed(f.event(type, object, id)));
  assert.equal((await h.service.overview(BIZ)).billing.provider, "stripe");
  assert.equal(await h.service.upgradeAvailable(h.business(), null), true);
  assert.deepEqual((await h.service.overview(BIZ)).catalog.currencies, ["USD"]);
  for (const candidate of [h, harness()]) {
    candidate.clock.branches = 2;
    await assert.rejects(
      candidate.service.startCheckout({ businessId: BIZ, plan: "EMPRENDEDOR" }),
      { code: "BILLING_PLAN_LIMITS" },
    );
  }
  h.clock.branches = 1;
  const started = await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  assert.equal(started.checkout.unit_amount_minor, 7900);
  const call = f.calls.find((c) => c.path === "/v1/checkout/sessions");
  assert.equal(call.form.get("mode"), "subscription");
  assert.equal(call.form.get("line_items[0][price]"), "price_stripe_NEGOCIO");
  assert.equal(call.form.get("adaptive_pricing[enabled]"), "false");
  assert.equal(call.form.get("subscription_data[metadata][checkout_id]"), CHK);
  assert.equal(call.headers["Idempotency-Key"], CHK);
  assert.equal(call.headers["Stripe-Version"], "2026-11-18.endive");
  assert.equal((await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" })).reused, true);
  await assert.rejects(h.service.startCheckout({ businessId: BIZ, plan: "EMPRESA" }), {
    code: "BILLING_CHECKOUT_PENDING",
  });
  await hook("checkout.session.completed", f.session);
  await hook("customer.subscription.created", f.sub);
  assert.equal(
    (await h.service.checkoutStatus({ businessId: BIZ, checkoutId: CHK })).status,
    "pending",
  );
  assert.equal(h.business().billing_status, "trialing");
  const paid = f.event("invoice.paid", f.invoice);
  const signed = f.signed(paid);
  f.failNextRead();
  assert.equal((await h.service.handleWebhook(signed)).status, 500);
  assert.equal((await h.service.handleWebhook(signed)).body.handled, true);
  assert.equal(h.business().billing_status, "active");
  assert.equal(h.business().billing_currency, "USD");
  assert.equal(h.repo.state.subscriptions[0].provider, "stripe");
  assert.equal(
    (
      await h.service.handleWebhook({
        ...signed,
        headers: { ...signed.headers, "svix-id": "other" },
      })
    ).body.duplicate,
    true,
  );
  await hook("invoice.paid", f.invoice);
  assert.equal(h.events("payment.succeeded").length, 1);
  assert.equal((await h.service.invoices(BIZ))[0].tax_invoice_url, f.invoice.hosted_invoice_url);
  f.invoice.id = "in_renewal";
  await hook("invoice.paid", f.invoice);
  assert.equal(h.events("payment.succeeded").length, 2);
  assert.equal(h.events("subscription.renewed").length, 1);
  await h.service.changePlan({ businessId: BIZ, plan: "EMPRESA" });
  assert.equal(h.business().plan, "EMPRESA");
  assert.equal(f.calls.at(-1).form.get("payment_behavior"), "error_if_incomplete");
  assert.equal(f.calls.at(-1).form.get("proration_behavior"), "always_invoice");
  const down = await h.service.changePlan({ businessId: BIZ, plan: "NEGOCIO" });
  assert.equal(f.calls.at(-1).form.get("proration_behavior"), "none");
  assert.equal(down.plan, "EMPRESA");
  assert.equal(down.pending_plan, "NEGOCIO");
  h.getCatalog().providers.stripe.price_ids.USD = {};
  const view = await h.service.overview(BIZ);
  assert.equal(view.billing.cancel_available, true);
  assert.equal(view.billing.change_available, false);
  assert.equal(
    await h.service.upgradeAvailable(h.business(), h.repo.state.subscriptions[0]),
    false,
  );
  const canceled = await h.service.cancel({ businessId: BIZ });
  assert.equal(canceled.cancel_at, new Date(f.item.current_period_end * 1000).toISOString());
});

test("Stripe payment requires the owned checkout, customer, active monthly subscription and positive paid invoice", async () => {
  const cases = [
    (f) => {
      f.invoice.status = "open";
    },
    (f) => {
      f.invoice.amount_paid = 0;
    },
    (f) => {
      f.invoice.amount_paid = 1;
    },
    (f) => {
      f.invoice.currency = "gtq";
    },
    (f) => {
      f.invoice.customer = "cus_other";
    },
    (f) => {
      f.metadata.business_id = crypto.randomUUID();
    },
    (f) => {
      f.metadata.checkout_id = crypto.randomUUID();
    },
    (f) => {
      f.session.subscription = "sub_other";
    },
    (f) => {
      f.session.payment_status = "unpaid";
    },
    (f) => {
      f.sub.customer = "cus_other";
    },
    (f) => {
      f.sub.status = "trialing";
    },
    (f) => {
      f.sub.status = "incomplete";
    },
    (f) => {
      f.sub.status = "canceled";
    },
    (f) => {
      f.sub.latest_invoice = { ...f.invoice, status: "open" };
    },
    (f) => {
      f.item.price.id = "price_unrecognized";
    },
    (f) => {
      f.item.price.unit_amount = 1;
    },
    (f) => {
      f.item.price.recurring.interval = "year";
    },
    (f) => {
      f.item.quantity = 9;
    },
    (f) => {
      f.item.current_period_end = 1;
    },
    (_f, h) => {
      h.repo.state.checkouts[0].provider = "recurrente";
    },
    (_f, h) => {
      h.repo.state.checkouts[0].status = "abandoned";
    },
  ];
  for (const alter of cases) {
    const h = stripeHarness(),
      f = h.processor;
    await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
    alter(f, h);
    const result = await h.service.handleWebhook(f.signed(f.event("invoice.paid", f.invoice)));
    assert.equal(result.status, 200, String(alter));
    assert.equal(h.repo.state.subscriptions.length, 0, String(alter));
    assert.equal(h.business().billing_status, "trialing", String(alter));
  }
});

test("Stripe expiry and mode mismatch, unsigned or stale bytes and signed envelope without an ID", async () => {
  const h = stripeHarness(),
    f = h.processor;
  await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  const event = f.event("checkout.session.expired", f.session);
  const valid = f.signed(event);
  assert.equal(
    (await h.service.handleWebhook({ ...valid, rawBody: valid.rawBody + " " })).status,
    401,
  );
  assert.equal((await h.service.handleWebhook(f.signed(event, 1))).status, 401);
  await assert.rejects(h.service.handleWebhook(f.signed({ ...event, id: undefined })), {
    statusCode: 400,
  });
  assert.equal(h.repo.state.providerEvents.length, 0);
  const wrong = await h.service.handleWebhook(
    f.signed({ ...event, id: "evt_mode", livemode: true }),
  );
  assert.equal(wrong.body.note, "live_mode_mismatch");
  await h.service.handleWebhook(valid);
  assert.equal((await h.repo.getCheckout(CHK)).status, "expired");
  assert.equal(h.events("checkout.expired").length, 1);
});

test("legacy USD Recurrente subscriptions use their own processor and price ids", async () => {
  const h = stripeHarness();
  h.provider.program("subscription-get.json").currency = "USD";
  await h.repo.insertSubscription({
    id: crypto.randomUUID(),
    businessId: BIZ,
    provider: "recurrente",
    providerSubscriptionId: "su_fixture01",
    checkoutId: null,
    plan: "NEGOCIO",
    quantity: 1,
    currency: "USD",
    unitAmountMinor: 7900,
    status: "active",
    metadata: {},
  });
  h.getCatalog().providers.stripe.price_ids.USD = {};
  const view = await h.service.overview(BIZ);
  assert.equal(view.billing.provider, "recurrente");
  assert.equal(view.billing.change_available, true);
  await h.service.changePlan({ businessId: BIZ, plan: "EMPRESA" });
  assert.equal((await h.service.reconcileOnce()).subscriptions_checked, 1);
  await h.service.cancel({ businessId: BIZ });
  assert.equal(h.processor.calls.length, 0);
});

test("Stripe catalog sync writes only monthly inclusive USD prices and force replaces stored ids", async () => {
  const h = harness({ stripe: true, catalog: gtqFixtureCatalog() });
  const previous = structuredClone(h.getCatalog().providers.recurrente);
  const out = await h.service.syncCatalog({ provider: "stripe" });
  assert.equal(out.provider, "stripe");
  assert.equal(out.created.length, 3);
  assert.deepEqual(out.catalog.providers.recurrente, previous);
  for (const call of h.processor.calls.filter((c) => c.method === "POST")) {
    assert.equal(call.form.get("currency"), "usd");
    assert.equal(call.form.get("tax_behavior"), "inclusive");
    assert.equal(call.form.get("recurring[interval]"), "month");
  }
  assert.equal((await h.service.syncCatalog({ provider: "stripe" })).kept.length, 3);
  assert.equal(
    (await h.service.syncCatalog({ provider: "stripe", force: true })).created.length,
    3,
  );
  assert.equal(h.provider.calls.length, 0);
});

test("unrelated Stripe invoices retain only the event identifier and timestamp", async () => {
  const h = stripeHarness(),
    f = h.processor;
  const unrelated = {
    ...f.invoice,
    customer: "cus_external",
    customer_email: "unrelated@example.org",
    customer_address: { line1: "unrelated address" },
    hosted_invoice_url: "https://invoice.stripe.com/private",
  };
  const event = f.event("invoice.paid", unrelated);
  const result = await h.service.handleWebhook(f.signed(event));
  assert.equal(result.body.handled, false);
  assert.deepEqual(h.repo.state.providerEvents[0].payload, {
    id: event.id,
    created_at: h.clock.now.toISOString(),
  });
  await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  await h.service.handleWebhook(
    f.signed(f.event("invoice.paid", { ...f.invoice, customer_email: "private@example.org" })),
  );
  const stored = h.repo.state.providerEvents.at(-1).payload;
  assert.equal(stored.tax_invoice_url, f.invoice.hosted_invoice_url);
  assert.equal(stored.amount_in_cents, 7900);
  assert.equal("data" in stored, false);
  assert.doesNotMatch(JSON.stringify(stored), /private@example/);
});

test("Stripe grace, recovery, refunds and disputes stay bound to the processor customer", async () => {
  const h = stripeHarness(),
    f = h.processor;
  const send = (type, object) => h.service.handleWebhook(f.signed(f.event(type, object)));
  await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  await send("invoice.paid", f.invoice);
  f.sub.status = "past_due";
  f.invoice.id = "in_failed";
  f.invoice.status = "open";
  f.invoice.amount_paid = 0;
  await send("invoice.payment_failed", f.invoice);
  assert.equal(h.business().billing_status, "past_due");
  h.clock.now = new Date(h.clock.now.getTime() + 8 * DAY);
  await h.service.reconcileOnce();
  assert.equal(h.business().billing_status, "locked");
  f.sub.status = "active";
  await send("customer.subscription.updated", f.sub);
  assert.equal(h.business().billing_status, "locked");
  f.invoice.status = "paid";
  f.invoice.amount_paid = 7900;
  await send("invoice.paid", f.invoice);
  assert.equal(h.business().billing_status, "active");
  await send("charge.refunded", {
    id: "ch_fixture",
    object: "charge",
    customer: f.sub.customer,
    amount_refunded: 1100,
    currency: "usd",
  });
  await send("charge.dispute.created", {
    id: "dp_fixture",
    object: "dispute",
    charge: "ch_fixture",
    amount: 800,
    currency: "usd",
  });
  assert.equal(h.events("payment.refunded")[0].metadata.amount_minor, 1100);
  assert.equal(h.events("payment.disputed")[0].businessId, BIZ);
  assert.equal(f.calls.at(-1).path, "/v1/charges/ch_fixture");
  await send("charge.refunded", {
    id: "ch_unknown",
    object: "charge",
    customer: "cus_unknown",
    amount_refunded: 250,
    currency: "usd",
  });
  assert.equal(h.events("payment.refunded").length, 1);
  const otherId = crypto.randomUUID();
  await h.repo.upsertCustomer({
    businessId: otherId,
    provider: "stripe",
    providerCustomerId: "cus_other",
  });
  await send("invoice.paid", { ...f.invoice, customer: "cus_other" });
  assert.equal(h.repo.state.providerEvents.at(-1).error, "ownership_mismatch");
});

test("late payment cannot replace a newer manual contract even after its cancellation", async () => {
  const h = stripeHarness(),
    f = h.processor;
  await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  const sub = await h.repo.insertSubscription({
    id: crypto.randomUUID(),
    businessId: BIZ,
    provider: "manual",
    providerSubscriptionId: "manual:fixture",
    plan: "EMPRESA",
    quantity: 1,
    currency: "USD",
    unitAmountMinor: 12900,
    status: "canceled",
    metadata: {},
  });
  sub.created_at = new Date(h.repo.state.checkouts[0].created_at.getTime() + 1000);
  const result = await h.service.handleWebhook(f.signed(f.event("invoice.paid", f.invoice)));
  assert.equal(result.body.note, "superseded_checkout");
  assert.equal(h.repo.state.subscriptions.length, 1);
  assert.equal(h.events("payment.succeeded").length, 0);
});

test("2023-10-16 checkout, subscription and invoice snapshots use the same billing path with pinned REST reads", async () => {
  const h = stripeHarness();
  const f = h.processor;
  await h.service.startCheckout({ businessId: BIZ, plan: "NEGOCIO" });
  const makeEvent = (type, object, api_version) => ({ ...f.event(type, object), api_version });
  const legacy = (type, object) => makeEvent(type, object, "2023-10-16");
  const modern = (type, object) => makeEvent(type, object, "2026-11-18.endive");
  const send = (event) => h.service.handleWebhook(f.signed(event));
  const normalized = (event) => {
    const parsed = f.provider.parseEvent(JSON.stringify(event));
    return {
      type: parsed.type,
      checkout: parsed.providerCheckoutId,
      subscription: parsed.providerSubscriptionId,
      customer: parsed.providerCustomerId,
      metadata: parsed.metadata,
      amount: parsed.amountMinor,
      currency: parsed.currency,
      invoice: parsed.invoiceId,
      receipt: parsed.taxInvoiceUrl,
    };
  };
  const session = legacy("checkout.session.completed", {
    ...f.session,
    client_reference_id: BIZ,
    subscription: f.sub.id,
  });
  assert.deepEqual(
    normalized(session),
    normalized(modern("checkout.session.completed", f.session)),
  );
  assert.equal((await send(session)).body.note, "awaiting_paid_invoice");

  const legacySub = {
    id: f.sub.id,
    object: "subscription",
    customer: f.sub.customer,
    status: "active",
    currency: "usd",
    current_period_start: f.item.current_period_start,
    current_period_end: f.item.current_period_end,
    metadata: f.metadata,
    latest_invoice: f.invoice.id,
    items: { data: [{ id: f.item.id, price: f.item.price, quantity: f.item.quantity }] },
  };
  const created = legacy("customer.subscription.created", legacySub);
  assert.deepEqual(normalized(created), normalized(modern("customer.subscription.created", f.sub)));
  assert.equal((await send(created)).body.note, "awaiting_paid_subscription");
  assert.equal(h.business().billing_status, "trialing");
  assert.equal((await h.repo.getCheckout(CHK)).status, "open");

  const { parent, ...oldInvoice } = f.invoice;
  const invoice = legacy("invoice.paid", {
    ...oldInvoice,
    subscription: f.sub.id,
    subscription_details: { metadata: parent.subscription_details.metadata },
    metadata: {},
    paid: true,
    paid_out_of_band: false,
  });
  assert.deepEqual(normalized(invoice), normalized(modern("invoice.paid", f.invoice)));
  assert.equal(normalized(invoice).subscription, f.sub.id);
  assert.equal(normalized(invoice).metadata.checkout_id, CHK);
  assert.equal((await send(invoice)).body.handled, true);
  assert.equal(h.business().billing_status, "active");
  assert.equal((await h.repo.getCheckout(CHK)).status, "paid");
  assert.equal((await send(invoice)).body.duplicate, true);
  assert.equal(
    (await send(modern("invoice.paid", f.invoice))).body.note,
    "invoice_already_recorded",
  );
  assert.equal(h.events("payment.succeeded").length, 1);

  // A stale legacy active event must converge on the current REST state.
  f.sub.status = "past_due";
  assert.equal((await send(legacy("customer.subscription.updated", legacySub))).body.handled, true);
  assert.equal(h.business().billing_status, "past_due");
  const reads = f.calls.filter((c) => c.path === "/v1/subscriptions/" + f.sub.id);
  assert.ok(reads.length >= 2);
  assert.ok(reads.every((c) => c.headers["Stripe-Version"] === "2026-11-18.endive"));
});
