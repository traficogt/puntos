import { exec, many } from "./base.js";

export const BillingRepo = {
  async recordEvent({ id, business_id, event_type, amount = 0, unit = "count", metadata = {} }) {
    await exec(
      `INSERT INTO billing_events (id, business_id, event_type, amount, unit, metadata)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, business_id, event_type, amount, unit, metadata]
    );
  },

  async recentByBusiness(businessId, limit = 100) {
    return many(
      `SELECT * FROM billing_events
       WHERE business_id=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      [businessId, limit]
    );
  }
};
