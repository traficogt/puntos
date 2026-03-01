import { one, exec } from "./base.js";

export const VerifyCodeRepo = {
  async create({ id, business_id, phone, code_hash, expires_at }) {
    // Keep only one live code per phone/business to simplify lockout checks.
    await exec(`DELETE FROM verify_codes WHERE business_id=$1 AND phone=$2`, [business_id, phone]);
    await exec(
      `INSERT INTO verify_codes (id, business_id, phone, code_hash, expires_at) VALUES ($1,$2,$3,$4,$5)`,
      [id, business_id, phone, code_hash, expires_at]
    );
  },

  async latestValid(businessId, phone) {
    return one(
      `SELECT * FROM verify_codes
       WHERE business_id=$1
         AND phone=$2
         AND expires_at > now()
         AND failed_attempts < 5
         AND (blocked_until IS NULL OR blocked_until <= now())
       ORDER BY created_at DESC LIMIT 1`,
      [businessId, phone]
    );
  },

  async countRecent(businessId, phone, interval) {
    const r = await one(
      `SELECT COUNT(*)::int AS c
       FROM verify_codes
       WHERE business_id=$1 AND phone=$2 AND created_at >= now() - ($3)::interval`,
      [businessId, phone, interval]
    );
    return r?.c ?? 0;
  },

  async deleteById(id) {
    await exec(`DELETE FROM verify_codes WHERE id=$1`, [id]);
  },

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
      [id]
    );
  }
};
