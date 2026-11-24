import { one, exec } from "./base.js";

/**
 * Row of `message_logs`.
 * @typedef {{
 *   id: string,
 *   business_id: string | null,
 *   customer_id: string | null,
 *   channel: string,
 *   to_addr: string,
 *   body: string,
 *   status: string,
 *   provider_id: string | null,
 *   error: string | null,
 *   created_at: Date
 * }} MessageLogRow
 */

/**
 * @typedef {{
 *   id: string,
 *   business_id?: string | null,
 *   customer_id?: string | null,
 *   channel: string,
 *   to_addr: string,
 *   body: string,
 *   status?: string | null,
 *   provider_id?: string | null,
 *   error?: string | null
 * }} MessageLogCreateInput
 */

/**
 * @typedef {{ status: string, provider_id?: string | null, error?: string | null }} MessageLogStatusPatch
 */

export const MessageLogRepo = {
  /**
   * Resolves to `MessageLogRow | null`.
   * @param {MessageLogCreateInput} message
   */
  async create({
    id,
    business_id,
    customer_id,
    channel,
    to_addr,
    body,
    status,
    provider_id,
    error,
  }) {
    await exec(
      `INSERT INTO message_logs (id, business_id, customer_id, channel, to_addr, body, status, provider_id, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        business_id,
        customer_id ?? null,
        channel,
        to_addr,
        body,
        status ?? "QUEUED",
        provider_id ?? null,
        error ?? null,
      ],
    );
    return this.getById(id);
  },

  /**
   * Resolves to `MessageLogRow | null`.
   * @param {string} id
   */
  async getById(id) {
    return one(`SELECT * FROM message_logs WHERE id=$1`, [id]);
  },

  /**
   * @param {string} id
   * @param {MessageLogStatusPatch} patch
   */
  async updateStatus(id, { status, provider_id, error }) {
    await exec(`UPDATE message_logs SET status=$2, provider_id=$3, error=$4 WHERE id=$1`, [
      id,
      status,
      provider_id ?? null,
      error ?? null,
    ]);
  },

  /**
   * Writes through the privileged `app.security_message_log_create` function
   * (security messages are not tenant-scoped).
   * Resolves to `Omit<MessageLogRow, "created_at">`.
   * @param {MessageLogCreateInput} message
   */
  async createSecurity({
    id,
    business_id,
    customer_id,
    channel,
    to_addr,
    body,
    status,
    provider_id,
    error,
  }) {
    await exec(`SELECT app.security_message_log_create($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
      id,
      business_id ?? null,
      customer_id ?? null,
      channel,
      to_addr,
      body,
      status ?? "QUEUED",
      provider_id ?? null,
      error ?? null,
    ]);
    return {
      id,
      business_id: business_id ?? null,
      customer_id: customer_id ?? null,
      channel,
      to_addr,
      body,
      status: status ?? "QUEUED",
      provider_id: provider_id ?? null,
      error: error ?? null,
    };
  },

  /**
   * @param {string} id
   * @param {MessageLogStatusPatch} patch
   */
  async updateSecurityStatus(id, { status, provider_id, error }) {
    await exec(`SELECT app.security_message_log_update_status($1,$2,$3,$4)`, [
      id,
      status,
      provider_id ?? null,
      error ?? null,
    ]);
  },
};
