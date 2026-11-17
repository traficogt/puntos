import { isLedgerAmount } from "../../utils/ledger-limits.js";

function pick(obj, keys, fallback = null) {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== "") return obj[k];
  }
  return fallback;
}

/**
 * A payment amount is a finite, non-negative ledger amount with at most two
 * decimals: a JSON number or a plain decimal string ("48.50"). Anything else,
 * including a missing amount, booleans, "", "abc", "1e3" or "10,50", is null so
 * the event can never be applied as a zero-value payment.
 * @returns {number|null}
 */
export function parsePaymentAmount(value) {
  if (typeof value === "number") return isLedgerAmount(value) ? Math.round(value * 100) / 100 : null;
  if (typeof value !== "string" || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Number(value.trim());
  return isLedgerAmount(amount) ? amount : null;
}

const SUCCESS_STATUSES = new Set(["APPROVED", "PAID", "SUCCESS", "SUCCEEDED", "COMPLETED"]);
const SUCCESS_EVENTS = new Set([
  ...SUCCESS_STATUSES,
  "PAYMENT.APPROVED", "PAYMENT.PAID", "PAYMENT.SUCCESS", "PAYMENT.SUCCEEDED", "PAYMENT.COMPLETED"
]);
const UPDATE_EVENTS = new Set(["PAYMENT.UPDATED"]);

function eventTokens(payload, keys) {
  return keys
    .filter((key) => payload[key] !== undefined)
    .map((key) => typeof payload[key] === "string" ? payload[key].trim().toUpperCase() : "");
}

function isApprovedPayment(payload) {
  const statuses = eventTokens(payload, ["status", "payment_status"]);
  const events = eventTokens(payload, ["event", "event_name", "type"]);

  // Treat unknown, conflicting, or refund states as non-awarding. Substring
  // matching would incorrectly accept UNPAID, NOT_APPROVED, and refund.success.
  if (statuses.length) {
    return statuses.every((status) => SUCCESS_STATUSES.has(status))
      && events.every((event) => SUCCESS_EVENTS.has(event) || UPDATE_EVENTS.has(event));
  }
  return events.length > 0 && events.every((event) => SUCCESS_EVENTS.has(event));
}

export function normalizePaymentWebhook(provider, payload) {
  const p = payload ?? {};
  const meta = p.metadata ?? p.meta ?? p.additionalData ?? {};

  const eventType = isApprovedPayment(p) ? "payment.approved" : "payment.other";
  const providerEventId = String(
    pick(p, ["externalEventId", "transaction_id", "transactionId", "tx_id", "id", "reference"], "")
  );

  return {
    provider,
    eventType,
    providerEventId,
    businessSlug: String(pick(meta, ["businessSlug", "business_slug"], pick(p, ["businessSlug", "business_slug"], "")) || ""),
    customerId: pick(meta, ["customerId", "customer_id"], pick(p, ["customerId", "customer_id"], null)),
    customerPhone: pick(meta, ["customerPhone", "customer_phone", "phone"], pick(p, ["customerPhone", "customer_phone", "phone"], null)),
    // null when missing or invalid; callers must not award such an event.
    amount_q: parsePaymentAmount(pick(p, ["amount_q", "amount", "total", "value"], null)),
    currency: String(pick(p, ["currency"], "GTQ") || "GTQ"),
    externalEventId: providerEventId || String(pick(p, ["order_id", "orderId"], "")),
    raw: p
  };
}
