// Stripe USD monthly subscriptions. REST reads are version-pinned independently
// of webhook delivery. See the billing design §5.3 for supported snapshot shapes.
import crypto from "node:crypto";
import { HttpError } from "../../../utils/http-error.js";
import { isPlanName, normalizePlan } from "../../../utils/plan.js";
import { BillingProviderError, metadataStrings } from "./provider.js";
import { headerValue } from "./recurrente-provider.js";

/** @typedef {import("./provider.js").BillingProvider} BillingProvider */
/** @typedef {import("./provider.js").BillingEvent} BillingEvent */
/** @typedef {import("./provider.js").SubscriptionSnapshot} SubscriptionSnapshot */
/** @typedef {import("../../../utils/plan.js").PlanName} PlanName */
/**
 * The slice of the resolved billing catalog this adapter reads.
 * @typedef {{
 *   usd: Record<string, number>,
 *   providers: { stripe: { price_ids: { USD: Record<string, string> } } }
 * }} StripeCatalogLike
 */
/**
 * @typedef {{
 *   secretKey: string,
 *   webhookSecret: string,
 *   apiBase?: string,
 *   apiVersion?: string,
 *   getCatalog: () => Promise<StripeCatalogLike>,
 *   now?: () => Date,
 *   timeoutMs?: number,
 *   checkoutTtlMs?: number,
 *   toleranceSeconds?: number
 * }} StripeConfig
 */
/** @typedef {(url: string, init: { method: string, headers: Record<string, string>, body?: string, signal?: AbortSignal }) => Promise<{ ok: boolean, status: number, text(): Promise<string> }>} FetchLike */
/**
 * @typedef {BillingProvider & {
 *   liveMode: boolean,
 *   chargeCustomer: (chargeId: string) => Promise<string|null>,
 *   testConnection: () => Promise<{ livemode: boolean, country: string | null, defaultCurrency: string | null, chargesEnabled: boolean, payoutsEnabled: boolean }>,
 *   createProduct: (input: { name: string, description?: string, plan: string, currency: "GTQ"|"USD", unitAmountMinor: number, billingInfoRequired?: boolean }, options?: { reuse?: boolean, previousPriceId?: string|null }) => Promise<{ productId: string, priceId: string, reused: boolean }>,
 *   fetchCheckout: (providerCheckoutId: string) => Promise<{ id: string, status: string, paymentStatus: string | null, subscriptionId: string | null, raw: unknown }>
 * }} StripeProvider
 */

export const STRIPE_API_BASE = "https://api.stripe.com";
/** Pinned API version (https://docs.stripe.com/api/versioning, read 2026-11-26). */
export const STRIPE_API_VERSION = "2026-11-18.endive";
export const WEBHOOK_TOLERANCE_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 15_000;
// Checkout Sessions may live at most 24 hours; a minute of margin keeps the request valid.
const DEFAULT_CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000 - 60_000;
/** Reserved subscription metadata keys of the deferred-downgrade bookkeeping. */
const PENDING_KEYS = Object.freeze([
  "pf_pending_from",
  "pf_pending_plan",
  "pf_pending_quantity",
  "pf_previous_plan",
  "pf_previous_amount",
  "pf_previous_quantity",
]);

