import { dbQuery } from "../../database.js";

/**
 * Row of `customer_segments`.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   name: string,
 *   description: string | null,
 *   segment_type: string | null,
 *   criteria: Record<string, unknown>,
 *   auto_update: boolean,
 *   color: string | null,
 *   created_at: Date,
 *   updated_at: Date
 * }} CustomerSegmentRow
 */

/**
 * Segment with its member count ({@link segmentRepository.listSegments}); COUNT is bigint → string.
 * @typedef {CustomerSegmentRow & { customer_count: string }} CustomerSegmentWithCountRow
 */

/**
 * Row of `customer_segment_assignments`.
 * @typedef {{
 *   id: string,
 *   customer_id: string,
 *   segment_id: string,
 *   assigned_at: Date,
 *   auto_assigned: boolean
 * }} CustomerSegmentAssignmentRow
 */

/**
 * Customer joined with its assignment ({@link segmentRepository.getSegmentCustomers}).
 * @typedef {import("../customer-repository.js").CustomerRow
 *   & Pick<CustomerSegmentAssignmentRow, "assigned_at" | "auto_assigned">} SegmentCustomerRow
 */

/**
 * @typedef {{
 *   business_id: string,
 *   name: string,
 *   description?: string | null,
 *   segment_type: string,
 *   criteria: Record<string, unknown>,
 *   auto_update?: boolean,
 *   color?: string | null
 * }} SegmentCreateInput
 */

const DEFAULT_RFM_SEGMENTS = [
  {
    name: "Champions",
    description: "Recent, frequent, high-value customers",
    segment_type: "rfm",
    criteria: { rfm_min: 12, rfm_max: 15 },
    color: "#10B981",
  },
  {
    name: "Loyal Customers",
    description: "Frequent customers with good spend",
    segment_type: "rfm",
    criteria: { rfm_min: 9, rfm_max: 11 },
    color: "#3B82F6",
  },
  {
    name: "At Risk",
    description: "Were good customers but declining",
    segment_type: "rfm",
    criteria: { rfm_min: 6, rfm_max: 8, recency_max: 2 },
    color: "#F59E0B",
  },
  {
    name: "Lost",
    description: "Haven't returned in a long time",
    segment_type: "rfm",
    criteria: { rfm_min: 3, rfm_max: 5 },
    color: "#EF4444",
  },
];

export const segmentRepository = {
  /**
   * Resolves to `CustomerSegmentRow`.
   * @param {SegmentCreateInput} segmentData
   */
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
        segmentData.color || null,
      ],
    );
    return rows[0];
  },

  /**
   * Resolves to `CustomerSegmentWithCountRow[]`.
   * @param {string} businessId
   */
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
      [businessId],
    );
    return rows;
  },

  /**
   * Resolves to `CustomerSegmentAssignmentRow | undefined` (undefined when already assigned).
   * @param {string} customerId
   * @param {string} segmentId
   * @param {boolean} [autoAssigned]
   */
  async assignCustomerToSegment(customerId, segmentId, autoAssigned = false) {
    const { rows } = await dbQuery(
      `INSERT INTO customer_segment_assignments
       (customer_id, segment_id, auto_assigned)
       VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, segment_id) DO NOTHING
       RETURNING *`,
      [customerId, segmentId, autoAssigned],
    );
    return rows[0];
  },

  /**
   * @param {string} customerId
   * @param {string} segmentId
   */
  async removeCustomerFromSegment(customerId, segmentId) {
    await dbQuery(
      `DELETE FROM customer_segment_assignments
       WHERE customer_id = $1 AND segment_id = $2`,
      [customerId, segmentId],
    );
  },

  /**
   * Resolves to `SegmentCustomerRow[]`.
   * @param {string} businessId
   * @param {string} segmentId
   * @param {number} [limit]
   * @param {number} [offset]
   */
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
      [segmentId, businessId, limit, offset],
    );
    return rows;
  },

  /**
   * Resolves to `CustomerSegmentRow[]`.
   * @param {string} businessId
   */
  async createDefaultRFMSegments(businessId) {
    /** @type {CustomerSegmentRow[]} */
    const created = [];
    for (const segmentData of DEFAULT_RFM_SEGMENTS) {
      const segment = await this.createSegment({
        business_id: businessId,
        ...segmentData,
      });
      created.push(segment);
    }
    return created;
  },
};
