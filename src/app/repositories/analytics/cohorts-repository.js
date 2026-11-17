import { dbQuery, withTransaction } from "../../database.js";
import { reportingPurchase } from "../../services/reporting-purchase.js";

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
  // Rebuilds one cohort type for a business in a single transaction. Membership
  // comes from recorded purchases (reportingPurchase) of customers that are not
  // deleted, so refunds, corrections and deletions move or remove customers and
  // each customer belongs to exactly one cohort of the type.
  async createCohorts(businessId, cohortType = "monthly") {
    const cfg = cohortSqlConfigForType(cohortType);
    return withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('customer_cohorts'), hashtext($1))", [`${businessId}:${cfg.cohortType}`]);
      const { rows: members } = await client.query(
        `SELECT
           cl.customer_id,
           DATE_TRUNC('${cfg.truncUnit}', cl.first_purchase_at)::date::text AS cohort_date,
           ${cfg.cohortLabelSql} AS cohort_name
         FROM (
           SELECT t.customer_id, MIN(t.created_at) AS first_purchase_at
           FROM transactions t
           JOIN customers c ON c.id = t.customer_id
             AND c.business_id = $1
             AND c.deleted_at IS NULL
           WHERE t.business_id = $1
             AND ${reportingPurchase("t")}
           GROUP BY t.customer_id
         ) cl`,
        [businessId]
      );

      const cohorts = new Map();
      for (const member of members) {
        const cohort = cohorts.get(member.cohort_date) ?? { name: member.cohort_name, count: 0 };
        cohort.count += 1;
        cohorts.set(member.cohort_date, cohort);
      }
      const cohortDates = [...cohorts.keys()];
      const memberIds = members.map((member) => member.customer_id);
      const memberDates = members.map((member) => member.cohort_date);

      await client.query(
        `INSERT INTO customer_cohorts
         (business_id, cohort_name, cohort_date, cohort_type, customer_count)
         SELECT $1, s.cohort_name, s.cohort_date, $2, s.customer_count
         FROM unnest($3::date[], $4::text[], $5::int[]) AS s(cohort_date, cohort_name, customer_count)
         ON CONFLICT (business_id, cohort_date, cohort_type)
         DO UPDATE SET
           cohort_name = EXCLUDED.cohort_name,
           customer_count = EXCLUDED.customer_count,
           created_at = now()`,
        [
          businessId,
          cfg.cohortType,
          cohortDates,
          cohortDates.map((date) => cohorts.get(date).name),
          cohortDates.map((date) => cohorts.get(date).count)
        ]
      );
      await client.query(
        `DELETE FROM customer_cohorts
         WHERE business_id = $1
           AND cohort_type = $2
           AND cohort_date <> ALL($3::date[])`,
        [businessId, cfg.cohortType, cohortDates]
      );
      await client.query(
        `DELETE FROM customer_cohort_assignments a
         USING customer_cohorts cc
         WHERE a.cohort_id = cc.id
           AND cc.business_id = $1
           AND cc.cohort_type = $2
           AND NOT EXISTS (
             SELECT 1
             FROM unnest($3::uuid[], $4::date[]) AS m(customer_id, cohort_date)
             WHERE m.customer_id = a.customer_id
               AND m.cohort_date = cc.cohort_date
           )`,
        [businessId, cfg.cohortType, memberIds, memberDates]
      );
      await client.query(
        `INSERT INTO customer_cohort_assignments (customer_id, cohort_id)
         SELECT m.customer_id, cc.id
         FROM unnest($3::uuid[], $4::date[]) AS m(customer_id, cohort_date)
         JOIN customer_cohorts cc ON cc.business_id = $1
           AND cc.cohort_type = $2
           AND cc.cohort_date = m.cohort_date
         ON CONFLICT (customer_id, cohort_id) DO NOTHING`,
        [businessId, cfg.cohortType, memberIds, memberDates]
      );
      return { cohorts: cohortDates.length, customers: members.length };
    });
  },

  // Monthly retention: a customer is active in a month when they made a recorded
  // purchase (reportingPurchase); revenue excludes refunded sales. Deleted
  // customers leave both numerator and denominator. Months that have not ended
  // return null instead of an incomplete or zero rate.
  async getCohortRetention(businessId, months = 12) {
    const { rows } = await dbQuery(
      `WITH cohorts AS (
         SELECT cc.id, cc.cohort_name, cc.cohort_date
         FROM customer_cohorts cc
         WHERE cc.business_id = $1
           AND cc.cohort_type = 'monthly'
           AND cc.cohort_date >= now() - interval '12 months'
       ),
       members AS (
         SELECT cca.cohort_id, cca.customer_id
         FROM customer_cohort_assignments cca
         JOIN cohorts co ON co.id = cca.cohort_id
         JOIN customers c ON c.id = cca.customer_id
           AND c.business_id = $1
           AND c.deleted_at IS NULL
       ),
       sizes AS (
         SELECT co.id AS cohort_id, COUNT(m.customer_id)::int AS cohort_size
         FROM cohorts co
         LEFT JOIN members m ON m.cohort_id = co.id
         GROUP BY co.id
       ),
       activity AS (
         SELECT
           m.cohort_id,
           DATE_TRUNC('month', t.created_at)::date AS period_start,
           COUNT(DISTINCT t.customer_id) AS active_customers,
           SUM(t.amount_q) AS revenue
         FROM members m
         JOIN transactions t ON t.customer_id = m.customer_id
           AND t.business_id = $1
           AND ${reportingPurchase("t")}
         GROUP BY m.cohort_id, DATE_TRUNC('month', t.created_at)::date
       ),
       cohort_months AS (
         SELECT
           co.id AS cohort_id,
           co.cohort_name,
           co.cohort_date,
           s.cohort_size,
           gs.month_number,
           (co.cohort_date + make_interval(months => gs.month_number))::date AS period_start,
           (co.cohort_date + make_interval(months => gs.month_number + 1)) <= now() AS finished
         FROM cohorts co
         JOIN sizes s ON s.cohort_id = co.id
         CROSS JOIN generate_series(0, $2::int) AS gs(month_number)
       )
       SELECT
         cm.cohort_name,
         cm.cohort_date,
         cm.cohort_size,
         cm.month_number,
         CASE WHEN cm.finished THEN COALESCE(a.active_customers, 0) END AS active_customers,
         CASE
           WHEN NOT cm.finished THEN NULL
           WHEN cm.cohort_size > 0 THEN ROUND((COALESCE(a.active_customers, 0)::DECIMAL / cm.cohort_size * 100), 2)
           ELSE 0
         END AS retention_rate,
         CASE WHEN cm.finished THEN COALESCE(a.revenue, 0) END AS revenue
       FROM cohort_months cm
       LEFT JOIN activity a ON a.cohort_id = cm.cohort_id
         AND a.period_start = cm.period_start
       ORDER BY cm.cohort_date DESC, cm.month_number ASC`,
      [businessId, months]
    );
    return rows;
  }
};
