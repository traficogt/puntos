import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { dbQuery } from "../../database.js";

export const analyticsRedemptionRoutes = Router();

analyticsRedemptionRoutes.get(
  "/admin/analytics/rewards/:id/redemptions",
  asyncRoute(async (req, res) => {
    const rewardId = String(req.params.id || "");

    const { rows: rewardRows } = await dbQuery(
      `SELECT id, business_id, name, description, points_cost, active, stock
       FROM rewards
       WHERE id = $1
         AND business_id = $2`,
      [rewardId, req.tenantId]
    );

    const reward = rewardRows[0];
    if (!reward) {
      return res.status(404).json({ error: "Reward not found" });
    }

    const { rows: recentRedemptions } = await dbQuery(
      `SELECT
         r.id,
         r.created_at,
         r.status,
         r.code,
         r.points_cost,
         c.name AS customer_name,
         c.phone AS customer_phone,
         COALESCE((
           SELECT SUM(t.points)::int
           FROM transactions t
           WHERE t.business_id = r.business_id
             AND t.customer_id = r.customer_id
             AND t.meta->>'redemption_id' = r.id::text
         ), 0)::int AS linked_points_total,
         COALESCE((
           SELECT COUNT(*)::int
           FROM transactions t
           WHERE t.business_id = r.business_id
             AND t.customer_id = r.customer_id
             AND t.meta->>'redemption_id' = r.id::text
         ), 0)::int AS linked_transaction_count
       FROM redemptions r
       JOIN customers c ON c.id = r.customer_id
       WHERE r.reward_id = $1
         AND r.business_id = $2
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [rewardId, req.tenantId]
    );

    const totalRedemptions = recentRedemptions.length;
    const mismatchCount = recentRedemptions.filter((row) => (
      Number(row.linked_points_total || 0) !== -Number(row.points_cost || 0)
      || Number(row.linked_transaction_count || 0) !== 1
    )).length;

    return res.json({
      ok: true,
      reward,
      summary: {
        recent_redemption_count: totalRedemptions,
        mismatch_count: mismatchCount
      },
      recent_redemptions: recentRedemptions
    });
  })
);

analyticsRedemptionRoutes.get(
  "/admin/analytics/redemptions/:id",
  asyncRoute(async (req, res) => {
    const redemptionId = String(req.params.id || "");

    const { rows } = await dbQuery(
      `SELECT
         r.id,
         r.created_at,
         r.status,
         r.code,
         r.points_cost,
         r.business_id,
         r.customer_id,
         r.reward_id,
         r.staff_user_id,
         c.name AS customer_name,
         c.phone AS customer_phone,
         rw.name AS reward_name,
         rw.description AS reward_description,
         su.name AS staff_name
       FROM redemptions r
       JOIN customers c ON c.id = r.customer_id
       JOIN rewards rw ON rw.id = r.reward_id
       LEFT JOIN staff_users su ON su.id = r.staff_user_id
       WHERE r.id = $1
         AND r.business_id = $2`,
      [redemptionId, req.tenantId]
    );

    const redemption = rows[0];
    if (!redemption) {
      return res.status(404).json({ error: "Redemption not found" });
    }

    const { rows: transactionRows } = await dbQuery(
      `SELECT
         id,
         created_at,
         source,
         status,
         amount_q,
         points,
         original_transaction_id,
         reversed_transaction_id,
         reversal_reason,
         meta
       FROM transactions
       WHERE business_id = $1
         AND customer_id = $2
         AND meta->>'redemption_id' = $3
       ORDER BY created_at ASC`,
      [req.tenantId, redemption.customer_id, redemption.id]
    );

    const linkedPointsTotal = transactionRows.reduce((sum, tx) => sum + Number(tx.points || 0), 0);
    const expectedPointsTotal = -Number(redemption.points_cost || 0);

    return res.json({
      ok: true,
      redemption,
      ledger: {
        expected_points_total: expectedPointsTotal,
        linked_points_total: linkedPointsTotal,
        delta_points: linkedPointsTotal - expectedPointsTotal,
        linked_transaction_count: transactionRows.length,
        consistent: linkedPointsTotal === expectedPointsTotal && transactionRows.length === 1
      },
      transactions: transactionRows
    });
  })
);
