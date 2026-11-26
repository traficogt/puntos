import { dbQuery } from "../../database.js";

/**
 * Projection returned by {@link churnRepository.getHighChurnRiskCustomers}.
 * DECIMAL columns arrive as strings.
 * @typedef {{
 *   id: string,
 *   name: string | null,
 *   phone: string,
 *   churn_risk_score: string | null,
 *   days_since_last_purchase: number | null,
 *   total_spend: string | null,
 *   total_visits: number | null,
 *   last_purchase_at: Date | null
 * }} ChurnRiskCustomerRow
 */

export const churnRepository = {
  /** @param {string} businessId */
  async calculateChurnRisk(businessId) {
    await dbQuery(
      `UPDATE customer_ltv cl
       SET
         churn_risk_score = LEAST(1.0, (
           COALESCE(EXTRACT(DAY FROM (now() - cl.last_purchase_at)) / 90.0, 1.0) * 0.6 +
           CASE
             WHEN cl.purchase_frequency < 0.5 THEN 0.4
             WHEN cl.purchase_frequency < 1.0 THEN 0.2
             ELSE 0.0
           END
         ))::DECIMAL(4,2),
         updated_at = now()
       FROM customers c
       WHERE c.id = cl.customer_id
         AND c.business_id = $1
         AND c.deleted_at IS NULL`,
      [businessId],
    );
  },

  /**
   * Resolves to `ChurnRiskCustomerRow[]`.
   * @param {string} businessId
   * @param {number} [threshold]
   * @param {number} [limit]
   */
  async getHighChurnRiskCustomers(businessId, threshold = 0.7, limit = 50) {
    const { rows } = await dbQuery(
      `SELECT
         c.id,
         c.name,
         c.phone,
         cl.churn_risk_score,
         cl.days_since_last_purchase,
         cl.total_spend,
         cl.total_visits,
         cl.last_purchase_at
       FROM customer_ltv cl
       JOIN customers c ON c.id = cl.customer_id
       WHERE c.business_id = $1
         AND c.deleted_at IS NULL
         AND NOT c.is_test
           AND cl.churn_risk_score >= $2
       ORDER BY cl.churn_risk_score DESC, cl.total_spend DESC
       LIMIT $3`,
      [businessId, threshold, limit],
    );
    return rows;
  },
};
