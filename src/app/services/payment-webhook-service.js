import crypto from "node:crypto";
import { dbQuery, setCurrentTenant, setWebhookIngest } from "../database.js";
import { config } from "../../config/index.js";
import { normalizePhone } from "../../utils/phone.js";
import { awardFromExternalEventTrusted } from "./external-award-service.js";
import { normalizePaymentWebhook, parsePaymentAmount } from "./payment-webhook-normalizer.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/http-error.js";
import { logger } from "../../utils/logger.js";

function id() { return crypto.randomUUID(); }

const INVALID_AMOUNT = "invalid_amount";

function normalizeProvider(provider) {
  const p = String(provider || "").trim().toLowerCase();
  if (!p) throw badRequest("provider is required");
  const allowed = config.PAYMENT_WEBHOOK_ALLOWED_PROVIDERS || [];
  if (allowed.length > 0 && !allowed.includes(p)) {
    throw forbidden("Provider is not allowed");
  }
  return p;
}

function validateProviderSecret(provider, secretHeader) {
  const configured = config.PAYMENT_WEBHOOK_SECRETS?.[provider];
  if (!configured) return;
  const received = String(secretHeader || "");
  const expected = String(configured);
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw forbidden("Invalid provider webhook secret");
  }
}

function normalizeSignature(signatureHeader = "") {
  const s = String(signatureHeader || "").trim();
  if (!s) return "";
  if (s.toLowerCase().startsWith("sha256=")) return s.slice(7).trim();
  return s;
}

function validateProviderHmac(provider, signatureHeader, rawBody) {
  const secret = config.PAYMENT_WEBHOOK_HMAC_SECRETS?.[provider];
  if (!secret) return;
  const received = normalizeSignature(signatureHeader);
  if (!received) throw forbidden("Missing webhook signature");
  const expected = crypto.createHmac("sha256", String(secret)).update(String(rawBody ?? "")).digest("hex");
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw forbidden("Invalid webhook signature");
  }
}

function assertProviderAuthConfigured(provider) {
  if (!config.PAYMENT_WEBHOOK_REQUIRE_AUTH) return;
  const hasSecret = Boolean(config.PAYMENT_WEBHOOK_SECRETS?.[provider]);
  const hasHmac = Boolean(config.PAYMENT_WEBHOOK_HMAC_SECRETS?.[provider]);
  if (!hasSecret && !hasHmac) {
    throw forbidden("Webhook auth is required but no provider secret/signature key is configured");
  }
}

function webhookLogContext({ provider, event = null, businessId = null, businessSlug = null, customerPhone = null, customerId = null, providerEventId = null, extra = {} }) {
  return {
    provider,
    eventId: event?.id ?? null,
    providerEventId: providerEventId ?? event?.provider_event_id ?? null,
    eventStatus: event?.status ?? null,
    businessId: businessId ?? event?.business_id ?? null,
    businessSlug: businessSlug ?? event?.business_slug ?? null,
    customerId: customerId ?? event?.customer_id ?? null,
    customerPhone: customerPhone ?? event?.customer_phone ?? null,
    ...extra
  };
}

// Provider event IDs are unique per merchant account, so an event is
// identified per destination: the resolved business, or the addressed slug
// while unmapped (see payment_webhook_events_destination_event_key). A row is
// never shared with, or taken over by, another destination.
async function insertOrGetEvent({
  provider,
  providerEventId,
  eventType,
  businessSlug,
  businessId,
  customerId,
  customerPhone,
  amount_q,
  currency,
  payload
}) {
  const eventId = id();
  const slug = businessSlug || null;
  const { rows } = await dbQuery(
    `INSERT INTO payment_webhook_events
     (id, provider, provider_event_id, event_type, business_slug, business_id, customer_id, customer_phone, amount_q, currency, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (provider, business_id, business_slug, provider_event_id) DO NOTHING
     RETURNING *`,
    [
      eventId,
      provider,
      providerEventId,
      eventType,
      slug,
      businessId ?? null,
      customerId ?? null,
      customerPhone ?? null,
      // The column is NOT NULL; an invalid amount is recorded as 0 with reason invalid_amount.
      amount_q ?? 0,
      currency || null,
      payload ?? {}
    ]
  );
  if (rows[0]) return rows[0];
  const params = [provider, providerEventId];
  let destination = "business_id IS NULL";
  if (businessId) {
    params.push(businessId);
    destination = `business_id = $${params.length}`;
  }
  let addressed = "business_slug IS NULL";
  if (slug) {
    params.push(slug);
    addressed = `business_slug = $${params.length}`;
  }
  const existing = await dbQuery(
    `SELECT * FROM payment_webhook_events
     WHERE provider=$1 AND provider_event_id=$2 AND ${destination} AND ${addressed}
     LIMIT 1`,
    params
  );
  return existing.rows?.[0] ?? null;
}

