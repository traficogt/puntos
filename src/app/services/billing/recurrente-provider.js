// Recurrente adapter: a pure HTTP mapper over https://app.recurrente.com/api with an
// injected `fetch` and `config`, verified against docs.recurrente.com on 2026-11-25
// (design section 5.2) and re-read for the exact request shapes on the same day:
//
// - Auth is the `X-SECRET-KEY` header alone (the former X-PUBLIC-KEY is no longer used);
//   the key fixes the environment (sk_live_ vs sk_test_ inside a Sandbox).
// - `POST /checkouts` takes `items: [{ price_id, quantity }]`, `customer_id`,
//   `success_url`, `cancel_url`, `metadata`, `expires_at` and honours `Idempotency-Key`
//   for 24 h; one recurring line with quantity n is one subscription of n units.
// - `PUT /subscriptions/{id}` changes items with `items: [{ price_id, quantity } |
//   { price_id, deleted: true }]` and `mode: "next_cycle" | "now" | "now_and_charge"`;
//   `cancel_at_period_end: true` must travel in its own call; `DELETE` cancels now.
// - Webhooks are Svix-signed: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${body}`
//   with the base64 part after `whsec_`; several `v1,` signatures may be space separated.
// - Unified `intent.*` payloads carry `amount_in_cents`, `currency`, `customer{}`,
//   `product{}`, `subscription{ id }`, `checkout{ id, status, metadata }`,
//   `tax_invoice_url` and `details.fee`; `subscription.*` payloads use the subscription
//   id as `id`, so deduplication relies on the `svix-id` header.
//
// Facts the SubscriptionSnapshot contract has no field for (retries, next attempt,
// cancellation reason, period end of a scheduled cancel) travel in `snapshot.metadata`
// under the reserved `provider_*` keys below; subscription-service copies them into
// billing_subscriptions.metadata.
import crypto from "node:crypto";
import { HttpError } from "../../../utils/http-error.js";
import { isPlanName, normalizePlan } from "../../../utils/plan.js";
import { BillingProviderError, metadataStrings } from "./provider.js";

/** @typedef {import("./provider.js").BillingProvider} BillingProvider */
/** @typedef {import("./provider.js").BillingEvent} BillingEvent */
/** @typedef {import("./provider.js").SubscriptionSnapshot} SubscriptionSnapshot */
/** @typedef {import("../../../utils/plan.js").PlanName} PlanName */
/**
 * The slice of the resolved billing catalog this adapter reads
 * (src/utils/plan.js resolveBillingCatalog).
 * @typedef {{
 *   usd: Record<string, number>,
 *   gtq: Record<string, number> | null,
 *   providers: { recurrente: { price_ids: { GTQ: Record<string, string>, USD: Record<string, string> } } }
 * }} CatalogLike
 */
/**
 * @typedef {{
 *   secretKey: string,
 *   webhookSecret: string,
 *   apiBase?: string,
 *   getCatalog: () => Promise<CatalogLike>,
 *   now?: () => Date,
 *   timeoutMs?: number,
 *   checkoutTtlMs?: number,
 *   toleranceSeconds?: number
 * }} RecurrenteConfig
 */
/** Minimal fetch surface the adapter needs (global fetch satisfies it). */
/** @typedef {(url: string, init: { method: string, headers: Record<string, string>, body?: string, signal?: AbortSignal }) => Promise<{ ok: boolean, status: number, text(): Promise<string> }>} FetchLike */
/** Provider-only extras beyond the §5.1 contract. */
/**
 * @typedef {BillingProvider & {
 *   liveMode: boolean,
 *   testConnection: () => Promise<{ environment: string, sandboxId: string | null }>,
 *   createProduct: (input: { name: string, description?: string, plan: string, currency: "GTQ"|"USD", unitAmountMinor: number, billingInfoRequired?: boolean }) => Promise<{ productId: string, priceId: string }>,
 *   fetchCheckout: (providerCheckoutId: string) => Promise<{ id: string, status: string, subscriptionId: string | null, raw: unknown }>
 * }} RecurrenteProvider
 */

export const RECURRENTE_API_BASE = "https://app.recurrente.com/api";
export const WEBHOOK_TOLERANCE_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;

