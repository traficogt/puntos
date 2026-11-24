import { exec, many } from "./base.js";

/**
 * Row of `billing_events`. `amount` is NUMERIC and arrives as a string.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   event_type: string,
 *   amount: string,
 *   unit: string,
 *   metadata: Record<string, unknown>,
 *   created_at: Date
 * }} BillingEventRow
 */

/**
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   event_type: string,
 *   amount?: number,
 *   unit?: string,
 *   metadata?: Record<string, unknown>
 * }} BillingEventInput
 */

export const BillingRepo = {
  /** @param {BillingEventInput} event */
  async recordEvent({ id, business_id, event_type, amount = 0, unit = "count", metadata = {} }) {
    await exec(
      `INSERT INTO billing_events (id, business_id, event_type, amount, unit, metadata)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, business_id, event_type, amount, unit, metadata],
    );
  },

  /**
   * Resolves to `BillingEventRow[]`.
   * @param {string} businessId
   * @param {number} [limit]
   */
  async recentByBusiness(businessId, limit = 100) {
    return many(
      `SELECT * FROM billing_events
       WHERE business_id=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      [businessId, limit],
    );
  },
};
