import { exec, one, many } from "./base.js";

/**
 * Row of `background_jobs`.
 * @typedef {{
 *   id: string,
 *   business_id: string | null,
 *   job_type: string,
 *   status: string,
 *   payload: Record<string, unknown>,
 *   result: Record<string, unknown> | null,
 *   error: string | null,
 *   attempts: number,
 *   run_after: Date,
 *   locked_at: Date | null,
 *   started_at: Date | null,
 *   completed_at: Date | null,
 *   created_at: Date
 * }} BackgroundJobRow
 */

/**
 * @typedef {{
 *   id: string,
 *   business_id?: string | null,
 *   job_type: string,
 *   payload?: Record<string, unknown>,
 *   run_after?: Date | string | null
 * }} BackgroundJobCreateInput
 */

export const JobRepo = {
  /**
   * Resolves to `BackgroundJobRow | null`.
   * @param {BackgroundJobCreateInput} job
   */
  async create({ id, business_id = null, job_type, payload = {}, run_after = null }) {
    await exec(
      `INSERT INTO background_jobs (id, business_id, job_type, payload, run_after)
       VALUES ($1,$2,$3,$4,COALESCE($5, now()))`,
      [id, business_id, job_type, payload, run_after],
    );
    return this.getById(id);
  },

  /**
   * Resolves to `BackgroundJobRow | null`.
   * @param {string} id
   */
  async getById(id) {
    return one(`SELECT * FROM background_jobs WHERE id=$1`, [id]);
  },

  /**
   * Resolves to `BackgroundJobRow[]`.
   * @param {string} businessId
   * @param {number} [limit]
   */
  async listByBusiness(businessId, limit = 50) {
    return many(
      `SELECT *
       FROM background_jobs
       WHERE business_id=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      [businessId, limit],
    );
  },
};