/** Recurrente event types and their normalized counterparts (design section 5.2). */
export const RECURRENTE_EVENT_MAP = Object.freeze({
  "intent.succeeded": "payment_succeeded",
  "payment_intent.succeeded": "payment_succeeded",
  "intent.failed": "payment_failed",
  "payment_intent.failed": "payment_failed",
  "subscription.create": "subscription_created",
  "subscription.past_due": "subscription_past_due",
  "subscription.update": "subscription_updated",
  "subscription.item_added": "subscription_updated",
  "subscription.item_removed": "subscription_updated",
  "subscription.pause": "subscription_updated",
  "subscription.unpause": "subscription_updated",
  "subscription.reactivate": "subscription_updated",
  "subscription.cancel": "subscription_canceled",
  "refund.create": "refund_created",
  "dispute.create": "dispute_opened",
  "dispute.update": "dispute_opened",
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
/** @param {unknown} value @returns {"GTQ" | "USD" | null} */
const currencyOf = (value) => (value === "GTQ" || value === "USD" ? value : null);
/** @param {unknown} value */
const isoOrNull = (value) => {
  const date = typeof value === "string" || value instanceof Date ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/**
 * Case-insensitive header lookup over a plain header map.
 * @param {Record<string, string | string[] | undefined>} headers
 * @param {string} name
 */
export function headerValue(headers, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() !== wanted) continue;
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" ? first : null;
  }
  return null;
}

/** @param {string} secret the `whsec_…` signing secret (or its bare base64 part) */
export function signingKey(secret) {
  const raw = String(secret || "").trim();
  const encoded = raw.startsWith("whsec_") ? raw.slice("whsec_".length) : raw;
  return Buffer.from(encoded, "base64");
}

/**
 * Svix signature check as docs.recurrente.com/guides-english/getting-started/webhooks
 * describes it: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}` with the
 * decoded secret, constant-time compare, timestamp within `toleranceSeconds`, and any
 * one of several space-separated `v1,` signatures accepted (secret rotation).
 * @param {{
 *   secret: string,
 *   rawBody: string,
 *   headers: Record<string, string | string[] | undefined>,
 *   now?: Date,
 *   toleranceSeconds?: number
 * }} input
 */
export function verifySvixSignature({
  secret,
  rawBody,
  headers,
  now = new Date(),
  toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
}) {
  if (!secret || typeof rawBody !== "string") return false;
  const id = headerValue(headers, "svix-id");
  const timestamp = headerValue(headers, "svix-timestamp");
  const signatures = headerValue(headers, "svix-signature");
  if (!id || !timestamp || !signatures) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  const skew = Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp));
  if (skew > toleranceSeconds) return false;
  const key = signingKey(secret);
  if (!key.length) return false;
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`, "utf8")
    .digest();
  let matched = false;
  for (const entry of signatures.split(/\s+/)) {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) continue;
    const candidate = Buffer.from(value, "base64");
    if (candidate.length !== expected.length) continue;
    if (crypto.timingSafeEqual(candidate, expected)) matched = true;
  }
  return matched;
}

/**
 * Builds the canonical svix headers for a payload: tests and the sandbox script sign
 * fixtures with it, so the verifier is exercised against real signatures.
 * @param {{ secret: string, rawBody: string, id?: string, timestamp?: number }} input
 */
export function signSvixPayload({ secret, rawBody, id = "msg_fixture", timestamp }) {
  const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac("sha256", signingKey(secret))
    .update(`${id}.${ts}.${rawBody}`, "utf8")
    .digest("base64");
  return { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${signature}` };
}

/**
 * Maps a Recurrente webhook payload to the normalized BillingEvent (design section 5.2).
 * Unknown event types become `ignored` so the webhook never answers 5xx for them.
 * @param {unknown} payload parsed JSON body
 * @param {{ defaultLiveMode?: boolean, now?: Date }} [options]
 * @returns {BillingEvent}
 */
