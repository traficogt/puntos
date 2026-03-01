import { one, many, exec } from "./base.js";

export const StaffRepo = {
  async create({ id, business_id, branch_id, name, email, phone, role, password_hash }) {
    await exec(
      `INSERT INTO staff_users (id, business_id, branch_id, name, email, phone, role, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, business_id, branch_id ?? null, name, email ?? null, phone ?? null, role, password_hash]
    );
    return this.getById(id);
  },

  async getById(id) {
    return one(`SELECT * FROM staff_users WHERE id=$1`, [id]);
  },

  async getByEmail(email) {
    const normalized = String(email || "").toLowerCase();
    if (!normalized) return null;
    // staff_users is strict-tenant RLS; login requires cross-tenant lookup.
    return one(`SELECT * FROM app.staff_login_lookup($1)`, [normalized]);
  },

  async listByBusiness(businessId) {
    return many(`SELECT id, business_id, branch_id, name, email, phone, role, active, can_manage_gift_cards, created_at
                 FROM staff_users WHERE business_id=$1 ORDER BY created_at DESC`, [businessId]);
  }
};
