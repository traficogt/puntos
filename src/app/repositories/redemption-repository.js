import { one, many, exec } from "./base.js";

export const RedemptionRepo = {
  async create({ id, business_id, branch_id, reward_id, customer_id, staff_user_id, code, points_cost, status }) {
    await exec(
      `INSERT INTO redemptions (id, business_id, branch_id, reward_id, customer_id, staff_user_id, code, points_cost, status, redeemed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())`,
      [id, business_id, branch_id ?? null, reward_id, customer_id, staff_user_id ?? null, code, points_cost, status ?? "REDEEMED"]
    );
    return this.getById(id);
  },

  async getById(id) {
    return one(`SELECT * FROM redemptions WHERE id=$1`, [id]);
  },

  async listByCustomer(customerId, limit = 50) {
    return many(
      `SELECT r.*, w.name AS reward_name
       FROM redemptions r
       JOIN rewards w ON w.id=r.reward_id
       WHERE r.customer_id=$1
       ORDER BY r.created_at DESC
       LIMIT $2`,
      [customerId, limit]
    );
  }
};
