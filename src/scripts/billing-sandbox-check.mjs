#!/usr/bin/env node
// Owner-run check of the Recurrente integration against a Sandbox (design of record
// docs/product/2026-11-25-self-serve-trial.md, sections 5.2 and 11.1). It exercises the
// same adapter the server uses (src/app/services/billing/recurrente-provider.js) and
// reports PASS / FAIL / SKIP per step. No secret is ever printed.
//
//   RECURRENTE_SECRET_KEY_FILE=/path/to/sandbox_key node src/scripts/billing-sandbox-check.mjs \
//     --currency USD --plan NEGOCIO --quantity 1 --wait-seconds 600
//
// Steps: GET /test (must be a Sandbox unless --allow-live), create the three products of
// the currency (or reuse --price-ids), create a customer, create a checkout twice with the
// same Idempotency-Key (same id expected), print the checkout URL, then, when
// --wait-seconds > 0, poll the checkout until it is paid with the Sandbox card
// 4242 4242 4242 4242, read the subscription and try the plan-change assumption
// (remove old price + add new price in one PUT with mode now_and_charge), a quantity
// change, a cancel at period end and, with --cleanup, the immediate DELETE.
import fs from "node:fs";
import crypto from "node:crypto";
import { createRecurrenteProvider } from "../app/services/billing/recurrente-provider.js";

const args = process.argv.slice(2);
/** @param {string} name @param {string} [fallback] */
const arg = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};
/** @param {string} name */
const flag = (name) => args.includes(name);

/** @param {string} name */
function secretFromEnv(name) {
  const file = process.env[`${name}_FILE`];
  if (file) {
    // The path is the owner's choice at run time.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return fs.readFileSync(file, "utf8").trim();
  }
  return String(process.env[name] || "").trim();
}

const secretKey = secretFromEnv("RECURRENTE_SECRET_KEY");
if (!secretKey) {
  console.error(
    "Set RECURRENTE_SECRET_KEY_FILE (or RECURRENTE_SECRET_KEY) to the Sandbox TEST key.",
  );
  process.exit(2);
}
const currency = /** @type {"GTQ" | "USD"} */ (
  arg("--currency", "USD").toUpperCase() === "GTQ" ? "GTQ" : "USD"
);
const plan = arg("--plan", "NEGOCIO").toUpperCase();
const otherPlan = plan === "EMPRESA" ? "NEGOCIO" : "EMPRESA";
const quantity = Math.min(9, Math.max(1, Number(arg("--quantity", "1")) || 1));
const waitSeconds = Math.max(0, Number(arg("--wait-seconds", "0")) || 0);
const returnOrigin = arg(
  "--return-origin",
  process.env.BILLING_RETURN_ORIGIN || "https://app.puntosfieles.com",
).replace(/\/+$/, "");
const amounts = (() => {
  const custom = arg("--amounts", "");
  const [a, b, c] = custom ? custom.split(",").map((v) => Number(v.trim())) : [39, 79, 129];
  return { EMPRENDEDOR: a, NEGOCIO: b, EMPRESA: c };
})();
/** @type {Record<string, string>} */
const priceIds = Object.fromEntries(
  arg("--price-ids", "")
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => pair.split("=").map((v) => v.trim())),
);

/** @type {Array<{ step: string, result: "PASS" | "FAIL" | "SKIP", detail: string }>} */
const results = [];
/** @param {string} step @param {"PASS" | "FAIL" | "SKIP"} result @param {string} [detail] */
function report(step, result, detail = "") {
  results.push({ step, result, detail });
  console.log(`${result.padEnd(4)} ${step}${detail ? ` -- ${detail}` : ""}`);
}
/** @param {unknown} error */
function describeError(error) {
  if (error && typeof error === "object") {
    const e = /** @type {Record<string, unknown>} */ (error);
    const parts = [String(e.message || "error")];
    if (e.upstreamStatus) parts.push(`upstream ${String(e.upstreamStatus)}`);
    if (e.providerCode) parts.push(`code ${String(e.providerCode)}`);
    return parts.join(", ").replace(secretKey, "[redacted]");
  }
  return String(error);
}
/**
 * @template T
 * @param {string} step
 * @param {() => Promise<T>} fn
 * @returns {Promise<T | null>}
 */
async function attempt(step, fn) {
  try {
    const out = await fn();
    return out;
  } catch (error) {
    report(step, "FAIL", describeError(error));
    return null;
  }
}
const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

