import { one, many, exec } from "./base.js";

export const CustomerRepo = {
  // ✅ Alias expected by customer-service.js
  async create({ id, business_id, phone, name }) {
    return CustomerRepo.upsertByPhone({ id, business_id, phone, name });
  },

  async upsertByPhone({ id, business_id, phone, name }) {
    // if exists, return existing
    const existing = await one(
      `SELECT * FROM customers WHERE business_id=$1 AND phone=$2 AND deleted_at IS NULL`,
      [business_id, phone]
    );
    if (existing) return existing;

    await exec(
      `INSERT INTO customers (id, business_id, phone, name) VALUES ($1,$2,$3,$4)`,
      [id, business_id, phone, name ?? null]
    );

    await exec(
      `INSERT INTO customer_balances (customer_id, points, lifetime_points)
       VALUES ($1,0,0)
       ON CONFLICT DO NOTHING`,
      [id]
    );

    return CustomerRepo.getById(id);
  },

  async getById(id) {
    return one(
      `SELECT c.*, b.points, b.lifetime_points, b.tier
              , b.pending_points
       FROM customers c
       JOIN customer_balances b ON b.customer_id=c.id
       WHERE c.id=$1 AND c.deleted_at IS NULL`,
      [id]
    );
  },

  async getByBusinessAndPhone(businessId, phone) {
    return one(
      `SELECT c.*, b.points, b.lifetime_points, b.tier
              , b.pending_points
       FROM customers c
       JOIN customer_balances b ON b.customer_id=c.id
       WHERE c.business_id=$1 AND c.phone=$2 AND c.deleted_at IS NULL`,
      [businessId, phone]
    );
  },

  async updateName(customerId, name) {
    await exec(`UPDATE customers SET name=$2 WHERE id=$1`, [customerId, name]);
    return CustomerRepo.getById(customerId);
  },

  async touchVisit(customerId) {
    await exec(`UPDATE customers SET last_visit_at=now() WHERE id=$1`, [customerId]);
  },

  async addPoints(customerId, delta) {
    await exec(
      `UPDATE customer_balances
       SET points = points + $2,
           lifetime_points = lifetime_points + GREATEST($2,0),
           updated_at=now()
       WHERE customer_id=$1`,
      [customerId, delta]
    );
  },

  async setPoints(customerId, points) {
    await exec(
      `UPDATE customer_balances SET points=$2, updated_at=now() WHERE customer_id=$1`,
      [customerId, points]
    );
  },

  async softDelete(customerId) {
    await exec(`UPDATE customers SET deleted_at=now() WHERE id=$1`, [customerId]);
  },

  async listByBusiness(businessId, limit = 200) {
    return many(
      `SELECT c.id, c.phone, c.name, c.created_at, c.last_visit_at,
              b.points, b.pending_points, b.lifetime_points
       FROM customers c
       JOIN customer_balances b ON b.customer_id=c.id
       WHERE c.business_id=$1 AND c.deleted_at IS NULL
       ORDER BY c.created_at DESC
       LIMIT $2`,
      [businessId, limit]
    );
  },
};
