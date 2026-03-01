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

export function normalizePaymentWebhook(provider, payload) {
  const p = payload ?? {};
  const meta = p.metadata ?? p.meta ?? p.additionalData ?? {};

  const statusRaw = String(
    pick(p, ["status", "event", "event_name", "type", "payment_status"], "")
  ).toUpperCase();
  const approved = statusRaw.includes("APPROV") || statusRaw.includes("PAID") || statusRaw.includes("SUCCESS");

  const eventType = approved ? "payment.approved" : "payment.other";
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
