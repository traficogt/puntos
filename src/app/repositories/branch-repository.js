import { one, many, exec } from "./base.js";

export const BranchRepo = {
  async create({ id, business_id, name, address, code }) {
    await exec(
      `INSERT INTO branches (id, business_id, name, address, code) VALUES ($1,$2,$3,$4,$5)`,
      [id, business_id, name, address ?? null, code]
    );
    return this.getById(id);
  },

  async getById(id) {
    return one(`SELECT * FROM branches WHERE id=$1`, [id]);
  },

  async listByBusiness(businessId) {
    return many(`SELECT * FROM branches WHERE business_id=$1 ORDER BY created_at DESC`, [businessId]);
  },

  async getByCode(code) {
    return one(`SELECT * FROM branches WHERE code=$1`, [code]);
  }
};
