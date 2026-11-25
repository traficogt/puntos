// Provider-agnostic billing contract (design of record
// docs/product/2026-11-25-self-serve-trial.md, section 5.1). subscription-service.js
// owns the orchestration; providers are pure HTTP mappers with injected `fetch` and
// `config`, unit-tested with recorded payloads under tests/fixtures/billing/.

/** @typedef {"recurrente"|"stripe"|"manual"} ProviderName */
/** @typedef {{ provider: ProviderName, providerCustomerId: string }} BillingCustomerRef */
/** @typedef {{ providerSubscriptionId: string, status: "active"|"past_due"|"paused"|"canceled", plan: string,
 *   quantity: number, currency: "GTQ"|"USD", unitAmountMinor: number, currentPeriodStart: string|null,
 *   currentPeriodEnd: string|null, cancelAt: string|null, metadata: Record<string,string> }} SubscriptionSnapshot */
/** @typedef {{ id: string, liveMode: boolean, occurredAt: string, metadata: Record<string,string>, raw: unknown,
 *   type: "checkout_completed"|"subscription_created"|"payment_succeeded"|"payment_failed"|"subscription_past_due"
 *       |"subscription_updated"|"subscription_canceled"|"refund_created"|"dispute_opened"|"ignored",
 *   providerSubscriptionId?: string, providerCheckoutId?: string, providerCustomerId?: string,
 *   amountMinor?: number, currency?: "GTQ"|"USD", feeMinor?: number, taxInvoiceUrl?: string|null }} BillingEvent */
/**
 * @typedef {object} BillingProvider
 * @property {ProviderName} name
 * @property {(input: { businessId: string, email: string, name: string, phone?: string|null, taxId?: string|null }) => Promise<BillingCustomerRef>} createCustomer
 * @property {(input: { customer: BillingCustomerRef, plan: string, quantity: number, currency: "GTQ"|"USD", successUrl: string,
 *   cancelUrl: string, metadata: Record<string,string>, idempotencyKey: string })
 *   => Promise<{ providerCheckoutId: string, url: string, expiresAt: string|null, unitAmountMinor: number }>} createCheckout
 * @property {(input: { rawBody: string, headers: Record<string,string|undefined> }) => Promise<boolean>} verifyWebhook
 * @property {(rawBody: string) => BillingEvent} parseEvent
 * @property {(providerSubscriptionId: string) => Promise<SubscriptionSnapshot>} fetchSubscription
 * @property {(providerSubscriptionId: string, input: { quantity?: number, plan?: string, mode: "now_and_charge"|"next_cycle" }) => Promise<SubscriptionSnapshot>} changeSubscription
 * @property {(providerSubscriptionId: string, input: { atPeriodEnd: boolean, reason?: string }) => Promise<SubscriptionSnapshot>} cancel
 */

/** Every provider name the billing tables accept (CHECK constraints of migration 2026-11-26-c). */
export const PROVIDER_NAMES = Object.freeze(["recurrente", "stripe", "manual"]);

/** Every normalized event type a provider may emit. */
export const BILLING_EVENT_TYPES = Object.freeze([
  "checkout_completed",
  "subscription_created",
  "payment_succeeded",
  "payment_failed",
  "subscription_past_due",
  "subscription_updated",
  "subscription_canceled",
  "refund_created",
  "dispute_opened",
  "ignored",
]);

/** Quantity bounds of one subscription line at checkout (design section 6). */
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 9;

/**
 * Error raised by a provider mapper when the remote API answers with a failure. The
 * message never carries the request headers; `status` is the upstream HTTP status and
 * `code` the stable API code the error handler forwards (502 BILLING_PROVIDER_ERROR).
 */
export class BillingProviderError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, providerCode?: string | null, body?: unknown }} [details]
   */
  constructor(message, { status = 502, providerCode = null, body = undefined } = {}) {
    super(message);
    this.name = "BillingProviderError";
    this.statusCode = 502;
    this.status = 502;
    this.code = "BILLING_PROVIDER_ERROR";
    this.upstreamStatus = status;
    this.providerCode = providerCode;
    this.body = body;
  }
}

/**
 * @param {unknown} value
 * @returns {value is ProviderName}
 */
export function isProviderName(value) {
  return typeof value === "string" && PROVIDER_NAMES.includes(value);
}

/**
 * Flattens provider metadata to the string map the contract carries (numbers and
 * booleans are stringified; nested values are dropped).
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function metadataStrings(raw) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      out[key] = String(value);
  }
  return out;
}
