import { dbQuery } from "../../database.js";

export function cohortSqlConfigForType(cohortType = "monthly") {
  const normalized = String(cohortType || "monthly").toLowerCase();
  switch (normalized) {
    case "weekly":
      return {
        cohortType: "weekly",
        truncUnit: "week",
        cohortLabelSql: "to_char(DATE_TRUNC('week', cl.first_purchase_at), 'IYYY-\"W\"IW')"
      };
    case "quarterly":
      return {
        cohortType: "quarterly",
        truncUnit: "quarter",
        cohortLabelSql: "to_char(DATE_TRUNC('quarter', cl.first_purchase_at), 'YYYY-\"Q\"Q')"
      };
    case "monthly":
    default:
      return {
        cohortType: "monthly",
        truncUnit: "month",
        cohortLabelSql: "to_char(DATE_TRUNC('month', cl.first_purchase_at), 'YYYY-MM')"
      };
  }
}

export const cohortRepository = {
  async createCohorts(businessId, cohortType = "monthly") {
    const cfg = cohortSqlConfigForType(cohortType);
    const { rows: cohortData } = await dbQuery(
      `SELECT 
         DATE_TRUNC('${cfg.truncUnit}', cl.first_purchase_at) as cohort_date,
         ${cfg.cohortLabelSql} as cohort_name,
         COUNT(DISTINCT c.id) as customer_count
       FROM customers c
       JOIN customer_ltv cl ON cl.customer_id = c.id
       WHERE c.business_id = $1 
         AND c.deleted_at IS NULL
         AND cl.first_purchase_at IS NOT NULL
       GROUP BY DATE_TRUNC('${cfg.truncUnit}', cl.first_purchase_at)`,
      [businessId]
    );

    for (const cohort of cohortData) {
      const { rows } = await dbQuery(
        `INSERT INTO customer_cohorts 
         (business_id, cohort_name, cohort_date, cohort_type, customer_count)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (business_id, cohort_date, cohort_type)
         DO UPDATE SET 
           customer_count = $5,
           created_at = now()
         RETURNING *`,
        [
          businessId,
          cohort.cohort_name,
          cohort.cohort_date,
          cfg.cohortType,
          cohort.customer_count
        ]
      );

      const cohortId = rows[0].id;

      await dbQuery(
        `INSERT INTO customer_cohort_assignments (customer_id, cohort_id)
         SELECT c.id, $2
         FROM customers c
         JOIN customer_ltv cl ON cl.customer_id = c.id
         WHERE c.business_id = $1
           AND DATE_TRUNC('${cfg.truncUnit}', cl.first_purchase_at) = $3
         ON CONFLICT (customer_id, cohort_id) DO NOTHING`,
        [businessId, cohortId, cohort.cohort_date]
      );
    }
  },

  async getCohortRetention(businessId, months = 12) {
    const { rows } = await dbQuery(
      `WITH cohort_months AS (
         SELECT 
           cc.cohort_date,
           cc.cohort_name,
           cc.customer_count as cohort_size,
           generate_series(0, $2) as month_number
         FROM customer_cohorts cc
         WHERE cc.business_id = $1
           AND cc.cohort_date >= now() - interval '12 months'
       ),
       retention AS (
         SELECT 
           cm.cohort_name,
           cm.cohort_date,
           cm.cohort_size,
           cm.month_number,
           COUNT(DISTINCT t.customer_id) as active_customers,
           SUM(t.amount_q) as revenue
         FROM cohort_months cm
         LEFT JOIN customer_cohort_assignments cca ON cca.cohort_id IN (
           SELECT id FROM customer_cohorts 
           WHERE business_id = $1 
             AND cohort_date = cm.cohort_date
         )
         LEFT JOIN transactions t ON t.customer_id = cca.customer_id
           AND DATE_TRUNC('month', t.created_at) = cm.cohort_date + (cm.month_number || ' months')::interval
         GROUP BY cm.cohort_name, cm.cohort_date, cm.cohort_size, cm.month_number
       )
       SELECT 
         cohort_name,
         cohort_date,
         cohort_size,
         month_number,
         active_customers,
         CASE 
           WHEN cohort_size > 0 THEN ROUND((active_customers::DECIMAL / cohort_size * 100), 2)
           ELSE 0 
         END as retention_rate,
         COALESCE(revenue, 0) as revenue
       FROM retention
       ORDER BY cohort_date DESC, month_number ASC`,
      [businessId, months]
    );
    return rows;
  }
};