// Rows keep their destination (business_id, business_slug) for life; only the
// processing outcome and the customer/amount being applied change.
async function setEventStatus(eventId, patch = {}) {
  const {
    status = null,
    reason = null,
    error = null,
    linkedTransactionId = null,
    customerId = undefined,
    customerPhone = undefined,
    amountQ = undefined
  } = patch;
  await dbQuery(
    `UPDATE payment_webhook_events
     SET status = CASE WHEN $2 THEN $3 ELSE status END,
         reason = CASE WHEN $4 THEN $5 ELSE reason END,
         error = CASE WHEN $6 THEN $7 ELSE error END,
         linked_transaction_id = CASE WHEN $8 THEN $9 ELSE linked_transaction_id END,
         customer_id = CASE WHEN $10 THEN $11 ELSE customer_id END,
         customer_phone = CASE WHEN $12 THEN $13 ELSE customer_phone END,
         amount_q = CASE WHEN $14 THEN $15::numeric ELSE amount_q END,
         updated_at = now()
     WHERE id = $1`,
    [
      eventId,
      status !== null, status,
      reason !== null, reason,
      error !== null, error,
      linkedTransactionId !== null, linkedTransactionId,
      customerId !== undefined, customerId ?? null,
      customerPhone !== undefined, customerPhone ?? null,
      amountQ !== undefined && amountQ !== null, amountQ ?? null
    ]
  );
}

