import crypto from "node:crypto";
import { dbQuery, withTransaction } from "../database.js";
import { conflict, forbidden, notFound } from "../../utils/http-error.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
import { refreshCustomerDerivedState } from "./customer-derived-state.js";
import { reconcileCustomerGamificationAfterRefund } from "./gamification/reconciliation-service.js";
import { logger } from "../../utils/logger.js";

function id() { return crypto.randomUUID(); }

async function lockRefundRequest(client, businessId, requestId) {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
    [String(businessId), String(requestId)]
  );
}

async function findExistingRefundByRequestId(client, businessId, requestId) {
  const { rows } = await client.query(
    `SELECT reversal.id AS reversal_transaction_id,
            reversal.business_id,
            reversal.customer_id,
            reversal.original_transaction_id,
            reversal.points,
            balances.points AS new_balance,
            balances.pending_points AS new_pending_balance
     FROM transactions reversal
     JOIN customer_balances balances ON balances.customer_id = reversal.customer_id
     WHERE reversal.business_id = $1
       AND reversal.request_id = $2
       AND reversal.source = 'reversal'
     LIMIT 1`,
    [businessId, requestId]
  );
  return rows[0] ?? null;
}

function allowNegativeRefundBalance(programJson = {}) {
  return programJson?.balance_policy?.allow_negative_balance_on_refund === true;
}

async function getPointsExpirationDays({ businessId, client = null }) {
  const q = client ? client.query.bind(client) : dbQuery;
  const { rows } = await q(
    `SELECT COALESCE((program_json->>'points_expiration_days')::int, 0) AS days
     FROM businesses
     WHERE id = $1`,
    [businessId]
  );
  return Math.max(0, Number(rows?.[0]?.days ?? 0));
}

export async function settlePendingPointsForCustomer(customerId, businessId = null) {
  return withTransaction(async (client) => {
    const params = [customerId];
    let where = `customer_id = $1`;
    if (businessId) {
      params.push(businessId);
      where += ` AND business_id = $2`;
    }

    const { rows } = await client.query(
      `SELECT id, points
       FROM transactions
       WHERE ${where}
         AND status = 'PENDING'
         AND available_at IS NOT NULL
         AND available_at <= now()
       FOR UPDATE`,
      params
    );
    if (!rows.length) return { settledCount: 0, settledPoints: 0 };

    const ids = rows.map(r => r.id);
    const settledPoints = rows.reduce((acc, r) => acc + Number(r.points || 0), 0);

    await client.query(
      `UPDATE transactions
       SET status = 'POSTED'
       WHERE id = ANY($1::uuid[])`,
      [ids]
    );

    await client.query(
      `UPDATE customer_balances
       SET points = points + $2,
           pending_points = GREATEST(0, pending_points - $2),
           updated_at = now()
       WHERE customer_id = $1`,
      [customerId, settledPoints]
    );

    return { settledCount: ids.length, settledPoints };
  });
}

export async function settlePendingPointsForBusiness(businessId, limit = 1000) {
  const { rows } = await dbQuery(
    `SELECT DISTINCT customer_id
     FROM transactions
     WHERE business_id = $1
       AND status = 'PENDING'
       AND available_at IS NOT NULL
       AND available_at <= now()
     LIMIT $2`,
    [businessId, limit]
  );

  let totalCustomers = 0;
  let totalSettled = 0;
  let totalPoints = 0;
  for (const r of rows) {
    const out = await settlePendingPointsForCustomer(r.customer_id, businessId);
    if (out.settledCount > 0) {
      totalCustomers += 1;
      totalSettled += out.settledCount;
      totalPoints += out.settledPoints;
    }
  }
  return { totalCustomers, totalSettled, totalPoints };
}

