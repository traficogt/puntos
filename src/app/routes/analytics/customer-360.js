import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { dbQuery } from "../../database.js";
import { buildLedgerFinding, isLedgerBalanceMismatch } from "../../services/ledger-reconciliation-service.js";

export const analyticsCustomerRoutes = Router();

analyticsCustomerRoutes.get(
  "/admin/analytics/customer/:id",
  asyncRoute(async (req, res) => {
    const customerId = req.params.id;

    const { rows } = await dbQuery(
      `SELECT
         c.*,
         cb.points,
         lt.name AS tier_name,
         lt.tier_level,
         lt.points_multiplier,
         cl.total_spend,
         cl.total_visits,
         cl.avg_transaction_value,
         cl.purchase_frequency,
         cl.days_since_last_purchase,
         cl.churn_risk_score,
         cl.rfm_recency,
         cl.rfm_frequency,
         cl.rfm_monetary,
         cl.rfm_score,
         cl.predicted_ltv,
         vs.current_streak,
         vs.longest_streak
       FROM customers c
       LEFT JOIN customer_balances cb ON cb.customer_id = c.id
       LEFT JOIN customer_tiers ct ON ct.customer_id = c.id
       LEFT JOIN loyalty_tiers lt ON lt.id = ct.tier_id
       LEFT JOIN customer_ltv cl ON cl.customer_id = c.id
       LEFT JOIN visit_streaks vs ON vs.customer_id = c.id
       WHERE c.id = $1 AND c.business_id = $2`,
      [customerId, req.tenantId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const customer = rows[0];

    const { rows: segments } = await dbQuery(
      `SELECT cs.name, cs.segment_type, csa.assigned_at
       FROM customer_segment_assignments csa
       JOIN customer_segments cs ON cs.id = csa.segment_id
       WHERE csa.customer_id = $1
         AND cs.business_id = $2`,
      [customerId, req.tenantId]
    );

    const { rows: achievements } = await dbQuery(
      `SELECT a.name, a.description, ca.earned_at
       FROM customer_achievements ca
       JOIN achievements a ON a.id = ca.achievement_id
       WHERE ca.customer_id = $1
         AND a.business_id = $2
       ORDER BY ca.earned_at DESC
       LIMIT 10`,
      [customerId, req.tenantId]
    );

    const { rows: referralStats } = await dbQuery(
      `SELECT
         COUNT(*) AS total_referrals,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed_referrals
       FROM referrals
       WHERE referrer_customer_id = $1
         AND business_id = $2`,
      [customerId, req.tenantId]
    );

    const { rows: recentTransactions } = await dbQuery(
      `SELECT * FROM transactions
       WHERE customer_id = $1
         AND business_id = $2
       ORDER BY created_at DESC
       LIMIT 10`,
      [customerId, req.tenantId]
    );

    return res.json({
      ok: true,
      customer,
      segments,
      achievements,
      referral_stats: referralStats[0],
      recent_transactions: recentTransactions
    });
  })
);

analyticsCustomerRoutes.get(
  "/admin/analytics/customer/:id/ledger",
  asyncRoute(async (req, res) => {
    const customerId = req.params.id;

    const { rows } = await dbQuery(
      `WITH tx_agg AS (
         SELECT
           customer_id,
           COALESCE(SUM(CASE WHEN status = 'POSTED' THEN points ELSE 0 END), 0)::int AS posted_points,
           COALESCE(SUM(CASE WHEN status = 'PENDING' THEN points ELSE 0 END), 0)::int AS pending_points,
           COALESCE(SUM(CASE WHEN status = 'POSTED' AND points > 0 THEN points ELSE 0 END), 0)::int AS lifetime_points
         FROM transactions
         WHERE customer_id = $1
         GROUP BY customer_id
       ),
       adj_agg AS (
         SELECT
           customer_id,
           COALESCE(SUM(delta_points), 0)::int AS delta_points,
           COALESCE(SUM(delta_pending_points), 0)::int AS delta_pending_points,
           COALESCE(SUM(delta_lifetime_points), 0)::int AS delta_lifetime_points
         FROM ledger_balance_adjustments
         WHERE customer_id = $1
         GROUP BY customer_id
       )
       SELECT
         c.id AS customer_id,
         c.business_id,
         c.name,
         c.phone,
         c.created_at,
         COALESCE(cb.points, 0)::int AS stored_points,
         COALESCE(cb.pending_points, 0)::int AS stored_pending_points,
         COALESCE(cb.lifetime_points, 0)::int AS stored_lifetime_points,
         (COALESCE(tx.posted_points, 0) + COALESCE(adj.delta_points, 0))::int AS expected_points,
         (COALESCE(tx.pending_points, 0) + COALESCE(adj.delta_pending_points, 0))::int AS expected_pending_points,
         (COALESCE(tx.lifetime_points, 0) + COALESCE(adj.delta_lifetime_points, 0))::int AS expected_lifetime_points
       FROM customers c
       LEFT JOIN customer_balances cb ON cb.customer_id = c.id
       LEFT JOIN tx_agg tx ON tx.customer_id = c.id
       LEFT JOIN adj_agg adj ON adj.customer_id = c.id
       WHERE c.id = $1
         AND c.business_id = $2`,
      [customerId, req.tenantId]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const balanceRow = rows[0];
    const finding = buildLedgerFinding(balanceRow);

    const { rows: breakdownRows } = await dbQuery(
      `SELECT
         source,
         status,
         COUNT(*)::int AS transaction_count,
         COALESCE(SUM(points), 0)::int AS total_points,
         COALESCE(SUM(amount_q), 0)::numeric AS total_amount_q
       FROM transactions
       WHERE customer_id = $1
         AND business_id = $2
       GROUP BY source, status
       ORDER BY source ASC, status ASC`,
      [customerId, req.tenantId]
    );

    const { rows: transactionRows } = await dbQuery(
      `SELECT
         id,
         created_at,
         source,
         status,
         amount_q,
         visits,
         items,
         points,
         original_transaction_id,
         reversed_transaction_id,
         reversal_reason,
         meta
       FROM transactions
       WHERE customer_id = $1
         AND business_id = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [customerId, req.tenantId]
    );

    const { rows: redemptionRows } = await dbQuery(
      `SELECT
         r.id,
         r.created_at,
         r.status,
         r.code,
         r.points_cost,
         rw.id AS reward_id,
         rw.name AS reward_name
       FROM redemptions r
       JOIN rewards rw ON rw.id = r.reward_id
       WHERE r.customer_id = $1
         AND r.business_id = $2
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [customerId, req.tenantId]
    );

    return res.json({
      ok: true,
      customer: {
        id: balanceRow.customer_id,
        business_id: balanceRow.business_id,
        name: balanceRow.name,
        phone: balanceRow.phone,
        created_at: balanceRow.created_at
      },
      balances: {
        stored: {
          points: finding.stored_points,
          pending_points: finding.stored_pending_points,
          lifetime_points: finding.stored_lifetime_points
        },
        expected: {
          points: finding.expected_points,
          pending_points: finding.expected_pending_points,
          lifetime_points: finding.expected_lifetime_points
        },
        delta: {
          points: finding.delta_points,
          pending_points: finding.delta_pending_points,
          lifetime_points: finding.delta_lifetime_points
        },
        mismatch: isLedgerBalanceMismatch(balanceRow)
      },
      ledger_breakdown: breakdownRows,
      recent_transactions: transactionRows,
      recent_redemptions: redemptionRows
    });
  })
);
