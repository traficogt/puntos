import crypto from "node:crypto";

import { setCurrentTenant, withTransaction } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { OrderRepo } from "../repositories/order-repository.js";
import { computePoints } from "./points-service.js";
import { normalizePhone } from "../../utils/phone.js";
import { badRequest, conflict, notFound } from "../../utils/http-error.js";

const PROCESSABLE_STATUSES = new Set(["paid", "completed"]);

function id() {
  return crypto.randomUUID();
}

function defaultHashPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (!isPlainObject(value)) return value;

  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = normalizeValue(value[key]);
    return acc;
  }, {});
}

function normalizeLineItems(lineItemsJson) {
  const normalizedItems = Array.isArray(lineItemsJson) ? lineItemsJson.map((item) => normalizeValue(item)) : [];
  return normalizedItems
    .map((item, index) => ({
      item,
      sortKey: JSON.stringify(item),
      index
    }))
    .sort((left, right) => {
      if (left.sortKey < right.sortKey) return -1;
      if (left.sortKey > right.sortKey) return 1;
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

function normalizeMeta(meta) {
  return normalizeValue(meta && typeof meta === "object" ? meta : {});
}

async function resolveCustomer(deps, businessId, customerId, customerPhone) {
  if (customerId) {
    const customer = await deps.CustomerRepo.getById(customerId);
    if (customer && String(customer.business_id) === String(businessId)) return customer;
  }

  const normalizedPhone = customerPhone ? normalizePhone(customerPhone) : null;
  if (normalizedPhone) {
    const customer = await deps.CustomerRepo.getByBusinessAndPhone(businessId, normalizedPhone);
    if (customer) return customer;
  }

  throw notFound("Customer not found for this business");
}

function buildFingerprintPayload({ customerId, externalOrderId, status, amount_q, subtotal_q, discount_q, tax_q, currency, occurred_at, line_items_json, meta }) {
  return {
    customerId: String(customerId || ""),
    externalOrderId: String(externalOrderId || ""),
    status: String(status || ""),
    amount_q: Number(amount_q || 0),
    subtotal_q: subtotal_q === null ? null : Number(subtotal_q || 0),
    discount_q: discount_q === null ? null : Number(discount_q || 0),
    tax_q: tax_q === null ? null : Number(tax_q || 0),
    currency: String(currency || "GTQ").toUpperCase(),
    occurred_at: occurred_at ?? null,
    line_items_json: Array.isArray(line_items_json) ? line_items_json : [],
    meta: meta && typeof meta === "object" ? meta : {}
  };
}

async function findExistingOrder(deps, client, businessId, externalOrderId) {
  return deps.OrderRepo.findByBusinessAndExternalId(client, businessId, externalOrderId);
}

async function createOrder(deps, client, input) {
  return deps.OrderRepo.create(client, input);
}

async function lockOrderRequest(client, businessId, externalOrderId) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [String(businessId), String(externalOrderId)]
  );
}

async function processOrderWithClient(deps, client, input) {
  const externalOrderId = String(input.externalOrderId || "").trim();
  if (!externalOrderId) throw badRequest("externalOrderId required");

  const status = normalizeStatus(input.status);
  if (!PROCESSABLE_STATUSES.has(status)) throw badRequest("Unsupported order status");

  const lineItemsJson = normalizeLineItems(input.line_items_json);
  const meta = normalizeMeta(input.meta);

  const publicBusiness = await deps.BusinessRepo.getPublicBySlug(String(input.businessSlug || ""));
  if (!publicBusiness) throw notFound("Business not found");

  await deps.setCurrentTenant(String(publicBusiness.id));
  const business = await deps.BusinessRepo.getById(String(publicBusiness.id));
  if (!business) throw notFound("Business not found");

  await lockOrderRequest(client, business.id, externalOrderId);
  const existing = await findExistingOrder(deps, client, business.id, externalOrderId);
  const holdDays = Math.max(0, Math.floor(Number(business.program_json?.pending_points_hold_days ?? 0)));
  const transactionStatus = holdDays > 0 ? "PENDING" : "POSTED";
  const availableAt = holdDays > 0 ? new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000) : null;

  if (existing && input.customerId && String(existing.customer_id) === String(input.customerId)) {
    const earlyPayload = buildFingerprintPayload({
      customerId: input.customerId,
      externalOrderId,
      status,
      amount_q: input.amount_q,
      subtotal_q: input.subtotal_q,
      discount_q: input.discount_q,
      tax_q: input.tax_q,
      currency: input.currency,
      occurred_at: input.occurred_at,
      line_items_json: lineItemsJson,
      meta
    });
    const earlyFingerprint = deps.hashPayload(earlyPayload);
    if (String(existing.fingerprint || "") !== String(earlyFingerprint || "")) {
      throw conflict("externalOrderId already used for a different payload");
    }
    return {
      ok: true,
      orderId: existing.id,
      transactionId: existing.transaction_id,
      customerId: existing.customer_id,
      pointsAwarded: Number(existing.points_awarded || 0),
      status: existing.transaction_status,
      replay: true
    };
  }

  const customer = await resolveCustomer(deps, business.id, input.customerId, input.customerPhone);

  const payload = buildFingerprintPayload({
    customerId: customer.id,
    externalOrderId,
    status,
    amount_q: input.amount_q,
    subtotal_q: input.subtotal_q,
    discount_q: input.discount_q,
    tax_q: input.tax_q,
    currency: input.currency,
    occurred_at: input.occurred_at,
    line_items_json: lineItemsJson,
    meta
  });
  const fingerprint = deps.hashPayload(payload);

  if (existing) {
    if (String(existing.customer_id) !== String(customer.id) || String(existing.fingerprint || "") !== String(fingerprint || "")) {
      throw conflict("externalOrderId already used for a different payload");
    }
    return {
      ok: true,
      orderId: existing.id,
      transactionId: existing.transaction_id,
      customerId: existing.customer_id,
      pointsAwarded: Number(existing.points_awarded || 0),
      status: existing.transaction_status,
      replay: true
    };
  }

  const amountQ = Number(input.amount_q || 0);
  const subtotalQ = normalizeNumber(input.subtotal_q);
  const discountQ = normalizeNumber(input.discount_q);
  const taxQ = normalizeNumber(input.tax_q);
  const currency = String(input.currency || "GTQ").toUpperCase();
  const pointsAwarded = Number(deps.computePoints(business, { amount_q: amountQ }) || 0);
  const transactionId = id();

  await client.query(
    `INSERT INTO transactions
     (id, business_id, customer_id, amount_q, points, status, available_at, source, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'order',$8)`,
    [
      transactionId,
      business.id,
      customer.id,
      amountQ,
      pointsAwarded,
      transactionStatus,
      availableAt,
      {
        external_order_id: externalOrderId,
        order_fingerprint: fingerprint
      }
    ]
  );

  await client.query(
    `UPDATE customer_balances
     SET points = points + CASE WHEN $3 = 'POSTED' THEN $2 ELSE 0 END,
         pending_points = pending_points + CASE WHEN $3 = 'PENDING' THEN $2 ELSE 0 END,
         lifetime_points = lifetime_points + CASE WHEN $3 = 'POSTED' THEN GREATEST($2, 0) ELSE 0 END,
         updated_at = now()
     WHERE customer_id = $1`,
    [customer.id, pointsAwarded, transactionStatus]
  );

  const order = await createOrder(deps, client, {
    business_id: business.id,
    customer_id: customer.id,
    external_order_id: externalOrderId,
    status,
    amount_q: amountQ,
    subtotal_q: subtotalQ,
    discount_q: discountQ,
    tax_q: taxQ,
    currency,
    occurred_at: input.occurred_at ?? null,
    source: input.source ?? "api",
    line_items_json: lineItemsJson,
    meta,
    fingerprint,
    transaction_id: transactionId,
    points_awarded: pointsAwarded,
    transaction_status: transactionStatus
  });

  return {
    ok: true,
    orderId: order.id,
    transactionId,
    customerId: customer.id,
    pointsAwarded,
    status: transactionStatus
  };
}

export async function processOrderWithDeps(deps, input) {
  if (!deps || typeof deps.withTransaction !== "function") {
    throw badRequest("withTransaction dependency required");
  }
  const resolvedDeps = {
    BusinessRepo: deps.BusinessRepo ?? BusinessRepo,
    CustomerRepo: deps.CustomerRepo ?? CustomerRepo,
    OrderRepo: deps.OrderRepo ?? OrderRepo,
    computePoints: deps.computePoints ?? computePoints,
    hashPayload: deps.hashPayload ?? defaultHashPayload,
    withTransaction: deps.withTransaction,
    setCurrentTenant: deps.setCurrentTenant ?? setCurrentTenant
  };

  return resolvedDeps.withTransaction((client) => processOrderWithClient(resolvedDeps, client, input));
}

export async function processOrder(input) {
  return processOrderWithDeps({
    withTransaction,
    BusinessRepo,
    CustomerRepo,
    OrderRepo,
    computePoints,
    hashPayload: defaultHashPayload,
    setCurrentTenant
  }, input);
}
