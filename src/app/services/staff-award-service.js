import crypto from "node:crypto";

import { BusinessRepo } from "../repositories/business-repository.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { SecurityEventRepo } from "../repositories/security-event-repository.js";
import { verifyQrToken } from "../../utils/qr-token.js";
import { computePoints } from "./points-service.js";
import { enqueueWebhookEvent } from "./webhook-service.js";
import { planLimits } from "../../utils/plan.js";
import { withTransaction } from "../database.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/http-error.js";
import { settlePendingPointsForCustomer, expirePointsForCustomer } from "./loyalty-ops-service.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/index.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
import { runPostAwardHooks } from "./staff-award-hooks.js";

function id() {
  return crypto.randomUUID();
}

function logAwardGuardAction({ businessId, staff, action, meta }) {
  return AuditRepo.log({
    id: id(),
    business_id: businessId,
    actor_type: "STAFF",
    actor_id: staff.id,
    action,
    ip: null,
    ua: null,
    meta: withImpersonationMeta(meta, staff)
  }).catch(() => {});
}

async function settleCustomerPoints(customerId, businessId) {
  if (config.NODE_ENV === "test") return;
  await settlePendingPointsForCustomer(customerId, businessId).catch((err) => {
    logger.warn({ err: err?.message, customerId, businessId }, "settlePendingPointsForCustomer failed");
  });
  await expirePointsForCustomer(customerId, businessId).catch((err) => {
    logger.warn({ err: err?.message, customerId, businessId }, "expirePointsForCustomer failed");
  });
}

async function enforceAwardGuards({ businessId, customerId, staff, guardCfg, amountQ, visits, items, points }) {
  const maxAmountQ = Number(guardCfg.max_amount_q ?? 0);
  const maxVisits = Number(guardCfg.max_visits ?? 0);
  const maxItems = Number(guardCfg.max_items ?? 0);
  const maxPointsPerTx = Number(guardCfg.max_points_per_tx ?? 0);

  if (maxAmountQ > 0 && amountQ > maxAmountQ) {
    await logAwardGuardAction({
      businessId,
      staff,
      action: "award.denied.max_amount_q",
      meta: { amount_q: amountQ, max_amount_q: maxAmountQ, customer_id: customerId }
    });
    throw forbidden(`Amount exceeds max allowed (Q${maxAmountQ})`);
  }

  if (maxVisits > 0 && visits > maxVisits) {
    await logAwardGuardAction({
      businessId,
      staff,
      action: "award.denied.max_visits",
      meta: { visits, max_visits: maxVisits, customer_id: customerId }
    });
    throw forbidden(`Visits exceed max allowed (${maxVisits})`);
  }

  if (maxItems > 0 && items > maxItems) {
    await logAwardGuardAction({
      businessId,
      staff,
      action: "award.denied.max_items",
      meta: { items, max_items: maxItems, customer_id: customerId }
    });
    throw forbidden(`Items exceed max allowed (${maxItems})`);
  }

  if (maxPointsPerTx > 0 && points > maxPointsPerTx) {
    await logAwardGuardAction({
      businessId,
      staff,
      action: "award.denied.max_points_per_tx",
      meta: { points, max_points_per_tx: maxPointsPerTx, customer_id: customerId }
    });
    throw forbidden(`Points exceed max allowed (${maxPointsPerTx})`);
  }
}

const defaultDeps = {
  verifyQrToken,
  BusinessRepo,
  computePoints,
  planLimits,
  withTransaction,
  enqueueWebhookEvent,
  loadTierService: () => import("./tier-service.js"),
  loadGamificationService: () => import("./gamification-service.js"),
  loadReferralService: () => import("./referral-service.js")
};