export async function processPaymentWebhook({ provider, payload, secretHeader, signatureHeader = "", rawBody = "" }, {award=awardFromExternalEventTrusted}={}) {
  const normalizedProvider = normalizeProvider(provider);
  assertProviderAuthConfigured(normalizedProvider);
  validateProviderSecret(normalizedProvider, secretHeader);
  validateProviderHmac(normalizedProvider, signatureHeader, rawBody);
  // Enable limited ingest-mode access (payment_webhook_events where business_id IS NULL).
  await setWebhookIngest(true);

  const n = normalizePaymentWebhook(normalizedProvider, payload);
  if (!n.providerEventId || n.providerEventId.length < 3) {
    throw badRequest("providerEventId missing in webhook payload");
  }

	let businessId = null;
	if (n.businessSlug) {
	  const business = await BusinessRepo.getPublicBySlug(n.businessSlug);
	  if (business) businessId = business.id;
	}
	if (businessId) {
	  // Ensure RLS context is set before writing tenant-scoped rows.
	  await setCurrentTenant(String(businessId));
	}

	const customerPhone = n.customerPhone ? normalizePhone(n.customerPhone) : null;
	const event = await insertOrGetEvent({
	  provider: normalizedProvider,
	  providerEventId: n.providerEventId,
    eventType: n.eventType,
    businessSlug: n.businessSlug,
    businessId,
    customerId: n.customerId ?? null,
    customerPhone,
    amount_q: n.amount_q,
    currency: n.currency,
    payload: n.raw
  });

  if (!event) throw badRequest("Could not register webhook event");
  if (event.status === "APPLIED" || event.status === "IGNORED") {
    logger.info(webhookLogContext({
      provider: normalizedProvider,
      event,
      businessId,
      businessSlug: n.businessSlug,
      customerPhone,
      customerId: n.customerId ?? null
    }), "Payment webhook duplicate ignored");
    return { ok: true, duplicate: true, eventId: event.id, status: event.status };
  }

  if (n.eventType !== "payment.approved") {
    await setEventStatus(event.id, { status: "IGNORED", reason: "non_approved_event" });
    logger.info(webhookLogContext({
      provider: normalizedProvider,
      event,
      businessId,
      businessSlug: n.businessSlug,
      customerPhone,
      customerId: n.customerId ?? null,
      extra: { reason: "non_approved_event" }
    }), "Payment webhook ignored");
    return { ok: true, ignored: true, eventId: event.id };
  }

  if (n.amount_q === null) {
    // Never apply a payment without a valid amount. A FAILED event is not a
    // duplicate, so a corrected redelivery with the same ID or a manual resolve
    // with the corrected amount can still apply it.
    const msg = "Payment amount must be a non-negative number with at most two decimals";
    await setEventStatus(event.id, { status: "FAILED", reason: INVALID_AMOUNT, error: msg });
    logger.warn(webhookLogContext({
      provider: normalizedProvider,
      event,
      businessId,
      businessSlug: n.businessSlug,
      customerPhone,
      customerId: n.customerId ?? null,
      providerEventId: n.providerEventId,
      extra: { reason: INVALID_AMOUNT }
    }), "Payment webhook rejected invalid amount");
    throw badRequest(msg);
  }

  if (!n.businessSlug) {
    await setEventStatus(event.id, { status: "PENDING_MAPPING", reason: "missing_business_slug", amountQ: n.amount_q });
    logger.warn(webhookLogContext({
      provider: normalizedProvider,
      event,
      businessId,
      customerPhone,
      customerId: n.customerId ?? null,
      providerEventId: n.providerEventId,
      extra: { reason: "missing_business_slug" }
    }), "Payment webhook pending mapping");
    return { ok: true, pending: true, eventId: event.id, reason: "missing_business_slug" };
  }

  if (!n.customerId && !customerPhone) {
    await setEventStatus(event.id, { status: "PENDING_MAPPING", reason: "missing_customer_mapping", amountQ: n.amount_q });
    logger.warn(webhookLogContext({
      provider: normalizedProvider,
      event,
      businessId,
      businessSlug: n.businessSlug,
      providerEventId: n.providerEventId,
      extra: { reason: "missing_customer_mapping" }
    }), "Payment webhook pending mapping");
    return { ok: true, pending: true, eventId: event.id, reason: "missing_customer_mapping" };
  }

  try {
    const out = await award({
      businessSlug: n.businessSlug,
      externalEventId: `${normalizedProvider}:${n.providerEventId}`,
      customerId: n.customerId ?? undefined,
      customerPhone: customerPhone ?? undefined,
      amount_q: n.amount_q,
      expectedCurrency: n.currency,
      meta: { provider: normalizedProvider, payment_event_id: n.providerEventId, currency: n.currency }
    });
    await setEventStatus(event.id, {
      status: "APPLIED",
      linkedTransactionId: out.transactionId,
      customerId: out.customerId ?? n.customerId ?? null,
      customerPhone,
      amountQ: n.amount_q
    });
    logger.info(webhookLogContext({
      provider: normalizedProvider,
      event,
      businessId,
      businessSlug: n.businessSlug,
      customerPhone,
      customerId: out.customerId ?? n.customerId ?? null,
      providerEventId: n.providerEventId,
      extra: { transactionId: out.transactionId }
    }), "Payment webhook applied");
    return { ok: true, applied: true, eventId: event.id, transactionId: out.transactionId };
  } catch (e) {
    const msg = e?.message ?? String(e);
    const reason = /Customer not found/i.test(msg) ? "customer_not_found" : "award_failed";
    const nextStatus = reason === "customer_not_found" ? "PENDING_MAPPING" : "FAILED";
    await setEventStatus(event.id, {
      status: nextStatus,
      reason,
      error: msg,
      customerPhone,
      amountQ: n.amount_q
    });
    const logFn = nextStatus === "PENDING_MAPPING" ? logger.warn.bind(logger) : logger.error.bind(logger);
    logFn(webhookLogContext({
      provider: normalizedProvider,
      event,
      businessId,
      businessSlug: n.businessSlug,
      customerPhone,
      customerId: n.customerId ?? null,
      providerEventId: n.providerEventId,
      extra: { reason, err: msg }
    }), nextStatus === "PENDING_MAPPING" ? "Payment webhook pending mapping after processing error" : "Payment webhook failed");
    if (nextStatus === "PENDING_MAPPING") {
      return { ok: true, pending: true, eventId: event.id, reason };
    }
    throw e;
  }
}