export function parseRecurrenteEvent(payload, { defaultLiveMode = true, now = new Date() } = {}) {
  const body = asRecord(payload);
  const eventType = str(body.event_type) ?? "";
  const type = /** @type {BillingEvent["type"]} */ (
    Object.prototype.hasOwnProperty.call(RECURRENTE_EVENT_MAP, eventType)
      ? RECURRENTE_EVENT_MAP[/** @type {keyof typeof RECURRENTE_EVENT_MAP} */ (eventType)]
      : "ignored"
  );
  const checkout = isRecord(body.checkout) ? body.checkout : null;
  const payment = isRecord(body.payment) ? body.payment : null;
  const paymentable = payment && isRecord(payment.paymentable) ? payment.paymentable : null;
  const subscription = isRecord(body.subscription) ? body.subscription : null;
  const customer = isRecord(body.customer) ? body.customer : null;
  const details = isRecord(body.details) ? body.details : null;
  const metadata = {
    ...metadataStrings(paymentable?.metadata),
    ...metadataStrings(checkout?.metadata),
    ...metadataStrings(body.metadata),
  };
  const isSubscriptionEvent = eventType.startsWith("subscription.");
  const providerSubscriptionId =
    (isSubscriptionEvent ? str(body.id) : null) ??
    str(subscription?.id) ??
    (paymentable?.type === "Subscription" ? str(paymentable.id) : null) ??
    undefined;
  const liveMode =
    typeof checkout?.live_mode === "boolean"
      ? checkout.live_mode
      : typeof body.live_mode === "boolean"
        ? body.live_mode
        : defaultLiveMode;
  /** @type {BillingEvent} */
  const event = {
    id: str(body.id) ?? `recurrente:${eventType || "unknown"}:${now.getTime()}`,
    liveMode,
    occurredAt: isoOrNull(body.created_at) ?? now.toISOString(),
    metadata,
    raw: payload,
    type,
  };
  if (providerSubscriptionId) event.providerSubscriptionId = providerSubscriptionId;
  const providerCheckoutId = str(checkout?.id);
  if (providerCheckoutId) event.providerCheckoutId = providerCheckoutId;
  const providerCustomerId = str(customer?.id) ?? str(body.customer_id);
  if (providerCustomerId) event.providerCustomerId = providerCustomerId;
  const amount = int(body.amount_in_cents);
  if (amount !== null) event.amountMinor = amount;
  const currency = currencyOf(body.currency) ?? currencyOf(checkout?.currency);
  if (currency) event.currency = currency;
  const fee = int(details?.fee);
  if (fee !== null) event.feeMinor = fee;
  if (type === "payment_succeeded" || type === "payment_failed")
    event.taxInvoiceUrl = str(body.tax_invoice_url);
  return event;
}

/** @param {unknown} status */
export function mapRecurrenteStatus(status) {
  switch (status) {
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "paused":
      return "paused";
    default:
      return "canceled";
  }
}

/**
 * The subscription item that is charged at `now` (a `next_cycle` change shows up as an
 * item that starts or ends in the future).
 * @param {unknown} items
 * @param {Date} now
 */
function currentItem(items, now) {
  const list = Array.isArray(items) ? items.filter(isRecord) : [];
  const live = list.filter((item) => {
    const started = isoOrNull(item.started_at);
    const ended = isoOrNull(item.ended_at);
    return (!started || new Date(started) <= now) && (!ended || new Date(ended) > now);
  });
  return live[0] ?? list[0] ?? null;
}

/**
 * Reverse lookup of a Recurrente price id in the catalog.
 * @param {CatalogLike} catalog
 * @param {string | null} priceId
 * @returns {{ plan: PlanName, currency: "GTQ" | "USD" } | null}
 */
export function planForPriceId(catalog, priceId) {
  if (!priceId) return null;
  for (const currency of /** @type {Array<"GTQ" | "USD">} */ (["USD", "GTQ"])) {
    const map = catalog.providers?.recurrente?.price_ids?.[currency] ?? {};
    for (const [plan, id] of Object.entries(map)) {
      if (id === priceId && isPlanName(plan)) return { plan, currency };
    }
  }
  return null;
}

/**
 * Catalog amount for a plan and currency, in minor units.
 * @param {CatalogLike} catalog
 * @param {string} plan
 * @param {"GTQ" | "USD"} currency
 */
export function catalogUnitAmountMinor(catalog, plan, currency) {
  const key = normalizePlan(plan);
  const amounts = currency === "GTQ" ? catalog.gtq : catalog.usd;
  const amount = amounts && isPlanName(key) ? Number(amounts[key]) : NaN;
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
}

/**
 * Maps a Recurrente subscription object (GET/PUT /subscriptions/{id} and the
 * subscription.* webhook payloads share it) to the SubscriptionSnapshot contract.
 * @param {unknown} body
 * @param {{ catalog: CatalogLike, now?: Date }} options
 * @returns {SubscriptionSnapshot}
 */
