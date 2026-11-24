import { dbQuery } from "../database.js";
import { config } from "../../config/index.js";

/**
 * Effective super-admin credentials: the `super_admin_auth_settings` singleton
 * row merged over the environment defaults.
 * @typedef {{
 *   email: string | null,
 *   password_hash: string | null,
 *   mfa_enabled: boolean,
 *   mfa_secret_enc: string | null,
 *   mfa_pending_secret_enc: string | null,
 *   mfa_pending_created_at: Date | null,
 *   mfa_confirmed_at: Date | null
 * }} SuperAdminAuthRow
 */

/**
 * Column assignments accepted by {@link SuperAdminAuthRepo.update}; callers pass
 * timestamps as ISO strings, which PostgreSQL casts on write.
 * @typedef {Partial<Pick<SuperAdminAuthRow,
 *   "email" | "password_hash" | "mfa_enabled" | "mfa_secret_enc" | "mfa_pending_secret_enc">>
 *   & { mfa_pending_created_at?: Date | string | null, mfa_confirmed_at?: Date | string | null }} SuperAdminAuthPatch
 */

/** @returns {SuperAdminAuthRow} */
function baseRecord() {
  return {
    email: String(config.SUPER_ADMIN_EMAIL || "").toLowerCase() || null,
    password_hash: config.SUPER_ADMIN_PASSWORD_HASH || null,
    mfa_enabled: false,
    mfa_secret_enc: null,
    mfa_pending_secret_enc: null,
    mfa_pending_created_at: null,
    mfa_confirmed_at: null,
  };
}

export const SuperAdminAuthRepo = {
  /**
   * Resolves to `SuperAdminAuthRow`.
   * @param {typeof dbQuery} [query]
   */
  async getEffective(query = dbQuery) {
    const { rows } = await query(
      `SELECT email, password_hash, mfa_enabled, mfa_secret_enc, mfa_pending_secret_enc, mfa_pending_created_at, mfa_confirmed_at
         FROM super_admin_auth_settings
        WHERE singleton = true
        LIMIT 1`,
    );
    const row = rows[0] || {};
    return {
      ...baseRecord(),
      ...row,
      email: String(row.email || config.SUPER_ADMIN_EMAIL || "").toLowerCase() || null,
      password_hash: row.password_hash || config.SUPER_ADMIN_PASSWORD_HASH || null,
    };
  },

  /**
   * Resolves to `SuperAdminAuthRow`.
   * @param {SuperAdminAuthPatch} fields column assignments for the singleton row
   * @param {typeof dbQuery} [query]
   */
  async update(fields, query = dbQuery) {
    /** @type {string[]} */
    const assignments = [];
    /** @type {unknown[]} */
    const params = [];
    let idx = 1;
    for (const [key, value] of Object.entries(fields || {})) {
      assignments.push(`${key} = $${idx++}`);
      params.push(value);
    }
    if (!assignments.length) return this.getEffective(query);
    params.push(true);
    await query(
      `INSERT INTO super_admin_auth_settings (singleton)
       VALUES (true)
       ON CONFLICT (singleton) DO NOTHING`,
    );
    await query(
      `UPDATE super_admin_auth_settings
          SET ${assignments.join(", ")},
              updated_at = now()
        WHERE singleton = $${idx}`,
      params,
    );
    return this.getEffective(query);
  },
};
