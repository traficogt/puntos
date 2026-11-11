function pick(obj, keys, fallback = null) {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== "") return obj[k];
  }
  return fallback;
}

function parseAmount(v) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
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
    amount_q: parseAmount(pick(p, ["amount_q", "amount", "total", "value"], 0)),
    currency: String(pick(p, ["currency"], "GTQ") || "GTQ"),
    externalEventId: providerEventId || String(pick(p, ["order_id", "orderId"], "")),
    raw: p
  };
}