export async function awardPointsWithDeps(
  deps,
  { staff, customerQrToken, amount_q = 0, visits = 0, items = 0, source = "online", meta = {}, txId = null }
) {
  const typedDeps = deps;
  const normalizedVisits = Number.isFinite(Number(visits)) ? Math.max(0, Math.floor(Number(visits))) : 0;
  const normalizedItems = Number.isFinite(Number(items)) ? Math.max(0, Math.floor(Number(items))) : 0;
  const normalizedAmountQ = Number(amount_q ?? 0);

  let decoded;
  try {
    decoded = await typedDeps.verifyQrToken(customerQrToken);
  } catch (e) {
    throw badRequest(e?.message ?? "Invalid QR token");
  }

  const { bid, cid, jti, exp } = decoded;
  if (bid !== staff.business_id) throw forbidden("QR token is for a different business");

  const business = await typedDeps.BusinessRepo.getById(bid);
  if (!business) throw notFound("Business not found");

  await settleCustomerPoints(cid, bid);

  const limits = typedDeps.planLimits(business.plan);
  const activeCount = await typedDeps.BusinessRepo.activeCustomerCount(bid);
  if (activeCount > limits.activeCustomers) throw forbidden("Plan limit: active customers exceeded");

  const points = typedDeps.computePoints(business, { amount_q, visits, items });
  const guardCfg = business.program_json?.award_guard ?? {};

  await enforceAwardGuards({
    businessId: bid,
    customerId: cid,
    staff,
    guardCfg,
    amountQ: normalizedAmountQ,
    visits: normalizedVisits,
    items: normalizedItems,
    points
  });

  const suspiciousReasons = [];
  const suspiciousPointsThreshold = Number(guardCfg.suspicious_points_threshold ?? 0);
  const suspiciousAmountThreshold = Number(guardCfg.suspicious_amount_q_threshold ?? 0);
  if (suspiciousPointsThreshold > 0 && points >= suspiciousPointsThreshold) suspiciousReasons.push("points_threshold");
  if (suspiciousAmountThreshold > 0 && normalizedAmountQ >= suspiciousAmountThreshold) suspiciousReasons.push("amount_threshold");

  const metaForInsert = suspiciousReasons.length
    ? {
        ...(meta ?? {}),
        guard: {
          suspicious: true,
          reasons: suspiciousReasons,
          points,
          amount_q: normalizedAmountQ,
          flagged_at: new Date().toISOString()
        }
      }
    : (meta ?? {});

  const holdDays = Math.max(0, Math.floor(Number(business.program_json?.pending_points_hold_days ?? 0)));
  const awardStatus = holdDays > 0 ? "PENDING" : "POSTED";
  const availableAt = holdDays > 0 ? new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000) : null;
  const transactionId = txId ?? id();

  const result = await typedDeps.withTransaction(async (client) => {
    const existingTx = await client.query(
      `SELECT id, business_id, customer_id, points
       FROM transactions
       WHERE id=$1`,
      [transactionId]
    );

    if (existingTx.rows.length) {
      const t = existingTx.rows[0];
      if (t.business_id !== bid || t.customer_id !== cid) throw conflict("txId already used for a different transaction");
      const bal = await client.query(`SELECT points FROM customer_balances WHERE customer_id=$1`, [cid]);
      return { pointsAwarded: t.points, newBalance: bal.rows?.[0]?.points, customerId: cid, transactionId };
    }

    const cust = await client.query(
      `SELECT id FROM customers WHERE id=$1 AND business_id=$2 AND deleted_at IS NULL`,
      [cid, bid]
    );
    if (!cust.rows.length) throw notFound("Customer not found");

    const insQr = await client.query(
      `INSERT INTO qr_tokens (jti, business_id, customer_id, expires_at)
       VALUES ($1,$2,$3,to_timestamp($4))
       ON CONFLICT (jti) DO NOTHING
       RETURNING jti`,
      [jti, bid, cid, exp]
    );
    if (insQr.rowCount !== 1) {
      await SecurityEventRepo.log({
        event_type: "qr_replay_blocked",
        severity: "HIGH",
        route: "/api/staff/award",
        method: "POST",
        business_id: bid,
        actor_type: "STAFF",
        actor_id: staff.id,
        meta: withImpersonationMeta({ customer_id: cid, jti }, staff)
      }).catch(() => {});
      throw conflict("QR token already used (replay protection)");
    }

    await client.query(
      `INSERT INTO transactions (id, business_id, branch_id, customer_id, staff_user_id, amount_q, visits, items, points, status, available_at, source, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        transactionId,
        bid,
        staff.branch_id ?? null,
        cid,
        staff.id,
        normalizedAmountQ,
        normalizedVisits,
        normalizedItems,
        points,
        awardStatus,
        availableAt,
        source,
        metaForInsert
      ]
    );

    const balUpd = await client.query(
      `UPDATE customer_balances
       SET points = points + CASE WHEN $3 = 'POSTED' THEN $2 ELSE 0 END,
           pending_points = pending_points + CASE WHEN $3 = 'PENDING' THEN $2 ELSE 0 END,
           lifetime_points = lifetime_points + CASE WHEN $3 = 'POSTED' THEN GREATEST($2,0) ELSE 0 END,
           updated_at=now()
       WHERE customer_id=$1
       RETURNING points, pending_points`,
      [cid, points, awardStatus]
    );
    if (balUpd.rowCount !== 1) throw notFound("Customer balance not found");

    await client.query(`UPDATE customers SET last_visit_at=now() WHERE id=$1`, [cid]);

    return {
      pointsAwarded: points,
      newBalance: balUpd.rows[0].points,
      newPendingBalance: balUpd.rows[0].pending_points,
      customerId: cid,
      transactionId,
      status: awardStatus,
      availableAt
    };
  });

  typedDeps.enqueueWebhookEvent(bid, "points.awarded", {
    transaction_id: result.transactionId,
    customer_id: cid,
    points: result.pointsAwarded,
    amount_q: normalizedAmountQ
  }).catch(() => {});

  await AuditRepo.log({
    id: id(),
    business_id: bid,
    actor_type: "STAFF",
    actor_id: staff.id,
    action: suspiciousReasons.length ? "award.suspicious" : "award.success",
    ip: null,
    ua: null,
    meta: withImpersonationMeta({
      transaction_id: result.transactionId,
      customer_id: cid,
      points: result.pointsAwarded,
      amount_q: normalizedAmountQ,
      suspicious_reasons: suspiciousReasons
    }, staff)
  }).catch(() => {});

  void runPostAwardHooks({
    deps: typedDeps,
    customerId: cid,
    businessId: bid,
    amountQ: normalizedAmountQ,
    visits: normalizedVisits,
    items: normalizedItems
  });

  return result;
}

export async function awardPoints(args) {
  return awardPointsWithDeps(defaultDeps, args);
}