export async function expirePointsForCustomer(customerId, businessId = null) {
  return withTransaction(async (client) => {
    let resolvedBusinessId = businessId;
    if (!resolvedBusinessId) {
      const c = await client.query(
        `SELECT business_id FROM customers WHERE id = $1`,
        [customerId]
      );
      resolvedBusinessId = c.rows?.[0]?.business_id ?? null;
      if (!resolvedBusinessId) return { expiredCount: 0, expiredPoints: 0, deductedPoints: 0 };
    }

    const days = await getPointsExpirationDays({ client, businessId: resolvedBusinessId });
    if (days <= 0) return { expiredCount: 0, expiredPoints: 0, deductedPoints: 0 };

    const { rows } = await client.query(
      `SELECT id, points
       FROM transactions
       WHERE customer_id = $1
         AND business_id = $2
         AND status = 'POSTED'
         AND points > 0
         AND expired_at IS NULL
         AND created_at <= now() - ($3 || ' days')::interval
       FOR UPDATE`,
      [customerId, resolvedBusinessId, String(days)]
    );
    if (!rows.length) return { expiredCount: 0, expiredPoints: 0, deductedPoints: 0 };

    const txIds = rows.map((r) => r.id);
    const expiredPoints = rows.reduce((acc, r) => acc + Number(r.points || 0), 0);

    await client.query(
      `UPDATE transactions
       SET status = 'EXPIRED',
           expired_at = now()
       WHERE id = ANY($1::uuid[])`,
      [txIds]
    );

    const bal = await client.query(
      `SELECT points
       FROM customer_balances
       WHERE customer_id = $1
       FOR UPDATE`,
      [customerId]
    );
    const currentPoints = Number(bal.rows?.[0]?.points ?? 0);
    const deductedPoints = Math.max(0, Math.min(currentPoints, expiredPoints));

    if (deductedPoints > 0) {
      await client.query(
        `UPDATE customer_balances
         SET points = points - $2,
             updated_at = now()
         WHERE customer_id = $1`,
        [customerId, deductedPoints]
      );

      await client.query(
        `INSERT INTO transactions
         (id, business_id, customer_id, amount_q, visits, items, points, status, source, meta)
         VALUES ($1,$2,$3,0,0,0,$4,'POSTED','expire',$5)`,
        [
          id(),
          resolvedBusinessId,
          customerId,
          -deductedPoints,
          {
            expiration_days: days,
            expired_count: txIds.length,
            expired_transaction_ids_sample: txIds.slice(0, 20)
          }
        ]
      );
    }

    return { expiredCount: txIds.length, expiredPoints, deductedPoints };
  });
}

export async function expirePointsForBusiness(businessId, limit = 1000) {
  const days = await getPointsExpirationDays({ businessId });
  if (days <= 0) return { totalCustomers: 0, totalExpired: 0, totalExpiredPoints: 0, totalDeductedPoints: 0 };

  const { rows } = await dbQuery(
    `SELECT DISTINCT customer_id
     FROM transactions
     WHERE business_id = $1
       AND status = 'POSTED'
       AND points > 0
       AND expired_at IS NULL
       AND created_at <= now() - ($2 || ' days')::interval
     LIMIT $3`,
    [businessId, String(days), limit]
  );

  let totalCustomers = 0;
  let totalExpired = 0;
  let totalExpiredPoints = 0;
  let totalDeductedPoints = 0;
  for (const r of rows) {
    const out = await expirePointsForCustomer(r.customer_id, businessId);
    if (out.expiredCount > 0) {
      totalCustomers += 1;
      totalExpired += out.expiredCount;
      totalExpiredPoints += out.expiredPoints;
      totalDeductedPoints += out.deductedPoints;
    }
  }
  return { totalCustomers, totalExpired, totalExpiredPoints, totalDeductedPoints };
}

