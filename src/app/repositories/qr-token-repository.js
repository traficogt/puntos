import { one, exec } from "./base.js";

/**
 * Row of `qr_tokens` (one row per consumed QR `jti`).
 * @typedef {{
 *   jti: string,
 *   business_id: string,
 *   customer_id: string,
 *   expires_at: Date,
 *   used_at: Date
 * }} QrTokenRow
 */

export const QrTokenRepo = {
  /**
   * `expires_at` is the JWT `exp` claim in epoch seconds (bound through `to_timestamp`).
   * Resolves to `QrTokenRow | null`.
   * @param {{ jti: string, business_id: string, customer_id: string, expires_at: number }} token
   */
  async markUsed({ jti, business_id, customer_id, expires_at }) {
    // replay protection: jti is PK
    await exec(
      `INSERT INTO qr_tokens (jti, business_id, customer_id, expires_at) VALUES ($1,$2,$3, to_timestamp($4))
       ON CONFLICT (jti) DO NOTHING`,
      [jti, business_id, customer_id, expires_at],
    );
    const r = await one(`SELECT * FROM qr_tokens WHERE jti=$1`, [jti]);
    return r;
  },

  /** @param {string} jti */
  async wasUsed(jti) {
    const r = await one(`SELECT jti FROM qr_tokens WHERE jti=$1`, [jti]);
    return !!r;
  },
};
