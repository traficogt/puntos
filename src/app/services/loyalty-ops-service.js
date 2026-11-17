import {assertCheckoutCorrectionAllowed} from './pos-checkout-guard.js';
import crypto from "node:crypto";
import { afterCommit, dbQuery, withTransaction } from "../database.js";
import { conflict, forbidden, notFound } from "../../utils/http-error.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
import { refreshCustomerDerivedState } from "./customer-derived-state.js";
import { reconcileCustomerGamificationAfterRefund } from "./gamification/reconciliation-service.js";
import { runPostAwardHooks } from "./staff-award-hooks.js";
import { logger } from "../../utils/logger.js";

function id() { return crypto.randomUUID(); }

// Earned points still in the available balance and subject to expiry. Refund
// reversals of redemptions only restore earlier credits, so they never count
// as new credits; reversed or expired rows are no longer live.
const LIVE_EARNED_CREDIT = `t.status = 'POSTED'
  AND t.points > 0
  AND t.expired_at IS NULL
  AND t.source <> 'reversal'
  AND t.reversed_transaction_id IS NULL`;

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

const settlementHookDeps = {
  loadTierService: () => import("./tier-service.js"),
  loadGamificationService: () => import("./gamification-service.js"),
  loadReferralService: () => import("./referral-service.js")
};

// Staff awards defer their post-award checks while points are pending: the
// hooks only act on POSTED sources. Integration awards (order, external) never
// run them, settled or not.
const STAFF_AWARD_SOURCES = new Set(["online", "offline"]);

/**
 * Runs the staff post-award checks for awards that a committed settlement made
 * available. Each row moves PENDING -> POSTED once, so each runs once.
 * @param {{ customerId: string, settled: Array<{ id: string, business_id: string, points: number|string, amount_q: number|string, visits: number|string, items: number|string, source: string }>, deps?: Record<string, any> }} args
 */
export async function runSettledAwardHooks({ customerId, settled, deps = settlementHookDeps }) {
  for (const tx of settled) {
    if (!STAFF_AWARD_SOURCES.has(String(tx.source))) continue;
    await runPostAwardHooks({
      deps,
      customerId,
      businessId: tx.business_id,
      sourceTransactionId: tx.id,
      pointsAwarded: Number(tx.points || 0),
      amountQ: Number(tx.amount_q || 0),
      visits: Number(tx.visits || 0),
      items: Number(tx.items || 0)
    });
  }
}