export async function listPaymentWebhookEventsForBusiness({ businessId, status = null, limit = 50 }) {
  const params = [businessId, Math.min(200, Math.max(1, Number(limit || 50)))];
  let statusClause = "";
  if (status) {
    params.push(String(status).toUpperCase());
    statusClause = ` AND status = $3`;
  }
  const { rows } = await dbQuery(
    `SELECT *
     FROM payment_webhook_events
     WHERE business_id = $1${statusClause}
     ORDER BY created_at DESC
     LIMIT $2`,
    params
  );
  return rows;
}

/**
 * Only an approved payment that is waiting for a customer mapping, or one that
 * failed for lack of a valid amount, can be credited by hand. Ignored events
 * (refunds, pending or failed payments), applied events and other failures are
 * not manual-credit candidates.
 */
function assertResolvable(event, amountQ) {
  if (event.event_type !== "payment.approved") {
    throw conflict("Solo se pueden asignar pagos aprobados; este evento no genera puntos.");
  }
  const invalidAmount = event.status === "FAILED" && event.reason === INVALID_AMOUNT;
  if (event.status !== "PENDING_MAPPING" && !invalidAmount) {
    throw conflict(event.status === "APPLIED"
      ? "Este pago ya fue asignado."
      : "Este pago no está pendiente de asignación.");
  }
  if (invalidAmount && amountQ === undefined) {
    throw badRequest("El pago llegó sin un monto válido. Indica el monto corregido para asignarlo.");
  }
  if (!invalidAmount && amountQ !== undefined) {
    throw badRequest("Solo se puede corregir el monto de un pago que llegó con un monto inválido.");
  }
  if (invalidAmount && parsePaymentAmount(amountQ) === null) {
    throw badRequest("El monto corregido debe ser un número no negativo con hasta dos decimales.");
  }
}

export async function resolvePaymentWebhookEventForBusiness({
  businessId,
  eventId,
  customerId,
  customerPhone,
  amountQ = undefined
}, {award=awardFromExternalEventTrusted}={}) {
  const { rows } = await dbQuery(
    `SELECT *
     FROM payment_webhook_events
     WHERE id = $1
       AND business_id = $2
     LIMIT 1`,
    [eventId, businessId]
  );
  const event = rows?.[0];
  if (!event) throw notFound("Payment webhook event not found");
  if (!event.business_slug) throw badRequest("Event missing business slug");
  if (!customerId && !customerPhone) throw badRequest("customerId or customerPhone required");
  assertResolvable(event, amountQ);

  const phone = customerPhone ? normalizePhone(customerPhone) : null;
  const providerEventId = `${event.provider}:${event.provider_event_id}`;
  const amount = amountQ === undefined ? Number(event.amount_q) : parsePaymentAmount(amountQ);

  const out = await award({
    businessSlug: event.business_slug,
    externalEventId: providerEventId,
    customerId: customerId ?? undefined,
    customerPhone: phone ?? undefined,
    amount_q: amount,
    expectedCurrency: event.currency || "GTQ",
    meta: {
      provider: event.provider,
      payment_event_id: event.provider_event_id,
      resolved_manually: true
    }
  });

  await setEventStatus(event.id, {
    status: "APPLIED",
    reason: "resolved_manually",
    error: null,
    linkedTransactionId: out.transactionId,
    customerId: out.customerId ?? customerId ?? null,
    customerPhone: phone ?? event.customer_phone ?? null,
    amountQ: amount
  });

  return { ok: true, eventId: event.id, transactionId: out.transactionId, customerId: out.customerId };
}
