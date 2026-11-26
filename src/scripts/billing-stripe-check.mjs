import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { PLAN_PRICING_USD } from "../utils/plan.js";
import {
  createStripeProvider,
  STRIPE_API_VERSION,
} from "../app/services/billing/stripe-provider.js";

async function check() {
  const { values } = parseArgs({
    options: {
      "wait-seconds": { type: "string", default: "0" },
      cancel: { type: "boolean", default: false },
    },
  });
  const wait = Number(values["wait-seconds"]);
  if (!Number.isInteger(wait) || wait < 0 || wait > 3600 || (values.cancel && !wait))
    throw new Error(
      "Use --wait-seconds 1..3600 to verify a completed test payment and optionally --cancel.",
    );

  const keyFile = process.env.STRIPE_SECRET_KEY_FILE;
  const key = (
    keyFile
      ? // eslint-disable-next-line security/detect-non-literal-fs-filename -- Operator-specified secret file.
        await readFile(keyFile, "utf8")
      : process.env.STRIPE_SECRET_KEY || ""
  ).trim();
  if (!/^(?:sk|rk)_test_/.test(key))
    throw new Error("A Stripe test key is required. Set STRIPE_SECRET_KEY_FILE.");
  const account = await fetch("https://api.stripe.com/v1/account", {
    headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_API_VERSION },
    signal: AbortSignal.timeout(15000),
  });
  if (!account.ok) throw new Error(`Account read failed (HTTP ${account.status}).`);
  console.log("PASS test account access");
  /** @type {Record<string, string>} */
  const ids = {};
  const provider = createStripeProvider({
    fetch,
    config: {
      secretKey: key,
      webhookSecret: "",
      getCatalog: async () => ({
        usd: PLAN_PRICING_USD,
        providers: { stripe: { price_ids: { USD: ids } } },
      }),
    },
  });
  for (const [plan, monthly] of Object.entries(PLAN_PRICING_USD)) {
    const price = await provider.createProduct({
      plan,
      name: `PuntosFieles ${plan}`,
      currency: "USD",
      unitAmountMinor: monthly * 100,
    });
    ids[plan] = price.priceId;
  }
  console.log("PASS three monthly USD prices");
  const businessId = randomUUID();
  const checkoutId = randomUUID();
  const customer = await provider.createCustomer({
    businessId,
    name: "PF sandbox",
    email: "pf-test@example.com",
  });
  console.log("PASS test customer");
  const plan = "NEGOCIO";
  const returnUrl = `https://example.com/#plan?checkout=${checkoutId}`;
  const session = await provider.createCheckout({
    customer,
    plan,
    quantity: 1,
    currency: "USD",
    successUrl: `${returnUrl}&resultado=exito`,
    cancelUrl: `${returnUrl}&resultado=cancelado`,
    metadata: {
      business_id: businessId,
      checkout_id: checkoutId,
      plan,
      quantity: "1",
      currency: "USD",
    },
    idempotencyKey: checkoutId,
  });
  console.log("PASS test Checkout Session. Open this sandbox URL to pay:", session.url);
  if (!wait) return;
  const deadline = Date.now() + wait * 1000;
  do {
    const observed = await provider.fetchCheckout(session.providerCheckoutId);
    if (
      observed.status === "complete" &&
      observed.paymentStatus === "paid" &&
      observed.subscriptionId
    ) {
      const sub = await provider.fetchSubscription(observed.subscriptionId);
      if (sub.status !== "active" || sub.currency !== "USD" || sub.plan !== plan)
        throw new Error("Paid test subscription differed from the checkout.");
      console.log("PASS paid USD subscription");
      if (values.cancel) {
        const canceled = await provider.cancel(observed.subscriptionId, { atPeriodEnd: false });
        if (canceled.status !== "canceled") throw new Error("Test subscription did not cancel.");
        console.log("PASS test subscription canceled");
      }
      return;
    }
    if (observed.status === "expired") throw new Error("Test checkout expired.");
    await delay(Math.min(3000, Math.max(0, deadline - Date.now())));
  } while (Date.now() < deadline);
  throw new Error("Test checkout did not complete within the wait period.");
}

check().catch((error) => {
  // Provider error bodies can contain customer or billing data. Only the upstream status
  // and stable error code are relevant to this check.
  console.error(
    "FAIL",
    error?.name === "BillingProviderError"
      ? `Stripe HTTP ${error.upstreamStatus} (${error.providerCode || "request_failed"})`
      : error.message,
  );
  process.exitCode = 1;
});
