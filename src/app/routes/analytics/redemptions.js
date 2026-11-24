import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { uuidParamsSchema, validateParams } from "../../../utils/schemas.js";
import { dbQuery } from "../../database.js";

/** @typedef {import("../_request-types.js").Response} Response */
/** @typedef {import("../_request-types.js").TenantRequest} TenantRequest */
/**
 * @template P
 * @typedef {import("../_request-types.js").WithValidatedParams<P>} WithValidatedParams
 */
/** @typedef {import("zod").infer<typeof uuidParamsSchema>} UuidParams */

/**
 * Recent redemption of a reward with its linked ledger totals.
 * @typedef {{
 *   id: string,
 *   created_at: Date,
 *   status: string,
 *   code: string,
 *   points_cost: number,
 *   customer_name: string | null,
 *   customer_phone: string,
 *   linked_points_total: number,
 *   linked_transaction_count: number
 * }} RewardRedemptionRow
 */

/**
 * Ledger entries linked to a redemption through `meta.redemption_id`.
 * @typedef {Pick<import("../../repositories/transaction-repository.js").TransactionRow,
 *   | "id" | "created_at" | "source" | "status" | "amount_q" | "points"
 *   | "original_transaction_id" | "reversed_transaction_id" | "reversal_reason" | "meta">} LinkedTransactionRow
 */

export const analyticsRedemptionRoutes = Router();

analyticsRedemptionRoutes.get(
  "/admin/analytics/rewards/:id/redemptions",
  validateParams(uuidParamsSchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedParams<UuidParams>} req @param {Response} res */
    async (req, res) => {
      const rewardId = req.validatedParams.id;

      const { rows: rewardRows } = await dbQuery(
        `SELECT id, business_id, name, description, points_cost, active, stock
       FROM rewards
       WHERE id = $1
         AND business_id = $2`,
        [rewardId, req.tenantId],
      );

      const reward = rewardRows[0];
      if (!reward) {
        return res.status(404).json({ error: "Recompensa no encontrada" });
      }

      /** @type {{ rows: RewardRedemptionRow[] }} */
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
        [rewardId, req.tenantId],
      );

      const totalRedemptions = recentRedemptions.length;
      const mismatchCount = recentRedemptions.filter(
        (row) =>
          Number(row.linked_points_total || 0) !== -Number(row.points_cost || 0) ||
          Number(row.linked_transaction_count || 0) !== 1,
      ).length;

      return res.json({
        ok: true,
        reward,
        summary: {
          recent_redemption_count: totalRedemptions,
          mismatch_count: mismatchCount,
        },
        recent_redemptions: recentRedemptions,
      });
    },
  ),
);

analyticsRedemptionRoutes.get(
  "/admin/analytics/redemptions/:id",
  validateParams(uuidParamsSchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedParams<UuidParams>} req @param {Response} res */
    async (req, res) => {
      const redemptionId = req.validatedParams.id;

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
        [redemptionId, req.tenantId],
      );

      const redemption = rows[0];
      if (!redemption) {
        return res.status(404).json({ error: "Canje no encontrado" });
      }

      /** @type {{ rows: LinkedTransactionRow[] }} */
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
        [req.tenantId, redemption.customer_id, redemption.id],
      );

      const linkedPointsTotal = transactionRows.reduce(
        (sum, tx) => sum + Number(tx.points || 0),
        0,
      );
      const expectedPointsTotal = -Number(redemption.points_cost || 0);

      return res.json({
        ok: true,
        redemption,
        ledger: {
          expected_points_total: expectedPointsTotal,
          linked_points_total: linkedPointsTotal,
          delta_points: linkedPointsTotal - expectedPointsTotal,
          linked_transaction_count: transactionRows.length,
          consistent: linkedPointsTotal === expectedPointsTotal && transactionRows.length === 1,
        },
        transactions: transactionRows,
      });
    },
  ),
);
