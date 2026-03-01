import crypto from "node:crypto";
import { dbQuery, withTransaction } from "../database.js";
import { conflict, forbidden, notFound } from "../../utils/http-error.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";

function id() { return crypto.randomUUID(); }

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

export async function refundAwardTransaction({ staff, transactionId, reason = "refund", allowNegative = true }) {
  return withTransaction(async (client) => {
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

    const alreadyReversed = await client.query(
      `SELECT id FROM transactions WHERE original_transaction_id = $1 LIMIT 1`,
      [transactionId]
    );
    if (alreadyReversed.rowCount > 0) throw conflict("Transaction already reversed");

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
       (id, business_id, branch_id, customer_id, staff_user_id, amount_q, visits, items, points, status, source, original_transaction_id, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'POSTED','reversal',$10,$11)`,
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
        {
          refund_reason: reason,
          original_status: tx.status,
          original_points: points,
          refunded_by: staff.id
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

    const newBal = await client.query(
      `SELECT points, pending_points FROM customer_balances WHERE customer_id = $1`,
      [tx.customer_id]
    );

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
        reason,
        points_effect: pointsEffect
      }, staff)
    }).catch(() => { });

    return {
      ok: true,
      transactionId: tx.id,
      reversalTransactionId: reversalId,
      customerId: tx.customer_id,
      pointsEffect,
      newBalance: Number(newBal.rows?.[0]?.points ?? 0),
      newPendingBalance: Number(newBal.rows?.[0]?.pending_points ?? 0)
    };
  });
}