export async function settlePendingPointsForCustomer(customerId, businessId = null, transaction = withTransaction) {
  return transaction(async (client) => {
    const params = [customerId];
    let where = `customer_id = $1`;
    if (businessId) {
      params.push(businessId);
      where += ` AND business_id = $2`;
    }

    const { rows } = await client.query(
      `SELECT id, business_id, points, amount_q, visits, items, source
       FROM transactions
       WHERE ${where}
         AND status = 'PENDING'
         AND available_at IS NOT NULL
         AND available_at <= now()
       FOR UPDATE`,
      params
    );
    if (!rows.length) return { settledCount: 0, settledPoints: 0, settledTransactionIds: [] };

    const ids = rows.map(r => r.id);
    const settledPoints = rows.reduce((acc, r) => acc + Number(r.points || 0), 0);
    const earnedPoints = rows.reduce((acc, r) => acc + Math.max(0, Number(r.points || 0)), 0);

    await client.query(
      `UPDATE transactions
       SET status = 'POSTED'
       WHERE id = ANY($1::uuid[])`,
      [ids]
    );

    // Settled points become earned now: an immediately posted award adds the
    // same amount to lifetime_points when it is written.
    await client.query(
      `UPDATE customer_balances
       SET points = points + $2,
           pending_points = GREATEST(0, pending_points - $2),
           lifetime_points = lifetime_points + $3,
           updated_at = now()
       WHERE customer_id = $1`,
      [customerId, settledPoints, earnedPoints]
    );

    // Gamification locks these rows, so its checks must wait for this commit
    // (or the caller's, when settlement joins an outer transaction).
    afterCommit(() => runSettledAwardHooks({ customerId, settled: rows }));

    return { settledCount: ids.length, settledPoints, settledTransactionIds: ids };
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

export async function expirePointsForCustomer(customerId, businessId = null, transaction = withTransaction) {
  return transaction(async (client) => {
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

    // Lock order matches refunds and settlement: ledger rows, then balance.
    const { rows } = await client.query(
      `SELECT t.id, t.points
       FROM transactions t
       WHERE t.customer_id = $1
         AND t.business_id = $2
         AND ${LIVE_EARNED_CREDIT}
         AND t.created_at <= now() - ($3 || ' days')::interval
       ORDER BY t.created_at ASC, t.id ASC
       FOR UPDATE`,
      [customerId, resolvedBusinessId, String(days)]
    );
    if (!rows.length) return { expiredCount: 0, expiredPoints: 0, deductedPoints: 0 };

    const txIds = rows.map((r) => r.id);
    const expiredPoints = rows.reduce((acc, r) => acc + Number(r.points || 0), 0);

    const bal = await client.query(
      `SELECT points
       FROM customer_balances
       WHERE customer_id = $1
       FOR UPDATE`,
      [customerId]
    );
    const currentPoints = Number(bal.rows?.[0]?.points ?? 0);

    // FIFO: debits (redemptions, refunds, earlier expiries, negative
    // adjustments) consumed the oldest credits first, so the available balance
    // is made of the newest credits still in it. Earned credits newer than the
    // cutoff are protected; only the remainder can still belong to the old
    // credits. Read after the balance lock: concurrent ledger writers update
    // this balance row, so its value and these rows describe the same moment.
    const recent = await client.query(
      `SELECT COALESCE(SUM(t.points), 0)::bigint AS points
       FROM transactions t
       WHERE t.customer_id = $1
         AND t.business_id = $2
         AND ${LIVE_EARNED_CREDIT}
         AND t.created_at > now() - ($3 || ' days')::interval`,
      [customerId, resolvedBusinessId, String(days)]
    );
    const protectedPoints = Number(recent.rows?.[0]?.points ?? 0);
    const deductedPoints = Math.max(0, Math.min(expiredPoints, currentPoints - protectedPoints));

    // Every old credit is now either consumed or expired. Marking all of them
    // keeps their original effect in the ledger (the 'expire' row carries the
    // deduction) and ends their refund window, as for POS refunds and returns.
    await client.query(
      `UPDATE transactions
       SET status = 'EXPIRED',
           expired_at = now()
       WHERE id = ANY($1::uuid[])`,
      [txIds]
    );

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
            expired_transaction_ids_sample: txIds.slice(0, 20),
            method: "fifo",
            eligible_points: expiredPoints,
            protected_recent_points: protectedPoints,
            available_before: currentPoints
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

  // Same rows that expirePointsForCustomer marks, so processed customers leave the batch.
  const { rows } = await dbQuery(
    `SELECT DISTINCT t.customer_id
     FROM transactions t
     WHERE t.business_id = $1
       AND ${LIVE_EARNED_CREDIT}
       AND t.created_at <= now() - ($2 || ' days')::interval
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
  return withTransaction(client => refundAwardTransactionWithClient(client, { staff, transactionId, requestId, reason }));
}

// Call only inside an existing transaction. POS reconciliation must commit its
// receipt result together with the ledger and gamification corrections.
export async function refundAwardTransactionWithClient(client, { staff, transactionId, requestId, reason = "refund" }) {
    await lockRefundRequest(client, staff.business_id, requestId);
    const replay = await findExistingRefundByRequestId(client, staff.business_id, requestId);
    if (replay) {
      if (replay.original_transaction_id !== transactionId) {
        throw conflict("requestId already used for a different refund");
      }
      await AuditRepo.log({
        id: id(),
        business_id: staff.business_id,
        actor_type: staff.id ? "STAFF" : "SYSTEM",
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
    if (tx.status === "REVERSED" || tx.reversed_transaction_id) throw conflict("Transaction already reversed");
    // Expiry already deducted what remained of these points through its own
    // ledger row. POS refunds and order returns reject expired originals too.
    if (tx.status === "EXPIRED" || tx.expired_at) {
      throw conflict("Los puntos de esta transacción ya vencieron; no se pueden revertir.");
    }
    if (tx.status !== "POSTED" && tx.status !== "PENDING") {
      throw conflict("Esta transacción no se puede revertir en su estado actual.");
    }
    // Service restoration and legacy refunds both hold this original debit's
    // FOR UPDATE lock. Check after acquiring it so a concurrent restoration
    // cannot commit a credit between this check and the refund balance update.
    if (tx.source === "redeem" && typeof tx.meta?.redemption_id === "string") {
      await assertCheckoutCorrectionAllowed(client, {businessId: tx.business_id, redemptionId: tx.meta.redemption_id});
      const restored = await client.query(
        `SELECT id FROM service_redemption_restorations
         WHERE business_id = $1 AND customer_id = $2
           AND redemption_id::text = $3
         LIMIT 1`,
        [tx.business_id, tx.customer_id, tx.meta.redemption_id]
      );
      if (restored.rowCount) throw conflict("Transaction already reversed");
    }
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
      actor_type: staff.id ? "STAFF" : "SYSTEM",
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
}
