import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { dbQuery } from "../../database.js";

export const analyticsAnomalyRoutes = Router();

analyticsAnomalyRoutes.get(
  "/admin/analytics/anomalies",
  asyncRoute(async (req, res) => {
    const businessId = req.tenantId;

    const { rows: summaryRows } = await dbQuery(
       `WITH latest_run AS (
          SELECT id, mismatched_customers
          FROM ledger_reconciliation_runs
          WHERE status = 'COMPLETED'
            AND (business_id = $1 OR business_id IS NULL)
          ORDER BY completed_at DESC
          LIMIT 1
        )
       SELECT
         COALESCE((
           SELECT COUNT(*)
           FROM customer_balances cb
           JOIN customers c ON c.id = cb.customer_id
           WHERE c.business_id = $1
             AND c.deleted_at IS NULL
             AND cb.points < 0
         ), 0)::int AS negative_balance_count,
         COALESCE((
           SELECT COUNT(*)
           FROM transactions
           WHERE business_id = $1
             AND source = 'reversal'
             AND created_at >= now() - interval '24 hours'
         ), 0)::int AS reversals_24h,
         COALESCE((
           SELECT COUNT(*)
           FROM audit_logs
           WHERE business_id = $1
             AND action IN (
               'award.replay',
               'reward.redeem.replay',
               'award.refund.replay',
               'gift_card.issue.replay',
               'gift_card.redeem.replay',
               'external_award.replay'
             )
             AND created_at >= now() - interval '24 hours'
         ), 0)::int AS replay_events_24h,
         COALESCE((
           SELECT COUNT(*)
           FROM ledger_balance_corrections
           WHERE business_id = $1
             AND status = 'PENDING'
         ), 0)::int AS pending_corrections_count,
         COALESCE((SELECT mismatched_customers FROM latest_run), 0)::int AS latest_reconciliation_mismatches`,
      [businessId]
    );
    const summary = summaryRows[0] || {};

    const { rows: replayRows } = await dbQuery(
      `SELECT
         action,
         COUNT(*)::int AS count
       FROM audit_logs
       WHERE business_id = $1
         AND action IN (
           'award.replay',
           'reward.redeem.replay',
           'award.refund.replay',
           'gift_card.issue.replay',
           'gift_card.redeem.replay',
           'external_award.replay'
         )
         AND created_at >= now() - interval '24 hours'
       GROUP BY action
       ORDER BY count DESC, action ASC`,
      [businessId]
    );

    const { rows: reversalActorRows } = await dbQuery(
      `SELECT
         COALESCE(su.name, al.actor_id::text, 'unknown') AS actor_name,
         al.actor_id,
         COUNT(*)::int AS reversal_count
       FROM audit_logs al
       LEFT JOIN staff_users su ON su.id = al.actor_id
       WHERE al.business_id = $1
         AND al.action = 'award.refund'
         AND al.created_at >= now() - interval '24 hours'
       GROUP BY actor_name, al.actor_id
       ORDER BY reversal_count DESC, actor_name ASC
       LIMIT 10`,
      [businessId]
    );

    const { rows: negativeRows } = await dbQuery(
      `SELECT
         c.id,
         c.name,
         c.phone,
         cb.points
       FROM customer_balances cb
       JOIN customers c ON c.id = cb.customer_id
       WHERE c.business_id = $1
         AND c.deleted_at IS NULL
         AND cb.points < 0
       ORDER BY cb.points ASC
       LIMIT 20`,
      [businessId]
    );

    return res.json({
      ok: true,
      summary: {
        negative_balance_count: Number(summary.negative_balance_count || 0),
        reversals_24h: Number(summary.reversals_24h || 0),
        replay_events_24h: Number(summary.replay_events_24h || 0),
        pending_corrections_count: Number(summary.pending_corrections_count || 0),
        latest_reconciliation_mismatches: Number(summary.latest_reconciliation_mismatches || 0)
      },
      replay_breakdown: replayRows,
      top_refund_actors: reversalActorRows,
      negative_balances: negativeRows
    });
  })
);
