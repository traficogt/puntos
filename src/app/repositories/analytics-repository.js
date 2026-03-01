import { dbQuery } from "../database.js";

const DEFAULT_RFM_SEGMENTS = [
  {
    name: "Champions",
    description: "Recent, frequent, high-value customers",
    segment_type: "rfm",
    criteria: { rfm_min: 12, rfm_max: 15 },
    color: "#10B981"
  },
  {
    name: "Loyal Customers",
    description: "Frequent customers with good spend",
    segment_type: "rfm",
    criteria: { rfm_min: 9, rfm_max: 11 },
    color: "#3B82F6"
  },
  {
    name: "At Risk",
    description: "Were good customers but declining",
    segment_type: "rfm",
    criteria: { rfm_min: 6, rfm_max: 8, recency_max: 2 },
    color: "#F59E0B"
  },
  {
    name: "Lost",
    description: "Haven't returned in a long time",
    segment_type: "rfm",
    criteria: { rfm_min: 3, rfm_max: 5 },
    color: "#EF4444"
  }
];

export const AnalyticsRepository = {
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
           -- Recency: lower is better (reversed scoring)
           CASE 
             WHEN rd.recency_days <= rq.r_20 THEN 5
             WHEN rd.recency_days <= rq.r_40 THEN 4
             WHEN rd.recency_days <= rq.r_60 THEN 3
             WHEN rd.recency_days <= rq.r_80 THEN 2
             ELSE 1
           END as r_score,
           -- Frequency: higher is better
           CASE 
             WHEN rd.frequency >= rq.f_80 THEN 5
             WHEN rd.frequency >= rq.f_60 THEN 4
             WHEN rd.frequency >= rq.f_40 THEN 3
             WHEN rd.frequency >= rq.f_20 THEN 2
             ELSE 1
           END as f_score,
           -- Monetary: higher is better
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

  async calculateChurnRisk(businessId) {
    await dbQuery(
      `UPDATE customer_ltv cl
       SET 
         churn_risk_score = LEAST(1.0, (
           -- Days since last purchase (capped at 90 days = 1.0)
           COALESCE(EXTRACT(DAY FROM (now() - cl.last_purchase_at)) / 90.0, 1.0) * 0.6 +
           -- Low frequency indicator
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
      [businessId]
    );
  },

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
         AND cl.churn_risk_score >= $2
       ORDER BY cl.churn_risk_score DESC, cl.total_spend DESC
       LIMIT $3`,
      [businessId, threshold, limit]
    );
    return rows;
  },

  async createSegment(segmentData) {
    const { rows } = await dbQuery(
      `INSERT INTO customer_segments 
       (business_id, name, description, segment_type, criteria, auto_update, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        segmentData.business_id,
        segmentData.name,
        segmentData.description || null,
        segmentData.segment_type,
        JSON.stringify(segmentData.criteria),
        segmentData.auto_update !== false,
        segmentData.color || null
      ]
    );
    return rows[0];
  },

  async listSegments(businessId) {
    const { rows } = await dbQuery(
      `SELECT 
         cs.*,
         COUNT(csa.customer_id) as customer_count
       FROM customer_segments cs
       LEFT JOIN customer_segment_assignments csa ON csa.segment_id = cs.id
       WHERE cs.business_id = $1
       GROUP BY cs.id
       ORDER BY cs.created_at DESC`,
      [businessId]
    );
    return rows;
  },

  async assignCustomerToSegment(customerId, segmentId, autoAssigned = false) {
    const { rows } = await dbQuery(
      `INSERT INTO customer_segment_assignments 
       (customer_id, segment_id, auto_assigned)
       VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, segment_id) DO NOTHING
       RETURNING *`,
      [customerId, segmentId, autoAssigned]
    );
    return rows[0];
  },

  async removeCustomerFromSegment(customerId, segmentId) {
    await dbQuery(
      `DELETE FROM customer_segment_assignments 
       WHERE customer_id = $1 AND segment_id = $2`,
      [customerId, segmentId]
    );
  },

  async getSegmentCustomers(businessId, segmentId, limit = 100, offset = 0) {
    const { rows } = await dbQuery(
      `SELECT 
         c.*,
         csa.assigned_at,
         csa.auto_assigned
       FROM customer_segment_assignments csa
       JOIN customer_segments cs ON cs.id = csa.segment_id
       JOIN customers c ON c.id = csa.customer_id
       WHERE csa.segment_id = $1
         AND cs.business_id = $2
         AND c.deleted_at IS NULL
       ORDER BY csa.assigned_at DESC
       LIMIT $3 OFFSET $4`,
      [segmentId, businessId, limit, offset]
    );
    return rows;
  },

  async createDefaultRFMSegments(businessId) {
    const created = [];
    for (const segmentData of DEFAULT_RFM_SEGMENTS) {
      const segment = await this.createSegment({
        business_id: businessId,
        ...segmentData
      });
      created.push(segment);
    }

    return created;
  },

  async createCohorts(businessId, cohortType = 'monthly') {
    const { rows: cohortData } = await dbQuery(
      `SELECT 
         DATE_TRUNC('month', cl.first_purchase_at) as cohort_date,
         COUNT(DISTINCT c.id) as customer_count
       FROM customers c
       JOIN customer_ltv cl ON cl.customer_id = c.id
       WHERE c.business_id = $1 
         AND c.deleted_at IS NULL
         AND cl.first_purchase_at IS NOT NULL
       GROUP BY DATE_TRUNC('month', cl.first_purchase_at)`,
      [businessId]
    );

    for (const cohort of cohortData) {
      const cohortName = new Date(cohort.cohort_date).toISOString().slice(0, 7);

      const { rows } = await dbQuery(
        `INSERT INTO customer_cohorts 
         (business_id, cohort_name, cohort_date, cohort_type, customer_count)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (business_id, cohort_date, cohort_type)
         DO UPDATE SET 
           customer_count = $5,
           created_at = now()
         RETURNING *`,
        [businessId, cohortName, cohort.cohort_date, cohortType, cohort.customer_count]
      );

      const cohortId = rows[0].id;

      await dbQuery(
        `INSERT INTO customer_cohort_assignments (customer_id, cohort_id)
         SELECT c.id, $2
         FROM customers c
         JOIN customer_ltv cl ON cl.customer_id = c.id
         WHERE c.business_id = $1
           AND DATE_TRUNC('month', cl.first_purchase_at) = $3
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
  },

  async calculatePredictedLTV(businessId) {
    await dbQuery(
      `UPDATE customer_ltv cl
       SET 
         predicted_ltv = (
           -- Average transaction value * estimated lifetime transactions
           CASE 
             WHEN cl.purchase_frequency > 0 THEN
               cl.avg_transaction_value * 
               (cl.purchase_frequency * 12 * 2) -- Assuming 2-year lifetime
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
