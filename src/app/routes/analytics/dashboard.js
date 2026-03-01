import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { resolveBranchFilter } from "./_util.js";
import { dbQuery } from "../../database.js";

export const analyticsDashboardRoutes = Router();

analyticsDashboardRoutes.get(
  "/admin/analytics/dashboard",
  asyncRoute(async (req, res) => {
    const branchId = await resolveBranchFilter(req, res);
    if (branchId === "__invalid__") return;
    const businessId = req.tenantId;

    let summary;
    let rfmDistribution;
    let activity;
    let branchPerformance;

    if (!branchId) {
      const { rows } = await dbQuery(
        `SELECT
           COUNT(DISTINCT c.id) AS total_customers,
           COUNT(DISTINCT c.id) FILTER (WHERE c.created_at > now() - interval '30 days') AS new_customers_30d,
           COALESCE(SUM(cb.points), 0) AS total_points_issued,
           COALESCE(AVG(cb.points), 0) AS avg_points_per_customer,
           COUNT(DISTINCT c.id) FILTER (WHERE cl.churn_risk_score >= 0.7) AS high_churn_risk_count,
           COALESCE(AVG(cl.total_spend), 0) AS avg_customer_spend,
           COALESCE(AVG(cl.purchase_frequency), 0) AS avg_purchase_frequency
         FROM customers c
         LEFT JOIN customer_balances cb ON cb.customer_id = c.id
         LEFT JOIN customer_ltv cl ON cl.customer_id = c.id
         WHERE c.business_id = $1
           AND c.deleted_at IS NULL`,
        [businessId]
      );
      summary = rows;

      const { rows: rRows } = await dbQuery(
        `SELECT
           CASE
             WHEN rfm_score >= 12 THEN 'Champions'
             WHEN rfm_score >= 9 THEN 'Loyal'
             WHEN rfm_score >= 6 THEN 'At Risk'
             ELSE 'Lost'
           END AS segment,
           COUNT(*) AS count
         FROM customer_ltv cl
         JOIN customers c ON c.id = cl.customer_id
         WHERE c.business_id = $1
           AND c.deleted_at IS NULL
         GROUP BY segment`,
        [businessId]
      );
      rfmDistribution = rRows;

      const { rows: aRows } = await dbQuery(
        `SELECT
           DATE(t.created_at) AS date,
           COUNT(DISTINCT t.customer_id) AS active_customers,
           COUNT(*) AS transactions,
           COALESCE(SUM(t.amount_q), 0) AS revenue
         FROM transactions t
         JOIN customers c ON c.id = t.customer_id
         WHERE c.business_id = $1
           AND t.created_at > now() - interval '30 days'
         GROUP BY DATE(t.created_at)
         ORDER BY DATE(t.created_at) DESC`,
        [businessId]
      );
      activity = aRows;

      const { rows: pRows } = await dbQuery(
        `SELECT
           b.id AS branch_id,
           b.name AS branch_name,
           b.code AS branch_code,
           COALESCE(tx.tx_30d, 0)::int AS tx_30d,
           COALESCE(tx.revenue_30d, 0)::numeric(10,2) AS revenue_30d,
           COALESCE(tx.active_customers_30d, 0)::int AS active_customers_30d,
           COALESCE(rd.redemptions_30d, 0)::int AS redemptions_30d,
           CASE
             WHEN COALESCE(tx.tx_30d, 0) > 0 THEN (COALESCE(tx.revenue_30d, 0) / tx.tx_30d)::numeric(10,2)
             ELSE 0::numeric(10,2)
           END AS avg_ticket_30d
         FROM branches b
         LEFT JOIN LATERAL (
           SELECT
             COUNT(*) AS tx_30d,
             COALESCE(SUM(amount_q), 0) AS revenue_30d,
             COUNT(DISTINCT customer_id) AS active_customers_30d
           FROM transactions
           WHERE branch_id = b.id
             AND created_at > now() - interval '30 days'
         ) tx ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS redemptions_30d
           FROM redemptions
           WHERE branch_id = b.id
             AND created_at > now() - interval '30 days'
         ) rd ON true
         WHERE b.business_id = $1
         ORDER BY revenue_30d DESC, tx_30d DESC, b.name ASC`,
        [businessId]
      );
      branchPerformance = pRows;
    } else {
      const { rows } = await dbQuery(
        `WITH branch_customers AS (
           SELECT DISTINCT customer_id
           FROM transactions
           WHERE business_id = $1
             AND branch_id = $2
         )
         SELECT
           (SELECT COUNT(*) FROM branch_customers) AS total_customers,
           (SELECT COUNT(*)
            FROM customers c
            JOIN branch_customers bc ON bc.customer_id = c.id
            WHERE c.created_at > now() - interval '30 days') AS new_customers_30d,
           (SELECT COALESCE(SUM(points), 0)
            FROM transactions t
            WHERE t.business_id = $1
              AND t.branch_id = $2
              AND t.points > 0) AS total_points_issued,
           (SELECT COALESCE(AVG(cb.points), 0)
            FROM customer_balances cb
            JOIN branch_customers bc ON bc.customer_id = cb.customer_id) AS avg_points_per_customer,
           (SELECT COUNT(*)
            FROM customer_ltv cl
            JOIN branch_customers bc ON bc.customer_id = cl.customer_id
            WHERE cl.churn_risk_score >= 0.7) AS high_churn_risk_count,
           (SELECT COALESCE(AVG(cl.total_spend), 0)
            FROM customer_ltv cl
            JOIN branch_customers bc ON bc.customer_id = cl.customer_id) AS avg_customer_spend,
           (SELECT COALESCE(AVG(cl.purchase_frequency), 0)
            FROM customer_ltv cl
            JOIN branch_customers bc ON bc.customer_id = cl.customer_id) AS avg_purchase_frequency`,
        [businessId, branchId]
      );
      summary = rows;

      const { rows: rRows } = await dbQuery(
        `WITH branch_customers AS (
           SELECT DISTINCT customer_id
           FROM transactions
           WHERE business_id = $1
             AND branch_id = $2
         )
         SELECT
           CASE
             WHEN cl.rfm_score >= 12 THEN 'Champions'
             WHEN cl.rfm_score >= 9 THEN 'Loyal'
             WHEN cl.rfm_score >= 6 THEN 'At Risk'
             ELSE 'Lost'
           END AS segment,
           COUNT(*) AS count
         FROM customer_ltv cl
         JOIN branch_customers bc ON bc.customer_id = cl.customer_id
         GROUP BY segment`,
        [businessId, branchId]
      );
      rfmDistribution = rRows;

      const { rows: aRows } = await dbQuery(
        `SELECT
           DATE(t.created_at) AS date,
           COUNT(DISTINCT t.customer_id) AS active_customers,
           COUNT(*) AS transactions,
           COALESCE(SUM(t.amount_q), 0) AS revenue
         FROM transactions t
         WHERE t.business_id = $1
           AND t.branch_id = $2
           AND t.created_at > now() - interval '30 days'
         GROUP BY DATE(t.created_at)
         ORDER BY DATE(t.created_at) DESC`,
        [businessId, branchId]
      );
      activity = aRows;

      const { rows: pRows } = await dbQuery(
        `SELECT
           b.id AS branch_id,
           b.name AS branch_name,
           b.code AS branch_code,
           COALESCE(tx.tx_30d, 0)::int AS tx_30d,
           COALESCE(tx.revenue_30d, 0)::numeric(10,2) AS revenue_30d,
           COALESCE(tx.active_customers_30d, 0)::int AS active_customers_30d,
           COALESCE(rd.redemptions_30d, 0)::int AS redemptions_30d,
           CASE
             WHEN COALESCE(tx.tx_30d, 0) > 0 THEN (COALESCE(tx.revenue_30d, 0) / tx.tx_30d)::numeric(10,2)
             ELSE 0::numeric(10,2)
           END AS avg_ticket_30d
         FROM branches b
         LEFT JOIN LATERAL (
           SELECT
             COUNT(*) AS tx_30d,
             COALESCE(SUM(amount_q), 0) AS revenue_30d,
             COUNT(DISTINCT customer_id) AS active_customers_30d
           FROM transactions
           WHERE branch_id = b.id
             AND created_at > now() - interval '30 days'
         ) tx ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS redemptions_30d
           FROM redemptions
           WHERE branch_id = b.id
             AND created_at > now() - interval '30 days'
         ) rd ON true
         WHERE b.business_id = $1
           AND b.id = $2`,
        [businessId, branchId]
      );
      branchPerformance = pRows;
    }

    return res.json({
      ok: true,
      summary: summary[0],
      rfm_distribution: rfmDistribution,
      recent_activity: activity,
      branch_performance: branchPerformance,
      branch_id: branchId
    });
  })
);