const catalog = {
  usd: currency === "USD" ? amounts : { EMPRENDEDOR: 39, NEGOCIO: 79, EMPRESA: 129 },
  gtq: currency === "GTQ" ? amounts : null,
  providers: {
    recurrente: {
      price_ids: {
        GTQ: currency === "GTQ" ? priceIds : {},
        USD: currency === "USD" ? priceIds : {},
      },
    },
  },
};
const provider = createRecurrenteProvider({
  fetch: (url, init) => globalThis.fetch(url, init),
  config: {
    secretKey,
    webhookSecret: "",
    apiBase: process.env.RECURRENTE_API_BASE || undefined,
    getCatalog: async () => catalog,
  },
});

console.log(
  `Recurrente sandbox check (${currency}, plan ${plan}, quantity ${quantity}); key environment: ${provider.liveMode ? "LIVE" : "test"}`,
);

// 1. Environment.
const env = await attempt("GET /test", () => provider.testConnection());
if (env) {
  const sandbox = env.environment === "sandbox";
  report(
    "GET /test",
    sandbox || flag("--allow-live") ? "PASS" : "FAIL",
    `environment=${env.environment}${env.sandboxId ? ` sandbox_id=${env.sandboxId}` : ""}`,
  );
  if (!sandbox && !flag("--allow-live")) {
    console.error("Refusing to continue outside a Sandbox (pass --allow-live to override).");
    process.exit(1);
  }
}

// 2. Catalog products (one price per product, recurring monthly).
for (const key of ["EMPRENDEDOR", "NEGOCIO", "EMPRESA"]) {
  if (priceIds[key]) {
    report(`product ${key} (${currency})`, "SKIP", `reusing ${priceIds[key]}`);
    continue;
  }
  const product = await attempt(`POST /products ${key} (${currency})`, () =>
    provider.createProduct({
      name: `PuntosFieles ${key} (${currency}) sandbox-check`,
      plan: key,
      currency,
      unitAmountMinor: Math.round(Number(amounts[/** @type {keyof typeof amounts} */ (key)]) * 100),
      billingInfoRequired: currency === "GTQ",
    }),
  );
  if (product) {
    priceIds[key] = product.priceId;
    report(
      `POST /products ${key} (${currency})`,
      "PASS",
      `product ${product.productId}, price ${product.priceId}`,
    );
  }
}
if (!priceIds[plan] || !priceIds[otherPlan]) {
  console.error("Catalog incomplete; cannot continue.");
  summarize();
}

// 3. Customer.
const customer = await attempt("POST /customers", () =>
  provider.createCustomer({
    businessId: crypto.randomUUID(),
    email: `sandbox-check-${Date.now()}@example.com`,
    name: "Sandbox Check",
    phone: "+50255550000",
  }),
);
if (customer) report("POST /customers", "PASS", customer.providerCustomerId);
else summarize();

// 4. Checkout with Idempotency-Key, replayed once.
const checkoutId = crypto.randomUUID();
const checkoutInput = {
  customer: /** @type {NonNullable<typeof customer>} */ (customer),
  plan,
  quantity,
  currency,
  successUrl: `${returnOrigin}/negocio/#plan?checkout=${checkoutId}&resultado=exito`,
  cancelUrl: `${returnOrigin}/negocio/#plan?checkout=${checkoutId}&resultado=cancelado`,
  metadata: {
    business_id: "sandbox-check",
    checkout_id: checkoutId,
    plan,
    quantity: String(quantity),
    currency,
  },
  idempotencyKey: checkoutId,
};
const checkout = await attempt("POST /checkouts", () => provider.createCheckout(checkoutInput));
if (!checkout) summarize();
const created = /** @type {NonNullable<typeof checkout>} */ (checkout);
report(
  "POST /checkouts",
  "PASS",
  `${created.providerCheckoutId} unit ${created.unitAmountMinor} ${currency}, expires ${created.expiresAt}`,
);
const replay = await attempt("POST /checkouts (Idempotency-Key replay)", () =>
  provider.createCheckout(checkoutInput),
);
if (replay)
  report(
    "POST /checkouts (Idempotency-Key replay)",
    replay.providerCheckoutId === created.providerCheckoutId ? "PASS" : "FAIL",
    `replay returned ${replay.providerCheckoutId}`,
  );
console.log(`\nCheckout URL (pay with 4242 4242 4242 4242 in the Sandbox):\n  ${created.url}\n`);