export function subscriptionSnapshot(body, { catalog, now = new Date() }) {
  const sub = asRecord(body);
  const item = currentItem(sub.items, now);
  const metadata = metadataStrings(sub.metadata);
  const priceId = str(item?.price_id);
  const resolved = planForPriceId(catalog, priceId);
  const plan = resolved?.plan ?? normalizePlan(metadata.plan ?? "");
  const currency = resolved?.currency ?? currencyOf(metadata.currency) ?? "USD";
  const unitAmountMinor =
    catalogUnitAmountMinor(catalog, plan, currency) ??
    (int(Number(metadata.unit_amount_minor)) || 0);
  const cancellation = isRecord(sub.cancellation_details) ? sub.cancellation_details : null;
  const extras = {
    provider_price_id: priceId ?? "",
    provider_payment_retries: String(int(sub.payment_retries) ?? 0),
    provider_next_payment_attempt_at: isoOrNull(sub.next_payment_attempt_at) ?? "",
    provider_ended_at: isoOrNull(sub.ended_at) ?? "",
    provider_cancelled_at: isoOrNull(sub.cancelled_at) ?? "",
    provider_cancel_at_period_end: sub.cancel_at_period_end === true ? "true" : "false",
    provider_cancellation_reason: str(cancellation?.reason) ?? "",
    provider_status: str(sub.status) ?? "",
  };
  return {
    providerSubscriptionId: str(sub.id) ?? "",
    status: mapRecurrenteStatus(sub.status),
    plan,
    quantity: Math.max(1, int(item?.quantity) ?? 1),
    currency,
    unitAmountMinor,
    currentPeriodStart: isoOrNull(sub.current_period_start),
    currentPeriodEnd: isoOrNull(sub.current_period_end),
    cancelAt: isoOrNull(sub.cancel_at),
    metadata: { ...metadata, ...extras },
  };
}

/** @param {unknown} body */
function errorDetails(body) {
  if (!isRecord(body)) return { message: "", code: null };
  const message = str(body.message) ?? "";
  const code = str(body.code);
  return { message: message.slice(0, 300), code };
}

/**
 * @param {{ fetch: FetchLike, config: RecurrenteConfig }} input
 * @returns {RecurrenteProvider}
 */
