import test from "node:test";
import assert from "node:assert/strict";
import {
  createRecurrenteProvider,
  parseRecurrenteEvent,
  RECURRENTE_API_BASE,
  signSvixPayload,
  subscriptionSnapshot,
  verifySvixSignature,
} from "../../src/app/services/billing/recurrente-provider.js";
import { BillingProviderError } from "../../src/app/services/billing/provider.js";
import {
  FIXTURE_BUSINESS_ID,
  FIXTURE_CHECKOUT_ID,
  fixtureCatalog,
  loadFixture,
} from "../fixtures/billing/memory-billing-repo.mjs";

/** @param {unknown} e @returns {any} */
const err = (e) => e;

// Built at runtime so no credential-shaped literal lives in the repository.
const secret = `whsec_${Buffer.from("puntos-fixture-signing-secret").toString("base64")}`;
const now = new Date("2026-12-01T14:10:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1000);
const catalog = fixtureCatalog();

test("Svix signature: valid, tampered, stale, multi-signature and missing headers", () => {
  const rawBody = JSON.stringify(loadFixture("intent-succeeded-first.json"));
  const headers = signSvixPayload({ secret, rawBody, id: "msg_1", timestamp: nowSeconds });
  assert.equal(verifySvixSignature({ secret, rawBody, headers, now }), true);
  assert.equal(
    verifySvixSignature({ secret, rawBody: rawBody.replace("7900", "7901"), headers, now }),
    false,
    "tampered body",
  );
  assert.equal(
    verifySvixSignature({
      secret,
      rawBody,
      headers: signSvixPayload({ secret, rawBody, id: "msg_1", timestamp: nowSeconds - 400 }),
      now,
    }),
    false,
    "stale timestamp (5 minute tolerance)",
  );
  assert.equal(
    verifySvixSignature({
      secret,
      rawBody,
      headers: {
        ...headers,
        "svix-signature": `v1,${"A".repeat(43)}= ${headers["svix-signature"]}`,
      },
      now,
    }),
    true,
    "any one of several space-separated v1 signatures matches",
  );
  assert.equal(
    verifySvixSignature({
      secret: `whsec_${Buffer.from("another-secret").toString("base64")}`,
      rawBody,
      headers,
      now,
    }),
    false,
    "wrong secret",
  );
  for (const missing of ["svix-id", "svix-timestamp", "svix-signature"]) {
    const partial = { ...headers };
    delete partial[missing];
    assert.equal(verifySvixSignature({ secret, rawBody, headers: partial, now }), false, missing);
  }
  assert.equal(verifySvixSignature({ secret: "", rawBody, headers, now }), false, "no secret");
  assert.equal(
    verifySvixSignature({ secret, rawBody, headers: { ...headers, "SVIX-ID": "msg_1" }, now }),
    true,
    "header lookup is case-insensitive",
  );
});

test("parseEvent maps every documented event type to the normalized BillingEvent", () => {
  const first = parseRecurrenteEvent(loadFixture("intent-succeeded-first.json"), {
    defaultLiveMode: true,
  });
  assert.equal(first.type, "payment_succeeded");
  assert.equal(first.id, "in_fixture001");
  assert.equal(first.occurredAt, "2026-12-01T14:03:21.000Z");
  assert.equal(first.liveMode, false, "checkout.live_mode wins over the key's environment");
  assert.equal(first.providerSubscriptionId, "su_fixture01");
  assert.equal(first.providerCheckoutId, "ch_fixture01");
  assert.equal(first.providerCustomerId, "cus_fixture01");
  assert.equal(first.amountMinor, 7900);
  assert.equal(first.currency, "USD");
  assert.equal(first.feeMinor, 357);
  assert.equal(first.taxInvoiceUrl, "https://app.recurrente.com/fel/in_fixture001");
  assert.equal(first.metadata.business_id, FIXTURE_BUSINESS_ID);
  assert.equal(first.metadata.checkout_id, FIXTURE_CHECKOUT_ID);
  assert.equal(first.metadata.quantity, "1", "metadata values are strings");

  const renewal = parseRecurrenteEvent(loadFixture("intent-succeeded-renewal.json"), {
    defaultLiveMode: false,
  });
  assert.equal(renewal.type, "payment_succeeded");
  assert.equal(renewal.providerCheckoutId, undefined, "renewals carry no checkout");
  assert.equal(renewal.providerSubscriptionId, "su_fixture01");

  const failed = parseRecurrenteEvent(loadFixture("intent-failed.json"));
  assert.equal(failed.type, "payment_failed");
  assert.equal(failed.taxInvoiceUrl, null);
  assert.equal(failed.feeMinor, 0);

  const created = parseRecurrenteEvent(loadFixture("subscription-create.json"), {
    defaultLiveMode: false,
  });
  assert.equal(created.type, "subscription_created");
  assert.equal(created.providerSubscriptionId, "su_fixture01", "subscription events use their id");
  assert.equal(created.providerCheckoutId, "ch_fixture01");
  assert.equal(created.metadata.checkout_id, FIXTURE_CHECKOUT_ID);
  assert.equal(created.liveMode, false);

  assert.equal(
    parseRecurrenteEvent(loadFixture("subscription-past-due.json")).type,
    "subscription_past_due",
  );
  assert.equal(
    parseRecurrenteEvent(loadFixture("subscription-item-added.json")).type,
    "subscription_updated",
  );
  assert.equal(
    parseRecurrenteEvent(loadFixture("subscription-update.json")).type,
    "subscription_updated",
  );
  assert.equal(
    parseRecurrenteEvent(loadFixture("subscription-cancel.json")).type,
    "subscription_canceled",
  );
  const refund = parseRecurrenteEvent(loadFixture("refund-create.json"));
  assert.equal(refund.type, "refund_created");
  assert.equal(refund.amountMinor, 7900);
  assert.equal(refund.providerSubscriptionId, "su_fixture01");
  assert.equal(parseRecurrenteEvent(loadFixture("dispute-create.json")).type, "dispute_opened");

  const unknown = parseRecurrenteEvent(loadFixture("unknown-event.json"), { now });
  assert.equal(unknown.type, "ignored");
  assert.equal(unknown.id, "wd_fixture01");
  assert.equal(parseRecurrenteEvent(null, { now }).type, "ignored");
  assert.match(parseRecurrenteEvent({}, { now }).id, /^recurrente:unknown:/);
});

test("subscriptionSnapshot resolves plan and currency from the price id and keeps provider facts", () => {
  const active = subscriptionSnapshot(loadFixture("subscription-get.json"), { catalog, now });
  assert.equal(active.providerSubscriptionId, "su_fixture01");
  assert.equal(active.status, "active");
  assert.equal(active.plan, "NEGOCIO");
  assert.equal(active.currency, "USD");
  assert.equal(active.quantity, 1);
  assert.equal(active.unitAmountMinor, 7900);
  assert.equal(active.currentPeriodEnd, "2027-01-01T14:03:21.000Z");
  assert.equal(active.cancelAt, null);
  assert.equal(active.metadata.business_id, FIXTURE_BUSINESS_ID);
  assert.equal(active.metadata.provider_price_id, "price_negocio_usd");
  assert.equal(active.metadata.provider_payment_retries, "0");

  const cancelled = subscriptionSnapshot(loadFixture("subscription-get-cancelled.json"), {
    catalog,
    now,
  });
  assert.equal(cancelled.status, "canceled");
  assert.equal(cancelled.cancelAt, "2027-02-16T14:05:00.000Z");
  assert.equal(cancelled.metadata.provider_cancellation_reason, "payment_failed");
  assert.equal(cancelled.metadata.provider_ended_at, "2027-02-16T14:05:00.000Z");
  assert.equal(cancelled.metadata.provider_payment_retries, "15");

  const pastDue = subscriptionSnapshot(loadFixture("subscription-get-past-due.json"), {
    catalog,
    now,
  });
  assert.equal(pastDue.status, "past_due");
  assert.equal(pastDue.metadata.provider_next_payment_attempt_at, "2027-02-02T14:05:00.000Z");

  // Without a price id match the plan falls back to the metadata.
  const unknownPrice = loadFixture("subscription-get.json");
  unknownPrice.items[0].price_id = "price_other";
  const fallback = subscriptionSnapshot(unknownPrice, { catalog, now });
  assert.equal(fallback.plan, "NEGOCIO");
  assert.equal(fallback.currency, "USD");
});

/** @param {Array<{ status: number, body: unknown }>} answers */
function fakeFetch(answers) {
  /** @type {Array<{ url: string, init: any, body: any }>} */
  const calls = [];
  const fetch = async (url, init) => {
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected request ${init.method} ${url}`);
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    return {
      ok: answer.status < 400,
      status: answer.status,
      text: async () => JSON.stringify(answer.body),
    };
  };
  return { fetch, calls };
}

/** @param {Array<{ status: number, body: unknown }>} answers @param {string} [secretKey] */
function provider(answers, secretKey = "sk_test_abc") {
  const { fetch, calls } = fakeFetch(answers);
  return {
    calls,
    provider: createRecurrenteProvider({
      fetch,
      config: { secretKey, webhookSecret: secret, getCatalog: async () => catalog, now: () => now },
    }),
  };
}

test("the key prefix fixes live mode and the mapper requires a key", () => {
  assert.equal(provider([]).provider.liveMode, false);
  assert.equal(provider([], "sk_live_abc").provider.liveMode, true);
  assert.throws(() =>
    createRecurrenteProvider({
      fetch: async () => ({ ok: true, status: 200, text: async () => "" }),
      config: { secretKey: "", webhookSecret: "", getCatalog: async () => catalog },
    }),
  );
});

test("createCustomer and createCheckout send the documented bodies, headers and Idempotency-Key", async () => {
  const { provider: p, calls } = provider([
    { status: 201, body: loadFixture("customer-create-response.json") },
    { status: 201, body: loadFixture("checkout-create-response.json") },
  ]);
  const customer = await p.createCustomer({
    businessId: FIXTURE_BUSINESS_ID,
    email: "owner@example.com",
    name: "Café Uno",
    phone: "+50255551234",
  });
  assert.deepEqual(customer, { provider: "recurrente", providerCustomerId: "cus_fixture01" });
  assert.equal(calls[0].url, `${RECURRENTE_API_BASE}/customers`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["X-SECRET-KEY"], "sk_test_abc");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(calls[0].body, {
    email: "owner@example.com",
    full_name: "Café Uno",
    phone: "+50255551234",
    metadata: { business_id: FIXTURE_BUSINESS_ID },
  });

  const checkout = await p.createCheckout({
    customer,
    plan: "NEGOCIO",
    quantity: 2,
    currency: "USD",
    successUrl: "https://app.test/negocio/#plan?checkout=x",
    cancelUrl: "https://app.test/negocio/#plan?checkout=x&cancelado=1",
    metadata: { business_id: FIXTURE_BUSINESS_ID, checkout_id: FIXTURE_CHECKOUT_ID },
    idempotencyKey: FIXTURE_CHECKOUT_ID,
  });
  assert.equal(checkout.providerCheckoutId, "ch_fixture01");
  assert.equal(checkout.url, "https://app.recurrente.com/checkout-session/ch_fixture01");
  assert.equal(checkout.unitAmountMinor, 7900);
  assert.equal(checkout.expiresAt, "2026-12-02T14:00:00.000Z");
  assert.equal(calls[1].url, `${RECURRENTE_API_BASE}/checkouts`);
  assert.equal(calls[1].init.headers["Idempotency-Key"], FIXTURE_CHECKOUT_ID);
  assert.deepEqual(calls[1].body.items, [{ price_id: "price_negocio_usd", quantity: 2 }]);
  assert.equal(calls[1].body.customer_id, "cus_fixture01");
  assert.equal(calls[1].body.success_url, "https://app.test/negocio/#plan?checkout=x");
  assert.deepEqual(calls[1].body.metadata, {
    business_id: FIXTURE_BUSINESS_ID,
    checkout_id: FIXTURE_CHECKOUT_ID,
  });
  assert.equal(calls[1].body.expires_at, "2026-12-02T14:10:00.000Z", "24 hours from now");
});

test("a checkout for a currency without catalog price ids is refused before any request", async () => {
  const { provider: p, calls } = provider([]);
  await assert.rejects(
    p.createCheckout({
      customer: { provider: "recurrente", providerCustomerId: "cus_x" },
      plan: "NEGOCIO",
      quantity: 1,
      currency: "GTQ",
      successUrl: "https://a/",
      cancelUrl: "https://a/",
      metadata: {},
      idempotencyKey: "k",
    }),
    (error) => err(error).statusCode === 503 && err(error).code === "BILLING_UNAVAILABLE",
  );
  assert.equal(calls.length, 0);
});

test("upstream failures become BillingProviderError 502 with the upstream status and code", async () => {
  const { provider: p } = provider([
    {
      status: 422,
      body: { message: "amount_exceeds_unverified_limit", code: "amount_exceeds_unverified_limit" },
    },
  ]);
  await assert.rejects(
    p.createCustomer({ businessId: FIXTURE_BUSINESS_ID, email: "a@b.c", name: "A" }),
    (error) =>
      err(error) instanceof BillingProviderError &&
      err(error).statusCode === 502 &&
      err(error).code === "BILLING_PROVIDER_ERROR" &&
      err(error).upstreamStatus === 422 &&
      err(error).providerCode === "amount_exceeds_unverified_limit" &&
      !err(error).message.includes("sk_test"),
  );
});

test("fetchSubscription, changeSubscription (plan swap and quantity) and cancel use the documented calls", async () => {
  const sub = loadFixture("subscription-get.json");
  const swapped = {
    ...sub,
    items: [{ ...sub.items[0], price_id: "price_empresa_usd", product_id: "prod_empresa_usd" }],
  };
  const { provider: p, calls } = provider([
    { status: 200, body: sub }, // fetchSubscription
    { status: 200, body: sub }, // changeSubscription: read current
    { status: 200, body: swapped }, // PUT plan swap
    { status: 200, body: sub }, // changeSubscription quantity: read current
    { status: 200, body: { ...sub, items: [{ ...sub.items[0], quantity: 3 }] } }, // PUT quantity
    {
      status: 200,
      body: { ...sub, cancel_at: sub.current_period_end, cancel_at_period_end: true },
    }, // PUT cancel at period end
    { status: 204, body: null }, // DELETE
    { status: 200, body: loadFixture("subscription-get-cancelled.json") }, // GET after DELETE
  ]);
  const snapshot = await p.fetchSubscription("su_fixture01");
  assert.equal(calls[0].url, `${RECURRENTE_API_BASE}/subscriptions/su_fixture01`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(snapshot.plan, "NEGOCIO");

  const upgraded = await p.changeSubscription("su_fixture01", {
    plan: "EMPRESA",
    quantity: 1,
    mode: "now_and_charge",
  });
  assert.equal(calls[2].init.method, "PUT");
  assert.ok(calls[2].init.headers["Idempotency-Key"]);
  assert.deepEqual(calls[2].body, {
    items: [
      { price_id: "price_negocio_usd", deleted: true },
      { price_id: "price_empresa_usd", quantity: 1 },
    ],
    mode: "now_and_charge",
  });
  assert.equal(upgraded.plan, "EMPRESA");
  assert.equal(upgraded.unitAmountMinor, 12900);

  const more = await p.changeSubscription("su_fixture01", { quantity: 3, mode: "now_and_charge" });
  assert.deepEqual(calls[4].body, {
    items: [{ price_id: "price_negocio_usd", quantity: 3 }],
    mode: "now_and_charge",
  });
  assert.equal(more.quantity, 3);

  const scheduled = await p.cancel("su_fixture01", { atPeriodEnd: true, reason: "owner" });
  assert.equal(calls[5].init.method, "PUT");
  assert.deepEqual(calls[5].body, {
    cancel_at_period_end: true,
    cancellation_details: { comment: "owner" },
  });
  assert.equal(scheduled.status, "active");
  assert.equal(scheduled.cancelAt, "2027-01-01T14:03:21.000Z");

  const ended = await p.cancel("su_fixture01", { atPeriodEnd: false });
  assert.equal(calls[6].init.method, "DELETE");
  assert.equal(calls[7].init.method, "GET", "an empty DELETE body is followed by a read");
  assert.equal(ended.status, "canceled");
});

test("createProduct builds the recurring monthly price and testConnection reads the environment", async () => {
  const { provider: p, calls } = provider([
    { status: 201, body: loadFixture("product-create-response.json") },
    { status: 200, body: loadFixture("test-response.json") },
  ]);
  const product = await p.createProduct({
    name: "PuntosFieles Impulsa (GTQ)",
    plan: "NEGOCIO",
    currency: "GTQ",
    unitAmountMinor: 60000,
    billingInfoRequired: true,
  });
  assert.deepEqual(product, { productId: "prod_negocio_usd", priceId: "price_negocio_usd" });
  assert.equal(calls[0].url, `${RECURRENTE_API_BASE}/products`);
  assert.equal(calls[0].body.product.tax_category, "service");
  assert.equal(calls[0].body.product.billing_info_requirement, "optional");
  assert.deepEqual(calls[0].body.product.prices_attributes, [
    {
      amount_in_cents: 60000,
      currency: "GTQ",
      charge_type: "recurring",
      billing_interval: "month",
      billing_interval_count: 1,
    },
  ]);
  assert.deepEqual(await p.testConnection(), {
    environment: "sandbox",
    sandboxId: "sbx_fixture01",
  });
});

test("verifyWebhook and parseEvent on the adapter", async () => {
  const { provider: p } = provider([]);
  const rawBody = JSON.stringify(loadFixture("subscription-cancel.json"));
  const headers = signSvixPayload({ secret, rawBody, id: "msg_9", timestamp: nowSeconds });
  assert.equal(await p.verifyWebhook({ rawBody, headers }), true);
  assert.equal(await p.verifyWebhook({ rawBody: rawBody + " ", headers }), false);
  assert.equal(p.parseEvent(rawBody).type, "subscription_canceled");
  assert.throws(
    () => p.parseEvent("{not json"),
    (error) => err(error).statusCode === 400 && err(error).code === "BAD_JSON",
  );
  const unsigned = createRecurrenteProvider({
    fetch: async () => ({ ok: true, status: 200, text: async () => "{}" }),
    config: { secretKey: "sk_test_abc", webhookSecret: "", getCatalog: async () => catalog },
  });
  assert.equal(
    await unsigned.verifyWebhook({ rawBody, headers }),
    false,
    "no signing secret, nothing verifies",
  );
});
