import { one, exec } from "./base.js";

/**
 * Row of `verify_codes`.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   phone: string,
 *   code_hash: string,
 *   expires_at: Date,
 *   failed_attempts: number,
 *   blocked_until: Date | null,
 *   last_failed_at: Date | null,
 *   created_at: Date
 * }} VerifyCodeRow
 */

export const VerifyCodeRepo = {
  /**
   * @param {{ id: string, business_id: string, phone: string, code_hash: string, expires_at: Date | string }} code
   */
  async create({ id, business_id, phone, code_hash, expires_at }) {
    // Keep request history for rate limits while invalidating superseded codes.
    await exec(
      `UPDATE verify_codes SET expires_at=LEAST(expires_at, clock_timestamp()) WHERE business_id=$1 AND phone=$2`,
      [business_id, phone],
    );
    await exec(
      `INSERT INTO verify_codes (id, business_id, phone, code_hash, expires_at) VALUES ($1,$2,$3,$4,$5)`,
      [id, business_id, phone, code_hash, expires_at],
    );
  },

  /**
   * Resolves to `VerifyCodeRow | null`.
   * @param {string} businessId
   * @param {string} phone
   */
  async latestValid(businessId, phone) {
    return one(
      `SELECT * FROM verify_codes
       WHERE business_id=$1
         AND phone=$2
         AND expires_at > clock_timestamp()
         AND failed_attempts < 5
         AND (blocked_until IS NULL OR blocked_until <= now())
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [businessId, phone],
    );
  },

  /**
   * @param {string} businessId
   * @param {string} phone
   * @param {string} interval a PostgreSQL interval literal such as `'10 minutes'`
   * @returns {Promise<number>}
   */
  async countRecent(businessId, phone, interval) {
    const r = await one(
      `SELECT COUNT(*)::int AS c
       FROM verify_codes
       WHERE business_id=$1 AND phone=$2 AND created_at >= now() - ($3)::interval`,
      [businessId, phone, interval],
    );
    return r?.c ?? 0;
  },

  /** @param {string} id */
  async deleteById(id) {
    await exec(`DELETE FROM verify_codes WHERE id=$1`, [id]);
  },

  /** @param {string} id */
  async invalidateById(id) {
    await exec(
      `UPDATE verify_codes SET expires_at=LEAST(expires_at, clock_timestamp()) WHERE id=$1`,
      [id],
    );
  },

  /**
   * @param {string} id
   * @returns {Promise<{ id: string } | null>}
   */
  async consume(id) {
    return one(
      `UPDATE verify_codes SET expires_at=clock_timestamp()
       WHERE id=$1 AND expires_at > clock_timestamp() AND failed_attempts < 5
       AND (blocked_until IS NULL OR blocked_until <= clock_timestamp()) RETURNING id`,
      [id],
    );
  },

  /** @param {string} id */
  async markFailedAttempt(id) {
    await exec(
      `UPDATE verify_codes
       SET failed_attempts = failed_attempts + 1,
           last_failed_at = now(),
           blocked_until = CASE
             WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
             ELSE blocked_until
           END
       WHERE id = $1`,
      [id],
    );
  },
};