/** Stripe event types and their normalized counterparts (design section 5.3). */
export const STRIPE_EVENT_MAP = Object.freeze({
  "checkout.session.completed": "checkout_completed",
  "checkout.session.expired": "checkout_expired",
  "invoice.paid": "payment_succeeded",
  "invoice.payment_failed": "payment_failed",
  "customer.subscription.created": "subscription_created",
  "customer.subscription.updated": "subscription_updated",
  "customer.subscription.deleted": "subscription_canceled",
  "charge.refunded": "refund_created",
  "charge.dispute.created": "dispute_opened",
});

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** @param {unknown} value @returns {Record<string, unknown>} */
const asRecord = (value) => (isRecord(value) ? value : {});
/** @param {unknown} value */
const str = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
/** @param {unknown} value */
const int = (value) =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
/** Expandable fields arrive as an id or as the object itself. @param {unknown} value */
const idOf = (value) => str(value) ?? str(asRecord(value).id);
/** @param {unknown} value @returns {"GTQ" | "USD" | null} */
const currencyOf = (value) => {
  const upper = typeof value === "string" ? value.toUpperCase() : "";
  return upper === "GTQ" || upper === "USD" ? upper : null;
};
/** Unix seconds (Stripe timestamps) to ISO. @param {unknown} value */
const isoFromSeconds = (value) => {
  const seconds = int(value);
  return seconds === null || seconds <= 0 ? null : new Date(seconds * 1000).toISOString();
};
/** @param {unknown} value */
const isoOrNull = (value) => {
  const date = typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/**
 * Form encoding with bracket paths, the way Stripe reads nested parameters
 * (`line_items[0][price]`, `metadata[business_id]`, `lookup_keys[0]`).
 * @param {Record<string, unknown>} params
 */
export function encodeForm(params) {
  const search = new URLSearchParams();
  /** @param {string} key @param {unknown} value */
  const add = (key, value) => {
    if (value === undefined) return;
    if (value === null) {
      search.append(key, "");
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => add(`${key}[${index}]`, entry));
      return;
    }
    if (typeof value === "object") {
      for (const [sub, entry] of Object.entries(value)) add(`${key}[${sub}]`, entry);
      return;
    }
    search.append(key, String(value));
  };
  for (const [key, value] of Object.entries(params)) add(key, value);
  return search.toString();
}

/**
 * Splits a `Stripe-Signature` header into its timestamp and `v1` signatures; every other
 * entry (`v0`, `secret`, `destination`, `payload`) is debug metadata and is ignored.
 * @param {string | null} header
 */
export function parseStripeSignature(header) {
  /** @type {{ timestamp: string | null, signatures: string[] }} */
  const out = { timestamp: null, signatures: [] };
  for (const entry of String(header || "").split(",")) {
    const index = entry.indexOf("=");
    if (index <= 0) continue;
    const key = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) out.timestamp = value;
    else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) out.signatures.push(value);
  }
  return out;
}

/**
 * Stripe webhook signature check as https://docs.stripe.com/webhooks ("verify manually")
 * describes it: HMAC-SHA256 over `${t}.${rawBody}` keyed with the endpoint secret, hex
 * digest, constant-time compare against any `v1` entry, timestamp within `toleranceSeconds`.
 * @param {{
 *   secret: string,
 *   rawBody: string,
 *   headers: Record<string, string | string[] | undefined>,
 *   now?: Date,
 *   toleranceSeconds?: number
 * }} input
 */
export function verifyStripeSignature({
  secret,
  rawBody,
  headers,
  now = new Date(),
  toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
}) {
  const key = String(secret || "").trim();
  if (!key || typeof rawBody !== "string") return false;
  const { timestamp, signatures } = parseStripeSignature(headerValue(headers, "stripe-signature"));
  if (!timestamp || signatures.length === 0) return false;
  const skew = Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp));
  if (skew > toleranceSeconds) return false;
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest();
  let matched = false;
  for (const signature of signatures) {
    const candidate = Buffer.from(signature, "hex");
    if (candidate.length !== expected.length) continue;
    if (crypto.timingSafeEqual(candidate, expected)) matched = true;
  }
  return matched;
}

/**
 * Builds the `Stripe-Signature` header for a payload: tests and the owner check sign fixtures
 * with it so the verifier is exercised against real signatures.
 * @param {{ secret: string, rawBody: string, timestamp?: number, extraSignatures?: string[] }} input
 */
export function signStripePayload({ secret, rawBody, timestamp, extraSignatures = [] }) {
  const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac("sha256", String(secret || "").trim())
    .update(`${ts}.${rawBody}`, "utf8")
    .digest("hex");
  const parts = [`t=${ts}`, ...extraSignatures.map((s) => `v1=${s}`), `v1=${signature}`];
  return { "stripe-signature": parts.join(",") };
}

