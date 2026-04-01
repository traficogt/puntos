import { dbQuery } from "../../database.js";

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

export const segmentRepository = {
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
  }
};
