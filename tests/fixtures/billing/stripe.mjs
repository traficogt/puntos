// Synthetic Stripe snapshot payloads and an in-process HTTP transport. No account data.
import crypto from "node:crypto";
import { createStripeProvider } from "../../../src/app/services/billing/stripe-provider.js";
import { gtqFixtureCatalog } from "./memory-billing-repo.mjs";

export function stripeCatalog() {
  const catalog = gtqFixtureCatalog();
  for (const plan of Object.keys(catalog.usd))
    catalog.providers.stripe.price_ids.USD[plan] = "price_stripe_" + plan;
  return catalog;
}

export function stripeFixture({ now = () => new Date(), catalog = stripeCatalog() } = {}) {
  const secret = "whsec_fixture";
  const calls = [];
  let failRead = false;
  const metadata = {
    business_id: "",
    checkout_id: "",
    plan: "NEGOCIO",
    quantity: "1",
    currency: "USD",
    pf_price_id: "price_stripe_NEGOCIO",
  };
  const customer = "cus_stripe";
  const subscription = "sub_stripe";
  const seconds = () => Math.floor(now().getTime() / 1000);
  const invoice = {
    id: "in_fixture",
    object: "invoice",
    status: "paid",
    amount_paid: 7900,
    amount_due: 7900,
    currency: "usd",
    customer,
    hosted_invoice_url: "https://invoice.stripe.com/i/example",
    parent: { type: "subscription_details", subscription_details: { subscription, metadata } },
  };
  const session = {
    id: "cs_fixture",
    object: "checkout.session",
    mode: "subscription",
    url: "https://checkout.stripe.com/c/pay/fixture",
    customer,
    metadata,
    currency: "usd",
    status: "complete",
    payment_status: "paid",
    subscription,
    expires_at: seconds() + 3600,
  };
  const item = {
    id: "si_example",
    quantity: 1,
    price: {
      id: "price_stripe_NEGOCIO",
      currency: "usd",
      unit_amount: 7900,
      recurring: { interval: "month", interval_count: 1 },
    },
    current_period_start: seconds(),
    current_period_end: seconds() + 30 * 86400,
  };
  const sub = {
    id: subscription,
    object: "subscription",
    status: "active",
    currency: "usd",
    customer,
    metadata,
    items: { data: [item], has_more: false },
    latest_invoice: invoice,
    cancel_at_period_end: false,
  };
  const transport = async (url, init) => {
    const path = new URL(url).pathname;
    const form = new URLSearchParams(init.body);
    calls.push({ path, form, ...init });
    let data;
    if (path === "/v1/customers") data = { id: customer };
    else if (path === "/v1/charges/ch_fixture") data = { id: "ch_fixture", customer };
    else if (path.startsWith("/v1/prices/price_stripe_")) {
      const plan = path.slice("/v1/prices/price_stripe_".length);
      data = {
        id: "price_stripe_" + plan,
        active: true,
        currency: "usd",
        tax_behavior: "inclusive",
        unit_amount: catalog.usd[plan] * 100,
        recurring: { interval: "month", interval_count: 1 },
      };
    } else if (path === "/v1/checkout/sessions") {
      for (const key of Object.keys(metadata))
        metadata[key] = form.get("subscription_data[metadata][" + key + "]") || "";
      item.quantity = Number(form.get("line_items[0][quantity]"));
      invoice.amount_paid = invoice.amount_due = item.price.unit_amount * item.quantity;
      data = session;
    } else if (path === "/v1/checkout/sessions/" + session.id) data = session;
    else if (path === "/v1/subscriptions/" + subscription) {
      if (failRead) {
        failRead = false;
        throw new Error("fixture timeout");
      }
      if (init.method === "POST") {
        if (form.has("cancel_at_period_end")) sub.cancel_at_period_end = true;
        else {
          for (const [field, value] of form) {
            const match = /^metadata\[(\w+)\]$/.exec(field);
            if (match) metadata[match[1]] = value;
          }
          item.price.id = form.get("items[0][price]");
          item.price.unit_amount = catalog.usd[metadata.plan] * 100;
          item.quantity = Number(form.get("items[0][quantity]"));
        }
      } else if (init.method === "DELETE") sub.status = "canceled";
      data = sub;
    } else if (path === "/v1/prices")
      data =
        init.method === "GET"
          ? { data: [] }
          : {
              id: "price_synced_" + form.get("metadata[plan]"),
              product: "prod_" + form.get("metadata[plan]"),
            };
    else throw new Error("Unexpected Stripe fixture request " + path);
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };
  const provider = createStripeProvider({
    fetch: transport,
    config: {
      secretKey: "sk_test_fixture",
      webhookSecret: secret,
      getCatalog: async () => catalog,
      now,
    },
  });
  const event = (type, object, id = "evt_" + crypto.randomUUID()) => ({
    id,
    type,
    livemode: false,
    created: seconds(),
    data: { object },
  });
  const signed = (body, timestamp = seconds()) => {
    const rawBody = JSON.stringify(body, null, 2);
    const hash = crypto
      .createHmac("sha256", secret)
      .update(timestamp + "." + rawBody)
      .digest("hex");
    return {
      provider: "stripe",
      rawBody,
      headers: { "stripe-signature": "t=" + timestamp + ",v1=" + hash },
    };
  };
  return {
    provider,
    calls,
    item,
    invoice,
    sub,
    session,
    event,
    signed,
    metadata,
    failNextRead: () => {
      failRead = true;
    },
  };
}