/** @param {unknown} status */
export function mapStripeStatus(status) {
  switch (status) {
    case "active":
      return "active";
    case "past_due":
    // `incomplete` is the first payment awaiting completion (23 h window); it is treated as
    // a pending charge, and `incomplete_expired` below ends it.
    case "incomplete":
      return "past_due";
    case "trialing":
    case "paused":
      return "paused";
    default:
      // canceled, unpaid, incomplete_expired and anything unknown
      return "canceled";
  }
}

/**
 * Reverse lookup of a Stripe price id in the catalog (USD only).
 * @param {StripeCatalogLike} catalog
 * @param {string | null} priceId
 * @returns {PlanName | null}
 */
export function planForStripePriceId(catalog, priceId) {
  if (!priceId) return null;
  const map = catalog.providers?.stripe?.price_ids?.USD ?? {};
  for (const [plan, id] of Object.entries(map)) {
    if (id === priceId && isPlanName(plan)) return plan;
  }
  return null;
}

/**
 * Catalog USD amount for a plan, in cents.
 * @param {StripeCatalogLike} catalog
 * @param {string} plan
 */
export function stripeUnitAmountMinor(catalog, plan) {
  const key = normalizePlan(plan);
  const amount = isPlanName(key) ? Number(catalog.usd?.[key]) : NaN;
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
}

/** @param {Record<string, unknown>} price @param {number} cents */
function matchesMonthlyPrice(price, cents) {
  const recurring = asRecord(price.recurring);
  return (
    price.active === true &&
    price.currency === "usd" &&
    price.unit_amount === cents &&
    price.tax_behavior === "inclusive" &&
    recurring.interval === "month" &&
    recurring.interval_count === 1 &&
    recurring.usage_type !== "metered" &&
    !price.transform_quantity
  );
}

/**
 * Lookup key of the recurring monthly USD price of a plan (`pf_negocio_usd_month`).
 * @param {string} plan
 */
export function stripeLookupKey(plan) {
  return `pf_${normalizePlan(plan).toLowerCase()}_usd_month`;
}

/**
 * The checkout/subscription metadata a payload carries, with the deferred-downgrade keys
 * removed so only the contract keys (business_id, checkout_id, plan, quantity, currency)
 * reach the service.
 * @param {unknown} raw
 */
function contractMetadata(raw) {
  const out = metadataStrings(raw);
  for (const key of PENDING_KEYS) delete out[key];
  return out;
}

/**
 * The subscription metadata an invoice carries: `parent.subscription_details.metadata`
 * since API 2025-03-31.basil, `subscription_details.metadata` before it.
 * @param {Record<string, unknown>} invoice
 */
function invoiceSubscriptionDetails(invoice) {
  const parent = asRecord(invoice.parent);
  const details = isRecord(parent.subscription_details)
    ? parent.subscription_details
    : asRecord(invoice.subscription_details);
  return {
    subscriptionId: idOf(details.subscription) ?? idOf(invoice.subscription),
    metadata: isRecord(details.metadata) ? details.metadata : invoice.metadata,
  };
}

/**
 * Maps a Stripe event envelope to the normalized BillingEvent (design section 5.3). Unknown
 * event types become `ignored` so the webhook never answers 5xx for them.
 * @param {unknown} payload parsed JSON body (`{ id, type, created, livemode, data: { object } }`)
 * @param {{ defaultLiveMode?: boolean, now?: Date }} [options]
 * @returns {BillingEvent}
 */
