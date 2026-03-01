import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { dbQuery } from "../../database.js";

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
       WHERE csa.customer_id = $1`,
      [customerId]
    );

    const { rows: achievements } = await dbQuery(
      `SELECT a.name, a.description, ca.earned_at
       FROM customer_achievements ca
       JOIN achievements a ON a.id = ca.achievement_id
       WHERE ca.customer_id = $1
       ORDER BY ca.earned_at DESC
       LIMIT 10`,
      [customerId]
    );

    const { rows: referralStats } = await dbQuery(
      `SELECT
         COUNT(*) AS total_referrals,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed_referrals
       FROM referrals
       WHERE referrer_customer_id = $1`,
      [customerId]
    );

    const { rows: recentTransactions } = await dbQuery(
      `SELECT * FROM transactions
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [customerId]
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