// 5. Wait for the payment, then exercise the subscription.
if (waitSeconds <= 0) {
  report("subscription checks", "SKIP", "pass --wait-seconds N and pay the checkout to run them");
  summarize();
}
let subscriptionId = /** @type {string | null} */ (null);
const deadline = Date.now() + waitSeconds * 1000;
while (Date.now() < deadline && !subscriptionId) {
  const state = await attempt("GET /checkouts/{id}", () =>
    provider.fetchCheckout(created.providerCheckoutId),
  );
  if (!state) break;
  if (state.status === "paid") {
    subscriptionId = state.subscriptionId;
    if (!subscriptionId) {
      report(
        "GET /checkouts/{id}",
        "FAIL",
        "paid but payment.paymentable did not name a Subscription; pass --subscription-id",
      );
      subscriptionId = arg("--subscription-id", "") || null;
    } else report("GET /checkouts/{id}", "PASS", `paid, subscription ${subscriptionId}`);
    break;
  }
  await sleep(5000);
}
if (!subscriptionId) {
  report("subscription checks", "SKIP", "checkout not paid before the deadline");
  summarize();
}
const sid = /** @type {string} */ (subscriptionId);
const snapshot = await attempt("GET /subscriptions/{id}", () => provider.fetchSubscription(sid));
if (snapshot)
  report(
    "GET /subscriptions/{id}",
    "PASS",
    `status ${snapshot.status}, plan ${snapshot.plan}, quantity ${snapshot.quantity}, period end ${snapshot.currentPeriodEnd}`,
  );

// The design's riskiest assumption (section 11.1): a plan swap as item remove + add.
const swapped = await attempt(
  `PUT /subscriptions/{id} plan ${plan} -> ${otherPlan} now_and_charge`,
  () => provider.changeSubscription(sid, { plan: otherPlan, quantity, mode: "now_and_charge" }),
);
if (swapped)
  report(
    `PUT /subscriptions/{id} plan ${plan} -> ${otherPlan} now_and_charge`,
    swapped.plan === otherPlan ? "PASS" : "FAIL",
    `provider now reports plan ${swapped.plan} (price ${swapped.metadata.provider_price_id})`,
  );
const reverted = await attempt(
  `PUT /subscriptions/{id} plan ${otherPlan} -> ${plan} next_cycle`,
  () => provider.changeSubscription(sid, { plan, quantity, mode: "next_cycle" }),
);
if (reverted)
  report(
    `PUT /subscriptions/{id} plan ${otherPlan} -> ${plan} next_cycle`,
    "PASS",
    `current plan ${reverted.plan} (change applies at the next cycle)`,
  );
const more = await attempt("PUT /subscriptions/{id} quantity +1 now_and_charge", () =>
  provider.changeSubscription(sid, { quantity: Math.min(9, quantity + 1), mode: "now_and_charge" }),
);
if (more)
  report(
    "PUT /subscriptions/{id} quantity +1 now_and_charge",
    more.quantity === Math.min(9, quantity + 1) ? "PASS" : "FAIL",
    `quantity now ${more.quantity}`,
  );
const scheduled = await attempt("PUT /subscriptions/{id} cancel_at_period_end", () =>
  provider.cancel(sid, { atPeriodEnd: true, reason: "sandbox-check" }),
);
if (scheduled)
  report(
    "PUT /subscriptions/{id} cancel_at_period_end",
    scheduled.cancelAt ? "PASS" : "FAIL",
    `cancel_at ${scheduled.cancelAt}`,
  );
if (flag("--cleanup")) {
  const ended = await attempt("DELETE /subscriptions/{id}", () =>
    provider.cancel(sid, { atPeriodEnd: false }),
  );
  if (ended)
    report(
      "DELETE /subscriptions/{id}",
      ended.status === "canceled" ? "PASS" : "FAIL",
      `status ${ended.status}`,
    );
} else
  report(
    "DELETE /subscriptions/{id}",
    "SKIP",
    "pass --cleanup to cancel the test subscription now",
  );
summarize();

function summarize() {
  const failed = results.filter((r) => r.result === "FAIL").length;
  const passed = results.filter((r) => r.result === "PASS").length;
  const skipped = results.filter((r) => r.result === "SKIP").length;
  console.log(`\n${passed} PASS, ${failed} FAIL, ${skipped} SKIP`);
  if (Object.keys(priceIds).length)
    console.log(
      `price ids for billing_catalog.providers.recurrente.price_ids.${currency}: ${JSON.stringify(priceIds)}`,
    );
  process.exit(failed ? 1 : 0);
}