export async function refundAwardTransaction({ staff, transactionId, requestId, reason = "refund" }) {
  return withTransaction(async (client) => {
    await lockRefundRequest(client, staff.business_id, requestId);
    const replay = await findExistingRefundByRequestId(client, staff.business_id, requestId);
    if (replay) {
      if (replay.original_transaction_id !== transactionId) {
        throw conflict("requestId already used for a different refund");
      }
      await AuditRepo.log({
        id: id(),
        business_id: staff.business_id,
        actor_type: "STAFF",
        actor_id: staff.id,
        action: "award.refund.replay",
        ip: null,
        ua: null,
        meta: withImpersonationMeta({
          transaction_id: transactionId,
          reversal_transaction_id: replay.reversal_transaction_id,
          request_id: requestId
        }, staff)
      }).catch(() => {});
      return {
        ok: true,
        transactionId,
        reversalTransactionId: replay.reversal_transaction_id,
        customerId: replay.customer_id,
        pointsEffect: Number(replay.points ?? 0),
        gamificationReconciliation: { replay: true },
        newBalance: Number(replay.new_balance ?? 0),
        newPendingBalance: Number(replay.new_pending_balance ?? 0),
        replay: true
      };
    }

    const { rows } = await client.query(
      `SELECT *
       FROM transactions
       WHERE id = $1
       FOR UPDATE`,
      [transactionId]
    );
    const tx = rows[0];
    if (!tx) throw notFound("Transaction not found");
    if (tx.business_id !== staff.business_id) throw forbidden("Transaction belongs to different business");
    if (tx.source === "reversal") throw conflict("Cannot reverse a reversal transaction");
    if (tx.status === "REVERSED") throw conflict("Transaction already reversed");
    const businessResult = await client.query(
      `SELECT program_json FROM businesses WHERE id = $1`,
      [tx.business_id]
    );
    const allowNegative = allowNegativeRefundBalance(businessResult.rows?.[0]?.program_json ?? {});

    const points = Number(tx.points || 0);
    let pointsEffect = 0;

    if (tx.status === "PENDING") {
      if (points > 0) {
        await client.query(
          `UPDATE customer_balances
           SET pending_points = GREATEST(0, pending_points - $2),
               updated_at = now()
           WHERE customer_id = $1`,
          [tx.customer_id, points]
        );
      }
    } else {
      pointsEffect = -points;
      const bal = await client.query(
        `SELECT points FROM customer_balances WHERE customer_id = $1 FOR UPDATE`,
        [tx.customer_id]
      );
      const currentPoints = Number(bal.rows?.[0]?.points ?? 0);
      if (!allowNegative && (currentPoints + pointsEffect) < 0) {
        throw conflict("Refund would create negative balance");
      }
      await client.query(
        `UPDATE customer_balances
         SET points = points + $2,
             lifetime_points = GREATEST(0, lifetime_points + LEAST($2, 0)),
             updated_at = now()
         WHERE customer_id = $1`,
        [tx.customer_id, pointsEffect]
      );
    }

    const reversalId = id();
    await client.query(
      `INSERT INTO transactions
       (id, business_id, branch_id, customer_id, staff_user_id, amount_q, visits, items, points, status, source, original_transaction_id, request_id, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'POSTED','reversal',$10,$11,$12)`,
      [
        reversalId,
        tx.business_id,
        tx.branch_id,
        tx.customer_id,
        staff.id,
        0,
        0,
        0,
        pointsEffect,
        tx.id,
        requestId,
        {
          refund_reason: reason,
          original_status: tx.status,
          original_points: points,
          refunded_by: staff.id,
          request_id: requestId
        }
      ]
    );

    await client.query(
      `UPDATE transactions
       SET status = 'REVERSED',
           reversed_transaction_id = $2,
           reversal_reason = $3
       WHERE id = $1`,
      [tx.id, reversalId, reason]
    );

    await refreshCustomerDerivedState(client, tx.customer_id);
    const gamificationReconciliation = await reconcileCustomerGamificationAfterRefund(client, {
      customerId: tx.customer_id,
      staff,
      reason,
      referenceAt: new Date(),
      refundedTransactionId: tx.id
    });

    const newBal = await client.query(
      `SELECT points, pending_points FROM customer_balances WHERE customer_id = $1`,
      [tx.customer_id]
    );
    const newBalance = Number(newBal.rows?.[0]?.points ?? 0);
    const newPendingBalance = Number(newBal.rows?.[0]?.pending_points ?? 0);
    if (!allowNegative && newBalance < 0) {
      throw conflict("Refund policy forbids negative balances");
    }

    await AuditRepo.log({
      id: id(),
      business_id: tx.business_id,
      actor_type: "STAFF",
      actor_id: staff.id,
      action: "award.refund",
      ip: null,
      ua: null,
      meta: withImpersonationMeta({
        transaction_id: tx.id,
        reversal_transaction_id: reversalId,
        request_id: requestId,
        reason,
        points_effect: pointsEffect,
        allow_negative_refund_balance: allowNegative,
        gamification_reconciliation: gamificationReconciliation
      }, staff)
    }).catch(() => { });

    logger.info({
      transactionId: tx.id,
      reversalTransactionId: reversalId,
      customerId: tx.customer_id,
      businessId: tx.business_id,
      staffId: staff.id,
      pointsEffect,
      requestId,
      allowNegative,
      achievementsRevoked: Number(gamificationReconciliation?.achievementsRevoked ?? 0),
      challengesRevoked: Number(gamificationReconciliation?.challengesRevoked ?? 0)
    }, "Staff refund completed");

    return {
      ok: true,
      transactionId: tx.id,
      reversalTransactionId: reversalId,
      customerId: tx.customer_id,
      pointsEffect,
      gamificationReconciliation,
      newBalance,
      newPendingBalance
    };
  });
}
