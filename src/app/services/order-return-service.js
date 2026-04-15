import crypto from "node:crypto";

import { setCurrentTenant, withTransaction } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { OrderRepo } from "../repositories/order-repository.js";
import { OrderReturnRepo } from "../repositories/order-return-repository.js";
import { badRequest, conflict, notFound } from "../../utils/http-error.js";

function defaultMakeId() {
  return crypto.randomUUID();
}

function defaultHashPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeValue(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (!isPlainObject(value)) return value;

  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = normalizeValue(value[key]);
    return acc;
  }, {});
}

function normalizeMeta(meta) {
  return normalizeValue(meta && typeof meta === "object" ? meta : {});
}

function buildFingerprintPayload({ externalReturnId, externalOrderId, reason, occurred_at, meta }) {
  return {
    externalReturnId: String(externalReturnId || ""),
    externalOrderId: String(externalOrderId || ""),
    reason: reason == null ? null : String(reason),
    occurred_at: occurred_at ?? null,
    meta: normalizeMeta(meta)
  };
}

function allowNegativeRefundBalance(programJson = {}) {
  return programJson?.balance_policy?.allow_negative_balance_on_refund === true;
}

async function lockOrderReturnRequest(client, businessId, externalReturnId) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [String(businessId), String(externalReturnId)]
  );
}

async function lockOrderReturnOrder(client, businessId, orderId) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [String(businessId), String(orderId)]
  );
}

async function loadOriginalTransaction(client, transactionId) {
  const { rows } = await client.query(
    `SELECT id, business_id, branch_id, customer_id, points, status
     FROM transactions
     WHERE id = $1
     FOR UPDATE`,
    [transactionId]
  );
  return rows[0] ?? null;
}

async function markOriginalTransactionReturned(client, { transactionId, reversalTransactionId = null, reason = null }) {
  await client.query(
    `UPDATE transactions
     SET status = 'REVERSED',
         reversed_transaction_id = $2,
         reversal_reason = $3
     WHERE id = $1`,
    [transactionId, reversalTransactionId, reason]
  );
}

async function updateOrderStatus(client, { orderId, businessId }) {
  await client.query(
    `UPDATE orders
     SET transaction_status = 'REVERSED'
     WHERE id = $1
       AND business_id = $2`,
    [orderId, businessId]
  );
}

function assertTransactionMatchesOrder({ transaction, order, businessId }) {
  if (String(transaction.business_id) !== String(businessId) || String(transaction.business_id) !== String(order.business_id)) {
    throw conflict("Original order return source must match the same business and customer");
  }
  if (String(transaction.customer_id) !== String(order.customer_id)) {
    throw conflict("Original order return source must match the same business and customer");
  }
}

function resolveReturnableStatus(transaction) {
  const status = String(transaction.status || "");
  if (status === "PENDING" || status === "POSTED") return status;
  if (status === "REVERSED") throw conflict("Original transaction already reversed");
  throw conflict(`Original transaction has unexpected status: ${status || "UNKNOWN"}`);
}

function assertSingleBalanceMutation(result, pathLabel) {
  if (Number(result?.rowCount ?? 0) !== 1) {
    throw conflict(`Order return ${pathLabel} requires an existing customer balance row`);
  }
}

