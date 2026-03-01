import { one, many, exec } from "./base.js";

export const TxnRepo = {
  async create({ id, business_id, branch_id, customer_id, staff_user_id, amount_q, points, source, meta }) {
    await exec(
      `INSERT INTO transactions (id, business_id, branch_id, customer_id, staff_user_id, amount_q, points, source, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, business_id, branch_id ?? null, customer_id, staff_user_id ?? null, amount_q, points, source, meta ?? {}]
    );
    return this.getById(id);
  },

  async getById(id) {
    return one(`SELECT * FROM transactions WHERE id=$1`, [id]);
  },

  async listByCustomer(customerId, limit = 50) {
    return many(
      `SELECT
         t.id,
         t.business_id,
         t.branch_id,
         t.customer_id,
         t.staff_user_id,
         t.amount_q,
         t.points AS points_delta,
         t.source,
         t.meta,
         t.created_at,
         r.name AS reward_name
       FROM transactions t
       LEFT JOIN rewards r
         ON r.id = CASE
           WHEN (t.meta->>'reward_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           THEN (t.meta->>'reward_id')::uuid
           ELSE NULL
         END
       WHERE t.customer_id=$1
       ORDER BY t.created_at DESC
       LIMIT $2`,
      [customerId, limit]
    );
  },

  async summaryByBusiness(businessId, days = 30, branchId = null) {
    const params = [businessId, String(days)];
    let branchClause = "";
    if (branchId) {
      params.push(branchId);
      branchClause = " AND branch_id = $3";
    }
    const r = await one(
      `SELECT
         COUNT(*)::int AS tx_count,
         COALESCE(SUM(amount_q),0)::numeric(10,2) AS amount_sum,
         COALESCE(SUM(points),0)::int AS points_sum
       FROM transactions
       WHERE business_id=$1 AND created_at >= now() - ($2 || ' days')::interval${branchClause}`,
      params
    );
    return r ?? { tx_count: 0, amount_sum: "0.00", points_sum: 0 };
  }
};