export function parseStripeEvent(payload, { defaultLiveMode = true, now = new Date() } = {}) {
  const body = asRecord(payload);
  const eventType = str(body.type) ?? "";
  const type = /** @type {BillingEvent["type"]} */ (
    Object.prototype.hasOwnProperty.call(STRIPE_EVENT_MAP, eventType)
      ? STRIPE_EVENT_MAP[/** @type {keyof typeof STRIPE_EVENT_MAP} */ (eventType)]
      : "ignored"
  );
  const object = asRecord(asRecord(body.data).object);
  const objectKind = str(object.object) ?? "";
  /** @type {BillingEvent} */
  const event = {
    id: str(body.id) ?? "",
    liveMode: typeof body.livemode === "boolean" ? body.livemode : defaultLiveMode,
    occurredAt: isoFromSeconds(body.created) ?? now.toISOString(),
    metadata: {},
    raw: payload,
    type,
  };
  if (!event.id || !eventType || typeof body.livemode !== "boolean")
    throw new HttpError(400, "Evento Stripe inválido", "BAD_JSON");
  const customerId = idOf(object.customer);
  if (customerId) event.providerCustomerId = customerId;
  const currency = currencyOf(object.currency);
  if (currency) event.currency = currency;

  if (objectKind === "checkout.session") {
    event.metadata = contractMetadata(object.metadata);
    const reference = str(object.client_reference_id);
    if (reference && !event.metadata.business_id) event.metadata.business_id = reference;
    const checkoutId = str(object.id);
    if (checkoutId) event.providerCheckoutId = checkoutId;
    const subscriptionId = idOf(object.subscription);
    if (subscriptionId) event.providerSubscriptionId = subscriptionId;
    const amount = int(object.amount_total);
    if (amount !== null) event.amountMinor = amount;
  } else if (objectKind === "invoice") {
    const details = invoiceSubscriptionDetails(object);
    event.metadata = contractMetadata(details.metadata);
    if (details.subscriptionId) event.providerSubscriptionId = details.subscriptionId;
    const amount = int(type === "payment_failed" ? object.amount_due : object.amount_paid);
    if (amount !== null) event.amountMinor = amount;
    event.invoiceId = str(object.id) ?? undefined;
    if (type === "payment_succeeded" && (object.status !== "paid" || !(Number(amount) > 0)))
      event.type = "ignored";
    // The hosted invoice page is the receipt link ("Ver comprobante"), never a fiscal document.
    event.taxInvoiceUrl = str(object.hosted_invoice_url);
  } else if (objectKind === "subscription") {
    event.metadata = contractMetadata(object.metadata);
    const subscriptionId = str(object.id);
    if (subscriptionId) event.providerSubscriptionId = subscriptionId;
  } else if (objectKind === "charge") {
    event.metadata = contractMetadata(object.metadata);
    const previous = asRecord(asRecord(body.data).previous_attributes);
    const amount =
      type === "refund_created"
        ? Number(object.amount_refunded) - Number(previous.amount_refunded ?? 0)
        : int(object.amount);
    if (amount !== null && Number.isSafeInteger(amount)) event.amountMinor = amount;
    const subscriptionId = idOf(object.subscription);
    if (subscriptionId) event.providerSubscriptionId = subscriptionId;
  } else if (objectKind === "dispute") {
    event.metadata = contractMetadata(object.metadata);
    const amount = int(object.amount);
    if (amount !== null) event.amountMinor = amount;
    // A dispute names its charge, not the customer; the charge may arrive expanded.
    const charge = asRecord(object.charge);
    event.providerChargeId = idOf(object.charge) ?? undefined;
    const chargeCustomer = idOf(charge.customer);
    if (chargeCustomer) event.providerCustomerId = chargeCustomer;
  } else {
    event.metadata = contractMetadata(object.metadata);
  }
  if (type === "payment_succeeded" && objectKind !== "invoice") event.type = "ignored";
  return event;
}

/**
 * The deferred downgrade recorded in the subscription metadata, when still pending.
 * @param {Record<string, string>} metadata
 * @param {Date} now
 */
function pendingChange(metadata, now) {
  const from = isoOrNull(metadata.pf_pending_from);
  if (!from || new Date(from) <= now) return null;
  const previousPlan = normalizePlan(metadata.pf_previous_plan ?? "");
  const previousQuantity = Number(metadata.pf_previous_quantity);
  if (
    !isPlanName(previousPlan) ||
    !Number.isInteger(previousQuantity) ||
    previousQuantity < 1 ||
    previousQuantity > 9
  )
    return null;
  return {
    from,
    previousPlan,
    previousQuantity,
  };
}

