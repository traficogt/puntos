import { dbQuery } from "../../database.js";

export const rfmRepository = {
  async calculateRFMScores(businessId) {
    await dbQuery(
      `WITH rfm_data AS (
         SELECT 
           c.id as customer_id,
           EXTRACT(DAY FROM (now() - MAX(t.created_at))) as recency_days,
           COUNT(t.id) as frequency,
           COALESCE(SUM(t.amount_q), 0) as monetary
         FROM customers c
         LEFT JOIN transactions t ON t.customer_id = c.id AND t.amount_q IS NOT NULL
         WHERE c.business_id = $1 AND c.deleted_at IS NULL
         GROUP BY c.id
       ),
       rfm_quartiles AS (
         SELECT 
           PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY recency_days) as r_20,
           PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY recency_days) as r_40,
           PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY recency_days) as r_60,
           PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY recency_days) as r_80,
           PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY frequency) as f_20,
           PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY frequency) as f_40,
           PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY frequency) as f_60,
           PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY frequency) as f_80,
           PERCENTILE_CONT(0.2) WITHIN GROUP (ORDER BY monetary) as m_20,
           PERCENTILE_CONT(0.4) WITHIN GROUP (ORDER BY monetary) as m_40,
           PERCENTILE_CONT(0.6) WITHIN GROUP (ORDER BY monetary) as m_60,
           PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY monetary) as m_80
         FROM rfm_data
       ),
       rfm_scores AS (
         SELECT 
           rd.customer_id,
           CASE 
             WHEN rd.recency_days <= rq.r_20 THEN 5
             WHEN rd.recency_days <= rq.r_40 THEN 4
             WHEN rd.recency_days <= rq.r_60 THEN 3
             WHEN rd.recency_days <= rq.r_80 THEN 2
             ELSE 1
           END as r_score,
           CASE 
             WHEN rd.frequency >= rq.f_80 THEN 5
             WHEN rd.frequency >= rq.f_60 THEN 4
             WHEN rd.frequency >= rq.f_40 THEN 3
             WHEN rd.frequency >= rq.f_20 THEN 2
             ELSE 1
           END as f_score,
           CASE 
             WHEN rd.monetary >= rq.m_80 THEN 5
             WHEN rd.monetary >= rq.m_60 THEN 4
             WHEN rd.monetary >= rq.m_40 THEN 3
             WHEN rd.monetary >= rq.m_20 THEN 2
             ELSE 1
           END as m_score
         FROM rfm_data rd
         CROSS JOIN rfm_quartiles rq
       )
       UPDATE customer_ltv cl
       SET 
         rfm_recency = rs.r_score,
         rfm_frequency = rs.f_score,
         rfm_monetary = rs.m_score,
         rfm_score = rs.r_score + rs.f_score + rs.m_score,
         updated_at = now()
       FROM rfm_scores rs
       WHERE cl.customer_id = rs.customer_id`,
      [businessId]
    );
  },

  async calculatePredictedLTV(businessId) {
    await dbQuery(
      `UPDATE customer_ltv cl
       SET 
         predicted_ltv = (
           CASE 
             WHEN cl.purchase_frequency > 0 THEN
               cl.avg_transaction_value * 
               (cl.purchase_frequency * 12 * 2)
             ELSE 0
           END
         )::DECIMAL(10,2),
         updated_at = now()
       FROM customers c
       WHERE c.id = cl.customer_id 
         AND c.business_id = $1`,
      [businessId]
    );
  },

  async getTopCustomersByLTV(businessId, limit = 50) {
    const { rows } = await dbQuery(
      `SELECT 
         c.id,
         c.name,
         c.phone,
         cl.predicted_ltv,
         cl.total_spend,
         cl.purchase_frequency,
         cl.rfm_score
       FROM customer_ltv cl
       JOIN customers c ON c.id = cl.customer_id
       WHERE c.business_id = $1 
         AND c.deleted_at IS NULL
         AND cl.predicted_ltv > 0
       ORDER BY cl.predicted_ltv DESC
       LIMIT $2`,
      [businessId, limit]
    );
    return rows;
  }
};
