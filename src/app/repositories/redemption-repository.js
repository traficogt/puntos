import { one, many, exec } from "./base.js";

/**
 * Row of `redemptions`.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   branch_id: string | null,
 *   reward_id: string,
 *   customer_id: string,
 *   staff_user_id: string | null,
 *   request_id: string | null,
 *   code: string,
 *   points_cost: number,
 *   balance_after: number | null,
 *   status: string,
 *   created_at: Date,
 *   redeemed_at: Date | null
 * }} RedemptionRow
 */

/**
 * Redemption joined with the reward name ({@link RedemptionRepo.listByCustomer}).
 * @typedef {RedemptionRow & { reward_name: string }} RedemptionWithRewardRow
 */

/**
 * Customer-facing history projection ({@link RedemptionRepo.listCustomerHistory}).
 * @typedef {Omit<RedemptionWithRewardRow, "staff_user_id" | "request_id" | "balance_after">} RedemptionHistoryRow
 */

/**
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   branch_id?: string | null,
 *   reward_id: string,
 *   customer_id: string,
 *   staff_user_id?: string | null,
 *   code: string,
 *   points_cost: number,
 *   status?: string | null
 * }} RedemptionCreateInput
 */

export const RedemptionRepo = {
  /**
   * Resolves to `RedemptionRow | null`.
   * @param {RedemptionCreateInput} redemption
   */
  async create({
    id,
    business_id,
    branch_id,
    reward_id,
    customer_id,
    staff_user_id,
    code,
    points_cost,
    status,
  }) {
    await exec(
      `INSERT INTO redemptions (id, business_id, branch_id, reward_id, customer_id, staff_user_id, code, points_cost, status, redeemed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
      [
        id,
        business_id,
        branch_id ?? null,
        reward_id,
        customer_id,
        staff_user_id ?? null,
        code,
        points_cost,
        status ?? "REDEEMED",
      ],
    );
    return this.getById(id);
  },

  /**
   * Resolves to `RedemptionRow | null`.
   * @param {string} id
   */
  async getById(id) {
    return one(`SELECT * FROM redemptions WHERE id=$1`, [id]);
  },

  /**
   * Resolves to `RedemptionWithRewardRow[]`.
   * @param {string} customerId
   * @param {number} [limit]
   */
  async listByCustomer(customerId, limit = 50) {
    return many(
      `SELECT r.*, w.name AS reward_name
       FROM redemptions r
       JOIN rewards w ON w.id=r.reward_id
       WHERE r.customer_id=$1
       ORDER BY r.created_at DESC
       LIMIT $2`,
      [customerId, limit],
    );
  },

  /**
   * Resolves to `RedemptionHistoryRow[]`.
   * @param {string} businessId
   * @param {string} customerId
   * @param {number} [limit]
   */
  async listCustomerHistory(businessId, customerId, limit = 50) {
    return many(
      `SELECT r.id,r.business_id,r.branch_id,r.reward_id,r.customer_id,
      r.code,r.points_cost,r.status,r.created_at,r.redeemed_at,w.name AS reward_name
      FROM redemptions r JOIN rewards w ON w.id=r.reward_id AND w.business_id=r.business_id
      WHERE r.business_id=$1 AND r.customer_id=$2
      ORDER BY r.created_at DESC,r.id DESC LIMIT $3`,
      [businessId, customerId, limit],
    );
  },
};