/**
 * Maps a Stripe subscription object (GET/POST/DELETE /v1/subscriptions/{id} and the
 * customer.subscription.* payloads share it) to the SubscriptionSnapshot contract.
 * @param {unknown} body
 * @param {{ catalog: StripeCatalogLike, now?: Date }} options
 * @returns {SubscriptionSnapshot}
 */
export function subscriptionSnapshot(body, { catalog, now = new Date() }) {
  const sub = asRecord(body);
  const items = asRecord(sub.items);
  const list = Array.isArray(items.data) ? items.data.filter(isRecord) : [];
  const item = list[0] ?? null;
  const price = asRecord(item?.price);
  const priceId = idOf(item?.price);
  const metadata = metadataStrings(sub.metadata);
  const itemPlan =
    planForStripePriceId(catalog, priceId) ??
    (priceId && priceId === metadata.pf_price_id ? normalizePlan(metadata.plan) : "");
  const itemQuantity = int(item?.quantity) ?? 0;
  const currency = currencyOf(sub.currency) ?? currencyOf(price.currency) ?? "USD";
  const periodStart =
    isoFromSeconds(item?.current_period_start) ?? isoFromSeconds(sub.current_period_start);
  const periodEnd =
    isoFromSeconds(item?.current_period_end) ?? isoFromSeconds(sub.current_period_end);
  const pending = pendingChange(metadata, now);
  const plan = pending?.previousPlan ?? itemPlan;
  const quantity = pending?.previousQuantity ?? itemQuantity;
  const unitAmountMinor = pending
    ? Number(metadata.pf_previous_amount) || 0
    : (int(price.unit_amount) ?? 0);
  const invoice = asRecord(sub.latest_invoice);
  const cancellation = asRecord(sub.cancellation_details);
  const cancelAt =
    isoFromSeconds(sub.cancel_at) ?? (sub.cancel_at_period_end === true ? periodEnd : null);
  const extras = {
    provider_price_id: priceId ?? "",
    provider_item_id: str(item?.id) ?? "",
    provider_customer_id: idOf(sub.customer) ?? "",
    provider_status: str(sub.status) ?? "",
    provider_cancel_at_period_end: sub.cancel_at_period_end === true ? "true" : "false",
    provider_canceled_at: isoFromSeconds(sub.canceled_at) ?? "",
    provider_ended_at:
      isoFromSeconds(sub.ended_at) ??
      (["unpaid", "incomplete_expired"].includes(String(sub.status)) ? now.toISOString() : ""),
    provider_cancellation_reason: str(cancellation.reason) ?? str(cancellation.comment) ?? "",
    provider_usd_monthly: String(
      list.length === 1 &&
        items.has_more !== true &&
        sub.currency === "usd" &&
        price.currency === "usd" &&
        asRecord(price.recurring).interval === "month" &&
        asRecord(price.recurring).interval_count === 1 &&
        isPlanName(itemPlan) &&
        itemQuantity >= 1 &&
        itemQuantity <= 9,
    ),
    provider_invoice_amount_paid: String(invoice.amount_paid ?? ""),
    provider_invoice_paid: String(
      invoiceSubscriptionDetails(invoice).subscriptionId === sub.id &&
        invoice.paid_out_of_band !== true &&
        invoice.status === "paid" &&
        Number(invoice.amount_paid) > 0 &&
        invoice.currency === "usd" &&
        idOf(invoice.customer) === idOf(sub.customer),
    ),
    provider_latest_invoice: idOf(sub.latest_invoice) ?? "",
    provider_pending_plan: pending ? itemPlan : "",
    provider_pending_quantity: pending ? String(itemQuantity) : "",
    provider_pending_from: pending?.from ?? "",
  };
  /** @type {Record<string, string>} */
  const publicMetadata = {};
  for (const [key, value] of Object.entries(metadata))
    if (!PENDING_KEYS.includes(key)) publicMetadata[key] = value;
  return {
    providerSubscriptionId: str(sub.id) ?? "",
    status: mapStripeStatus(sub.status),
    plan,
    quantity,
    currency,
    unitAmountMinor,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAt,
    metadata: { ...publicMetadata, ...extras },
  };
}

