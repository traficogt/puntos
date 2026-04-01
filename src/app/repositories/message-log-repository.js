import { one, exec } from "./base.js";

export const MessageLogRepo = {
  async create({ id, business_id, customer_id, channel, to_addr, body, status, provider_id, error }) {
    await exec(
      `INSERT INTO message_logs (id, business_id, customer_id, channel, to_addr, body, status, provider_id, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, business_id, customer_id ?? null, channel, to_addr, body, status ?? "QUEUED", provider_id ?? null, error ?? null]
    );
    return this.getById(id);
  },

  async getById(id) {
    return one(`SELECT * FROM message_logs WHERE id=$1`, [id]);
  },

  async updateStatus(id, { status, provider_id, error }) {
    await exec(
      `UPDATE message_logs SET status=$2, provider_id=$3, error=$4 WHERE id=$1`,
      [id, status, provider_id ?? null, error ?? null]
    );
  },

  async createSecurity({ id, business_id, customer_id, channel, to_addr, body, status, provider_id, error }) {
    await exec(
      `SELECT app.security_message_log_create($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, business_id ?? null, customer_id ?? null, channel, to_addr, body, status ?? "QUEUED", provider_id ?? null, error ?? null]
    );
    return { id, business_id: business_id ?? null, customer_id: customer_id ?? null, channel, to_addr, body, status: status ?? "QUEUED", provider_id: provider_id ?? null, error: error ?? null };
  },

  async updateSecurityStatus(id, { status, provider_id, error }) {
    await exec(
      `SELECT app.security_message_log_update_status($1,$2,$3,$4)`,
      [id, status, provider_id ?? null, error ?? null]
    );
  }
};
