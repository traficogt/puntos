import { one, exec } from "./base.js";

export const QrTokenRepo = {
  async markUsed({ jti, business_id, customer_id, expires_at }) {
    // replay protection: jti is PK
    await exec(
      `INSERT INTO qr_tokens (jti, business_id, customer_id, expires_at) VALUES ($1,$2,$3, to_timestamp($4))
       ON CONFLICT (jti) DO NOTHING`,
      [jti, business_id, customer_id, expires_at]
    );
    const r = await one(`SELECT * FROM qr_tokens WHERE jti=$1`, [jti]);
    return r;
  },

  async wasUsed(jti) {
    const r = await one(`SELECT jti FROM qr_tokens WHERE jti=$1`, [jti]);
    return !!r;
  }
};