/** @param {unknown} body */
function errorDetails(body) {
  const error = asRecord(asRecord(body).error);
  return {
    message: (str(error.message) ?? "").slice(0, 300),
    code: str(error.code) ?? str(error.type),
  };
}

/**
 * @param {{ fetch: FetchLike, config: StripeConfig }} input
 * @returns {StripeProvider}
 */
export function createStripeProvider({ fetch, config }) {
  const secretKey = String(config.secretKey || "").trim();
  if (!secretKey) throw new Error("Stripe provider requires a secret key");
  const webhookSecret = String(config.webhookSecret || "").trim();
  const apiBase = String(config.apiBase || STRIPE_API_BASE).replace(/\/+$/, "");
  const apiVersion = String(config.apiVersion || STRIPE_API_VERSION);
  const now = config.now ?? (() => new Date());
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const checkoutTtlMs = Math.min(
    config.checkoutTtlMs ?? DEFAULT_CHECKOUT_TTL_MS,
    DEFAULT_CHECKOUT_TTL_MS,
  );
  const liveMode = /^(sk|rk)_live_/.test(secretKey);

  /**
   * @param {string} method
   * @param {string} path
   * @param {{ form?: Record<string, unknown>, query?: Record<string, unknown>, idempotencyKey?: string | null }} [options]
   * @returns {Promise<unknown>}
   */
  async function request(method, path, { form, query, idempotencyKey = null } = {}) {
    /** @type {Record<string, string>} */
    const headers = {
      Authorization: `Bearer ${secretKey}`,
      "Stripe-Version": apiVersion,
      Accept: "application/json",
    };
    const body = form === undefined ? undefined : encodeForm(form);
    if (body !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const search = query ? `?${encodeForm(query)}` : "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    /** @type {{ ok: boolean, status: number, text(): Promise<string> }} */
    let response;
    let text;
    try {
      response = await fetch(`${apiBase}${path}${search}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      throw new BillingProviderError(
        `Stripe request failed: ${error instanceof Error ? error.message : "network error"}`,
        { status: 0 },
      );
    } finally {
      clearTimeout(timer);
    }
    /** @type {unknown} */
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) {
      const { message, code } = errorDetails(parsed);
      throw new BillingProviderError(
        `Stripe ${method} ${path} answered ${response.status}${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}`,
        { status: response.status, providerCode: code, body: parsed },
      );
    }
    return parsed;
  }

  /** @param {"GTQ" | "USD"} currency */
  function requireUsd(currency) {
    if (currency !== "USD")
      throw new HttpError(
        400,
        "Stripe cobra en dólares; el cobro en quetzales se realiza con Recurrente.",
        "BILLING_CURRENCY_UNAVAILABLE",
      );
  }

  /** @param {string} plan */
  async function resolvePrice(plan) {
    const catalog = await config.getCatalog();
    const key = normalizePlan(plan);
    const priceId = str(catalog.providers?.stripe?.price_ids?.USD?.[key]);
    const unitAmountMinor = stripeUnitAmountMinor(catalog, key);
    if (!priceId || !unitAmountMinor)
      throw new HttpError(
        503,
        "El catálogo de precios en línea no está completo todavía. Escríbenos y activamos tu plan.",
        "BILLING_UNAVAILABLE",
      );
    const price = asRecord(await request("GET", `/v1/prices/${encodeURIComponent(priceId)}`));
    if (price.id !== priceId || !matchesMonthlyPrice(price, unitAmountMinor))
      throw new HttpError(
        503,
        "El precio en Stripe necesita sincronización.",
        "BILLING_UNAVAILABLE",
      );
    return { priceId, unitAmountMinor };
  }

  /** @param {unknown} body */
  async function snapshotOf(body) {
    if (!str(asRecord(body).id) || !str(asRecord(body).status))
      throw new BillingProviderError("Stripe subscription response lacks id or status");
    return subscriptionSnapshot(body, { catalog: await config.getCatalog(), now: now() });
  }

  return {
    name: "stripe",
    webhookConfigured: Boolean(webhookSecret),
    liveMode,

    async chargeCustomer(chargeId) {
      const charge = asRecord(await request("GET", `/v1/charges/${encodeURIComponent(chargeId)}`));
      return idOf(charge.customer);
    },

    async testConnection() {
      const account = asRecord(await request("GET", "/v1/account"));
      return {
        livemode: liveMode,
        country: str(account.country),
        defaultCurrency: str(account.default_currency),
        chargesEnabled: account.charges_enabled === true,
        payoutsEnabled: account.payouts_enabled === true,
      };
    },

    async createProduct({ name, plan, currency, unitAmountMinor }, options = {}) {
      requireUsd(currency);
      const planKey = normalizePlan(plan);
      const lookupKey = stripeLookupKey(planKey);
      if (options.reuse !== false) {
        const existing = asRecord(
          await request("GET", "/v1/prices", {
            query: { lookup_keys: [lookupKey], active: true, limit: 1 },
          }),
        );
        const found = Array.isArray(existing.data) ? existing.data.filter(isRecord)[0] : null;
        const foundId = str(found?.id);
        const foundProduct = idOf(found?.product);
        if (found && foundId && foundProduct && matchesMonthlyPrice(found, unitAmountMinor))
          return { productId: foundProduct, priceId: foundId, reused: true };
      }
      const metadata = { plan: planKey, currency: "USD", source: "puntosfieles" };
      const price = asRecord(
        await request("POST", "/v1/prices", {
          idempotencyKey: `pf-sync-${lookupKey}-${unitAmountMinor}-${options.previousPriceId || "initial"}`,
          form: {
            product_data: { name, metadata },
            currency: "usd",
            unit_amount: unitAmountMinor,
            recurring: { interval: "month", interval_count: 1 },
            lookup_key: lookupKey,
            // Moves the key from an older price when the sync is forced.
            transfer_lookup_key: true,
            // Published amounts include IVA (owner decision 2026-11-26); nothing is added.
            tax_behavior: "inclusive",
            nickname: `${planKey} USD mensual`,
            metadata,
          },
        }),
      );
      const priceId = str(price.id);
      const productId = idOf(price.product);
      if (!priceId || !productId)
        throw new BillingProviderError("Stripe price response lacks id", {
          status: 200,
          body: price,
        });
      return { productId, priceId, reused: false };
    },

    async createCustomer({ businessId, email, name, phone = null }) {
      /** @type {Record<string, unknown>} */
      const form = { email, name, metadata: { business_id: businessId, source: "puntosfieles" } };
      if (phone) form.phone = String(phone).slice(0, 20);
      const body = asRecord(
        await request("POST", "/v1/customers", {
          form,
          idempotencyKey: `pf-customer-${businessId}`,
        }),
      );
      const id = str(body.id);
      if (!id)
        throw new BillingProviderError("Stripe customer response lacks id", {
          status: 200,
          body,
        });
      return { provider: "stripe", providerCustomerId: id };
    },

    async createCheckout({
      customer,
      plan,
      quantity,
      currency,
      successUrl,
      cancelUrl,
      metadata,
      idempotencyKey,
    }) {
      requireUsd(currency);
      const { priceId, unitAmountMinor } = await resolvePrice(plan);
      const body = asRecord(
        await request("POST", "/v1/checkout/sessions", {
          idempotencyKey,
          form: {
            mode: "subscription",
            adaptive_pricing: { enabled: false },
            automatic_tax: { enabled: false },
            line_items: [{ price: priceId, quantity }],
            customer: customer.providerCustomerId,
            success_url: successUrl,
            cancel_url: cancelUrl,
            client_reference_id: metadata.business_id,
            metadata,
            subscription_data: { metadata: { ...metadata, pf_price_id: priceId } },
            locale: "es-419",
            expires_at: Math.floor((now().getTime() + checkoutTtlMs) / 1000),
          },
        }),
      );
      const providerCheckoutId = str(body.id);
      const url = str(body.url);
      if (!providerCheckoutId || !url)
        throw new BillingProviderError("Stripe checkout session response lacks id or url", {
          status: 200,
          body,
        });
      return {
        providerCheckoutId,
        url,
        expiresAt: isoFromSeconds(body.expires_at),
        unitAmountMinor,
      };
    },

    async fetchCheckout(providerCheckoutId) {
      const body = asRecord(
        await request("GET", `/v1/checkout/sessions/${encodeURIComponent(providerCheckoutId)}`),
      );
      return {
        id: str(body.id) ?? providerCheckoutId,
        status: str(body.status) ?? "unknown",
        paymentStatus: str(body.payment_status),
        subscriptionId: idOf(body.subscription),
        raw: body,
      };
    },

    async verifyWebhook({ rawBody, headers }) {
      if (!webhookSecret) return false;
      return verifyStripeSignature({ secret: webhookSecret, rawBody, headers, now: now() });
    },

    parseEvent(rawBody) {
      /** @type {unknown} */
      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        throw new HttpError(400, "Cuerpo del webhook no es JSON válido", "BAD_JSON");
      }
      return parseStripeEvent(payload, { defaultLiveMode: liveMode, now: now() });
    },

    async fetchSubscription(providerSubscriptionId) {
      return snapshotOf(
        await request("GET", `/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, {
          query: { expand: ["latest_invoice"] },
        }),
      );
    },

    async changeSubscription(providerSubscriptionId, { quantity, plan, mode }) {
      const current = await this.fetchSubscription(providerSubscriptionId);
      const itemId = current.metadata.provider_item_id;
      if (!itemId)
        throw new BillingProviderError("Stripe subscription has no item to update", {
          status: 200,
        });
      const targetPlan = plan
        ? normalizePlan(plan)
        : current.metadata.provider_pending_plan || current.plan;
      const targetQuantity =
        quantity ?? (Number(current.metadata.provider_pending_quantity) || current.quantity);
      const { priceId: targetPriceId } = await resolvePrice(targetPlan);
      const deferred = mode === "next_cycle";
      if (deferred && !current.currentPeriodEnd)
        throw new BillingProviderError("Stripe subscription item has no renewal date");
      /** @type {Record<string, string>} */
      const bookkeeping = Object.fromEntries(PENDING_KEYS.map((key) => [key, ""]));
      if (deferred) {
        // The paid item stays the entitlement until the period turns (design section 6).
        bookkeeping.pf_pending_from = /** @type {string} */ (current.currentPeriodEnd);
        bookkeeping.pf_pending_plan = targetPlan;
        bookkeeping.pf_pending_quantity = String(targetQuantity);
        bookkeeping.pf_previous_plan = current.plan;
        bookkeeping.pf_previous_amount = String(current.unitAmountMinor);
        bookkeeping.pf_previous_quantity = String(current.quantity);
      }
      /** @type {Record<string, unknown>} */
      const form = {
        items: [{ id: itemId, price: targetPriceId, quantity: targetQuantity }],
        metadata: {
          ...bookkeeping,
          plan: targetPlan,
          quantity: String(targetQuantity),
          pf_price_id: targetPriceId,
        },
        expand: ["latest_invoice"],
      };
      if (mode === "now_and_charge") {
        form.proration_behavior = "always_invoice";
        form.payment_behavior = "error_if_incomplete";
      } else {
        form.proration_behavior = "none";
        form.billing_cycle_anchor = "unchanged";
      }
      const body = await request(
        "POST",
        `/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
        { idempotencyKey: crypto.randomUUID(), form },
      );
      return snapshotOf(body);
    },

    async cancel(providerSubscriptionId, { atPeriodEnd, reason }) {
      const path = `/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}`;
      if (atPeriodEnd) {
        /** @type {Record<string, unknown>} */
        const form = { cancel_at_period_end: true, expand: ["latest_invoice"] };
        if (reason) form.cancellation_details = { comment: String(reason).slice(0, 200) };
        return snapshotOf(
          await request("POST", path, { form, idempotencyKey: crypto.randomUUID() }),
        );
      }
      const body = await request("DELETE", path);
      if (isRecord(body) && str(body.id)) return snapshotOf(body);
      return this.fetchSubscription(providerSubscriptionId);
    },
  };
}
