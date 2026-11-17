import { dbQuery } from "../database.js";
import { config } from "../../config/index.js";

function baseRecord() {
  return {
    email: String(config.SUPER_ADMIN_EMAIL || "").toLowerCase() || null,
    password_hash: config.SUPER_ADMIN_PASSWORD_HASH || null,
    mfa_enabled: false,
    mfa_secret_enc: null,
    mfa_pending_secret_enc: null,
    mfa_pending_created_at: null,
    mfa_confirmed_at: null,
    mfa_last_totp_step: null
  };
}

export const SuperAdminAuthRepo = {
  async getEffective(query = dbQuery) {
    const { rows } = await query(
      `SELECT email, password_hash, mfa_enabled, mfa_secret_enc, mfa_pending_secret_enc, mfa_pending_created_at, mfa_confirmed_at, mfa_last_totp_step
         FROM super_admin_auth_settings
        WHERE singleton = true
        LIMIT 1`
    );
    const row = rows[0] || {};
    return {
      ...baseRecord(),
      ...row,
      email: String(row.email || config.SUPER_ADMIN_EMAIL || "").toLowerCase() || null,
      password_hash: row.password_hash || config.SUPER_ADMIN_PASSWORD_HASH || null
    };
  },

  /** Locks the settings row (creating it if absent) for a security change. */
  async lockForUpdate(query = dbQuery) {
    await query(
      `INSERT INTO super_admin_auth_settings (singleton)
       VALUES (true)
       ON CONFLICT (singleton) DO NOTHING`
    );
    await query(`SELECT singleton FROM super_admin_auth_settings WHERE singleton = true FOR UPDATE`);
    return this.getEffective(query);
  },

  /** Records an accepted TOTP step; false when that step (or a later one) was already used. */
  async consumeTotpStep(step, query = dbQuery) {
    const { rowCount } = await query(
      `UPDATE super_admin_auth_settings
          SET mfa_last_totp_step = $1,
              updated_at = now()
        WHERE singleton = true
          AND (mfa_last_totp_step IS NULL OR mfa_last_totp_step < $1)`,
      [step]
    );
    return rowCount === 1;
  },

  async update(fields, query = dbQuery) {
    const assignments = [];
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
       ON CONFLICT (singleton) DO NOTHING`
    );
    await query(
      `UPDATE super_admin_auth_settings
          SET ${assignments.join(", ")},
              updated_at = now()
        WHERE singleton = $${idx}`,
      params
    );
    return this.getEffective(query);
  }
};