export function createRecurrenteProvider({ fetch, config }) {
  const secretKey = String(config.secretKey || "").trim();
  if (!secretKey) throw new Error("Recurrente provider requires a secret key");
  const webhookSecret = String(config.webhookSecret || "").trim();
  const apiBase = String(config.apiBase || RECURRENTE_API_BASE).replace(/\/+$/, "");
  const now = config.now ?? (() => new Date());
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const checkoutTtlMs = config.checkoutTtlMs ?? DEFAULT_CHECKOUT_TTL_MS;
  const liveMode = secretKey.startsWith("sk_live_");

  /**
   * @param {string} method
   * @param {string} path
   * @param {{ body?: unknown, idempotencyKey?: string | null }} [options]
   * @returns {Promise<unknown>}
   */
  async function request(method, path, { body, idempotencyKey = null } = {}) {
    /** @type {Record<string, string>} */
    const headers = { "X-SECRET-KEY": secretKey, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    /** @type {{ ok: boolean, status: number, text(): Promise<string> }} */
    let response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new BillingProviderError(
        `Recurrente request failed: ${error instanceof Error ? error.message : "network error"}`,
        { status: 0 },
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
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
        `Recurrente ${method} ${path} answered ${response.status}${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}`,
        { status: response.status, providerCode: code, body: parsed },
      );
    }
    return parsed;
  }

  /**
   * @param {string} plan
   * @param {"GTQ" | "USD"} currency
   */
  async function resolvePrice(plan, currency) {
    const catalog = await config.getCatalog();
    const key = normalizePlan(plan);
    const priceId = str(catalog.providers?.recurrente?.price_ids?.[currency]?.[key]);
    const unitAmountMinor = catalogUnitAmountMinor(catalog, key, currency);
    if (!priceId || !unitAmountMinor)
      throw new HttpError(
        503,
        "El catálogo de precios en línea no está completo todavía. Escríbenos y activamos tu plan.",
        "BILLING_UNAVAILABLE",
      );
    return { priceId, unitAmountMinor, catalog };
  }

  /** @param {unknown} body */
  async function snapshotOf(body) {
    return subscriptionSnapshot(body, { catalog: await config.getCatalog(), now: now() });
  }

  return {
    name: "recurrente",
    webhookConfigured: Boolean(webhookSecret),
    liveMode,

    async testConnection() {
      const body = await request("GET", "/test");
      const record = asRecord(body);
      return {
        environment: str(record.environment) ?? "unknown",
        sandboxId: str(record.sandbox_id),
      };
    },

    async createProduct({ name, description, plan, currency, unitAmountMinor }) {
      const body = await request("POST", "/products", {
        body: {
          product: {
            name,
            description: description ?? `${name}: suscripción mensual por sucursal`,
            tax_category: "service",
            phone_requirement: "optional",
            // The owner does not issue FEL invoices (2026-11-26), so the NIT is never required at checkout.
            billing_info_requirement: "optional",
            prices_attributes: [
              {
                amount_in_cents: unitAmountMinor,
                currency,
                charge_type: "recurring",
                billing_interval: "month",
                billing_interval_count: 1,
              },
            ],
            metadata: { plan: normalizePlan(plan), currency, source: "puntosfieles" },
          },
        },
      });
      const record = asRecord(body);
      const prices = Array.isArray(record.prices) ? record.prices.filter(isRecord) : [];
      const productId = str(record.id);
      const priceId = str(prices[0]?.id);
      if (!productId || !priceId)
        throw new BillingProviderError("Recurrente product response lacks id or prices[0].id", {
          status: 200,
          body,
        });
      return { productId, priceId };
    },

    async createCustomer({ businessId, email, name, phone = null, taxId = null }) {
      /** @type {Record<string, unknown>} */
      const payload = { email, full_name: name, metadata: { business_id: businessId } };
      if (phone) payload.phone = phone;
      if (taxId) payload.nit = taxId;
      const body = await request("POST", "/customers", { body: payload });
      const id = str(isRecord(body) ? body.id : null);
      if (!id)
        throw new BillingProviderError("Recurrente customer response lacks id", {
          status: 200,
          body,
        });
      return { provider: "recurrente", providerCustomerId: id };
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
      const { priceId, unitAmountMinor } = await resolvePrice(plan, currency);
      const body = await request("POST", "/checkouts", {
        idempotencyKey,
        body: {
          items: [{ price_id: priceId, quantity }],
          customer_id: customer.providerCustomerId,
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata,
          expires_at: new Date(now().getTime() + checkoutTtlMs).toISOString(),
        },
      });
      const record = asRecord(body);
      const providerCheckoutId = str(record.id);
      const url = str(record.checkout_url);
      if (!providerCheckoutId || !url)
        throw new BillingProviderError("Recurrente checkout response lacks id or checkout_url", {
          status: 200,
          body,
        });
      return { providerCheckoutId, url, expiresAt: isoOrNull(record.expires_at), unitAmountMinor };
    },

    async fetchCheckout(providerCheckoutId) {
      const body = await request("GET", `/checkouts/${encodeURIComponent(providerCheckoutId)}`);
      const record = asRecord(body);
      const payment = isRecord(record.payment) ? record.payment : null;
      const paymentable = payment && isRecord(payment.paymentable) ? payment.paymentable : null;
      return {
        id: str(record.id) ?? providerCheckoutId,
        status: str(record.status) ?? "unknown",
        subscriptionId: paymentable?.type === "Subscription" ? str(paymentable.id) : null,
        raw: body,
      };
    },

    async verifyWebhook({ rawBody, headers }) {
      if (!webhookSecret) return false;
      return verifySvixSignature({ secret: webhookSecret, rawBody, headers, now: now() });
    },

    parseEvent(rawBody) {
      /** @type {unknown} */
      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        throw new HttpError(400, "Cuerpo del webhook no es JSON válido", "BAD_JSON");
      }
      return parseRecurrenteEvent(payload, { defaultLiveMode: liveMode, now: now() });
    },

    async fetchSubscription(providerSubscriptionId) {
      return snapshotOf(
        await request("GET", `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`),
      );
    },

    async changeSubscription(providerSubscriptionId, { quantity, plan, mode }) {
      const current = await this.fetchSubscription(providerSubscriptionId);
      const currentPriceId = current.metadata.provider_price_id || null;
      const targetPlan = plan ? normalizePlan(plan) : current.plan;
      const targetQuantity = quantity ?? current.quantity;
      const { priceId: targetPriceId } = await resolvePrice(targetPlan, current.currency);
      /** @type {Array<Record<string, unknown>>} */
      const items = [];
      if (currentPriceId && currentPriceId !== targetPriceId) {
        // Plan swap: remove the old price line and add the new one in the same call
        // (design section 11.1; the sandbox check verifies this assumption).
        items.push({ price_id: currentPriceId, deleted: true });
      }
      items.push({ price_id: targetPriceId, quantity: targetQuantity });
      const body = await request(
        "PUT",
        `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
        { idempotencyKey: crypto.randomUUID(), body: { items, mode } },
      );
      return snapshotOf(body);
    },

    async cancel(providerSubscriptionId, { atPeriodEnd, reason }) {
      const path = `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`;
      if (atPeriodEnd) {
        /** @type {Record<string, unknown>} */
        const payload = { cancel_at_period_end: true };
        if (reason) payload.cancellation_details = { comment: String(reason).slice(0, 200) };
        return snapshotOf(await request("PUT", path, { body: payload }));
      }
      const body = await request("DELETE", path);
      if (isRecord(body) && str(body.id)) return snapshotOf(body);
      return this.fetchSubscription(providerSubscriptionId);
    },
  };
}
