import crypto from "node:crypto";

import { withTransaction } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { OrderRepo } from "../repositories/order-repository.js";
import { computePoints } from "./points-service.js";
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

async function resolveCustomer(deps, businessId, customerId, customerPhone) {
  if (customerId) {
    const customer = await deps.CustomerRepo.getById(customerId);
    if (customer && String(customer.business_id) === String(businessId)) return customer;
    if (customer) throw notFound("Customer not found for this business");
  }

  if (customerPhone) {
    const customer = await deps.CustomerRepo.getByBusinessAndPhone(businessId, customerPhone);
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
    currency: String(currency || "GTQ"),
    occurred_at: occurred_at ?? null,
    line_items_json: Array.isArray(line_items_json) ? line_items_json : [],
    meta: meta && typeof meta === "object" ? meta : {}
  };
}

async function findExistingOrder(deps, client, businessId, externalOrderId) {
  if (deps.OrderRepo?.findByBusinessAndExternalId) {
    return deps.OrderRepo.findByBusinessAndExternalId(client, businessId, externalOrderId);
  }

  const { rows } = await client.query(
    `SELECT id, business_id, customer_id, external_order_id, fingerprint, transaction_id, points_awarded, transaction_status
     FROM orders
     WHERE business_id = $1 AND external_order_id = $2
     LIMIT 1`,
    [businessId, externalOrderId]
  );
  return rows[0] ?? null;
}

async function createOrder(deps, client, input) {
  if (deps.OrderRepo?.create) {
    return deps.OrderRepo.create(client, input);
  }

  const idValue = input.id ?? id();
  const { rows } = await client.query(
    `INSERT INTO orders
     (id, business_id, customer_id, external_order_id, status, amount_q, subtotal_q, discount_q, tax_q, currency, occurred_at, source, line_items_json, meta, fingerprint, transaction_id, points_awarded, transaction_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      idValue,
      input.business_id,
      input.customer_id,
      input.external_order_id,
      input.status,
      input.amount_q,
      input.subtotal_q,
      input.discount_q,
      input.tax_q,
      input.currency,
      input.occurred_at,
      input.source ?? "api",
      input.line_items_json ?? [],
      input.meta ?? {},
      input.fingerprint,
      input.transaction_id ?? null,
      input.points_awarded ?? 0,
      input.transaction_status ?? null
    ]
  );
  return rows[0];
}

async function processOrderWithClient(deps, client, input) {
  const externalOrderId = String(input.externalOrderId || "").trim();
  if (!externalOrderId) throw badRequest("externalOrderId required");

  const status = normalizeStatus(input.status);
  if (!PROCESSABLE_STATUSES.has(status)) throw badRequest("Unsupported order status");

  const publicBusiness = await deps.BusinessRepo.getPublicBySlug(String(input.businessSlug || ""));
  if (!publicBusiness) throw notFound("Business not found");

  const business = await deps.BusinessRepo.getById(String(publicBusiness.id));
  if (!business) throw notFound("Business not found");

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
    line_items_json: input.line_items_json,
    meta: input.meta
  });
  const fingerprint = deps.hashPayload(payload);

  const existing = await findExistingOrder(deps, client, business.id, externalOrderId);
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
     (id, business_id, customer_id, amount_q, points, status, source, meta)
     VALUES ($1,$2,$3,$4,$5,'POSTED','order',$6)`,
    [
      transactionId,
      business.id,
      customer.id,
      amountQ,
      pointsAwarded,
      {
        external_order_id: externalOrderId,
        order_fingerprint: fingerprint
      }
    ]
  );

  await client.query(
    `UPDATE customer_balances
     SET points = points + $2,
         lifetime_points = lifetime_points + GREATEST($2, 0),
         updated_at = now()
     WHERE customer_id = $1`,
    [customer.id, pointsAwarded]
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
    line_items_json: Array.isArray(input.line_items_json) ? input.line_items_json : [],
    meta: input.meta && typeof input.meta === "object" ? input.meta : {},
    fingerprint,
    transaction_id: transactionId,
    points_awarded: pointsAwarded,
    transaction_status: "POSTED"
  });

  return {
    ok: true,
    orderId: order.id,
    transactionId,
    customerId: customer.id,
    pointsAwarded,
    status: "POSTED"
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
    withTransaction: deps.withTransaction
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
    hashPayload: defaultHashPayload
  }, input);
}