async function processOrderReturnWithClient(deps, client, input) {
  const externalReturnId = String(input.externalReturnId || "").trim();
  if (!externalReturnId) throw badRequest("externalReturnId required");

  const externalOrderId = String(input.externalOrderId || "").trim();
  if (!externalOrderId) throw badRequest("externalOrderId required");

  const publicBusiness = await deps.BusinessRepo.getPublicBySlug(String(input.businessSlug || ""));
  if (!publicBusiness) throw notFound("Business not found");

  await deps.setCurrentTenant(String(publicBusiness.id));
  const business = await deps.BusinessRepo.getById(String(publicBusiness.id));
  if (!business) throw notFound("Business not found");

  const meta = normalizeMeta(input.meta);
  const fingerprint = deps.hashPayload(buildFingerprintPayload({
    externalReturnId,
    externalOrderId,
    reason: input.reason ?? null,
    occurred_at: input.occurred_at ?? null,
    meta
  }));

  await lockOrderReturnRequest(client, business.id, externalReturnId);

  const replay = await deps.OrderReturnRepo.findByBusinessAndExternalId(client, business.id, externalReturnId);
  if (replay) {
    if (String(replay.fingerprint || "") !== String(fingerprint || "")) {
      throw conflict("externalReturnId already used for a different payload");
    }
    return {
      ok: true,
      orderReturnId: replay.id,
      orderId: replay.order_id,
      customerId: replay.customer_id,
      outcome: replay.outcome,
      pointsEffect: Number(replay.points_effect || 0),
      reversalTransactionId: replay.reversal_transaction_id ?? null,
      replay: true
    };
  }

  const order = await deps.OrderRepo.findDetailedByBusinessAndExternalId(client, business.id, externalOrderId);
  if (!order) throw notFound("Original order not found");

  await lockOrderReturnOrder(client, business.id, order.id);

  const existingByOrder = await deps.OrderReturnRepo.findByOrderId(client, business.id, order.id);
  if (existingByOrder) throw conflict("Order already returned");

  const originalTransaction = await loadOriginalTransaction(client, order.transaction_id);
  if (!originalTransaction) throw notFound("Original transaction not found");
  assertTransactionMatchesOrder({
    transaction: originalTransaction,
    order,
    businessId: business.id
  });
  const originalStatus = resolveReturnableStatus(originalTransaction);

  const points = Number(originalTransaction.points ?? order.points_awarded ?? 0);
  const pointsEffect = -Math.abs(points);
  let outcome = null;
  let reversalTransactionId = null;

  if (originalStatus === "PENDING") {
    const balanceUpdate = await client.query(
      `UPDATE customer_balances
       SET pending_points = GREATEST(0, pending_points - $2),
           updated_at = now()
       WHERE customer_id = $1`,
      [order.customer_id, Math.abs(points)]
    );
    assertSingleBalanceMutation(balanceUpdate, "pending cancellation");
    await markOriginalTransactionReturned(client, {
      transactionId: originalTransaction.id,
      reversalTransactionId: null,
      reason: input.reason ?? "order_return"
    });
    await updateOrderStatus(client, {
      orderId: order.id,
      businessId: business.id
    });
    outcome = "PENDING_CANCELLED";
  } else {
    const { rows } = await client.query(
      `SELECT points FROM customer_balances WHERE customer_id = $1 FOR UPDATE`,
      [order.customer_id]
    );
    const currentPoints = Number(rows?.[0]?.points ?? 0);
    if (!allowNegativeRefundBalance(business.program_json ?? {}) && (currentPoints + pointsEffect) < 0) {
      throw conflict("Refund requires manual handling because negative balances are disabled");
    }

    reversalTransactionId = deps.makeId();
    await client.query(
      `INSERT INTO transactions
       (id, business_id, branch_id, customer_id, amount_q, visits, items, points, status, source, original_transaction_id, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'POSTED','reversal',$9,$10)`,
      [
        reversalTransactionId,
        originalTransaction.business_id,
        originalTransaction.branch_id ?? null,
        originalTransaction.customer_id,
        0,
        0,
        0,
        pointsEffect,
        originalTransaction.id,
        {
          external_return_id: externalReturnId,
          external_order_id: externalOrderId,
          refund_reason: input.reason ?? "order_return",
          original_status: originalStatus,
          original_points: Math.abs(points)
        }
      ]
    );
    const balanceUpdate = await client.query(
      `UPDATE customer_balances
       SET points = points + $2,
           lifetime_points = GREATEST(0, lifetime_points + LEAST($2, 0)),
           updated_at = now()
       WHERE customer_id = $1`,
      [order.customer_id, pointsEffect]
    );
    assertSingleBalanceMutation(balanceUpdate, "posted reversal");
    await markOriginalTransactionReturned(client, {
      transactionId: originalTransaction.id,
      reversalTransactionId,
      reason: input.reason ?? "order_return"
    });
    await updateOrderStatus(client, {
      orderId: order.id,
      businessId: business.id
    });
    outcome = "POSTED_REVERSED";
  }

  const created = await deps.OrderReturnRepo.create(client, {
    business_id: business.id,
    customer_id: order.customer_id,
    order_id: order.id,
    external_return_id: externalReturnId,
    external_order_id: order.external_order_id,
    reason: input.reason ?? null,
    occurred_at: input.occurred_at ?? null,
    meta,
    fingerprint,
    reversal_transaction_id: reversalTransactionId,
    points_effect: pointsEffect,
    outcome
  });

  return {
    ok: true,
    orderReturnId: created.id,
    orderId: created.order_id,
    customerId: created.customer_id,
    outcome: created.outcome,
    pointsEffect: Number(created.points_effect || 0),
    reversalTransactionId: created.reversal_transaction_id ?? null
  };
}

export async function processOrderReturnWithDeps(deps, input) {
  if (!deps || typeof deps.withTransaction !== "function") {
    throw badRequest("withTransaction dependency required");
  }

  const resolvedDeps = {
    BusinessRepo: deps.BusinessRepo ?? BusinessRepo,
    OrderRepo: deps.OrderRepo ?? OrderRepo,
    OrderReturnRepo: deps.OrderReturnRepo ?? OrderReturnRepo,
    hashPayload: deps.hashPayload ?? defaultHashPayload,
    makeId: deps.makeId ?? defaultMakeId,
    setCurrentTenant: deps.setCurrentTenant ?? setCurrentTenant,
    withTransaction: deps.withTransaction
  };

  return resolvedDeps.withTransaction((client) => processOrderReturnWithClient(resolvedDeps, client, input));
}

export async function processOrderReturn(input) {
  return processOrderReturnWithDeps({
    withTransaction,
    setCurrentTenant,
    BusinessRepo,
    OrderRepo,
    OrderReturnRepo,
    hashPayload: defaultHashPayload,
    makeId: defaultMakeId
  }, input);
}
