import { exec, one, many } from "./base.js";

export const JobRepo = {
  async create({ id, business_id = null, job_type, payload = {}, run_after = null }) {
    await exec(
      `INSERT INTO background_jobs (id, business_id, job_type, payload, run_after)
       VALUES ($1,$2,$3,$4,COALESCE($5, now()))`,
      [id, business_id, job_type, payload, run_after]
    );
    return this.getById(id);
  },

  async getById(id) {
    return one(`SELECT * FROM background_jobs WHERE id=$1`, [id]);
  },

  async listByBusiness(businessId, limit = 50) {
    return many(
      `SELECT *
       FROM background_jobs
       WHERE business_id=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      [businessId, limit]
    );
  }
};
