import crypto from "node:crypto";

function makeId() {
  return crypto.randomUUID();
}

export const OrderReturnRepo = {
  async findByBusinessAndExternalId(client, businessId, externalReturnId) {
    const { rows } = await client.query(
      `SELECT *
       FROM order_returns
       WHERE business_id = $1
         AND external_return_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [businessId, externalReturnId]
    );
    return rows[0] ?? null;
  },

  async findByOrderId(client, orderId) {
    const { rows } = await client.query(
      `SELECT *
       FROM order_returns
       WHERE order_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [orderId]
    );
    return rows[0] ?? null;
  },

  async create(client, input) {
    const id = input.id ?? makeId();
    const { rows } = await client.query(
      `INSERT INTO order_returns
       (id, business_id, customer_id, order_id, external_return_id, external_order_id, reason, occurred_at, meta, fingerprint, reversal_transaction_id, points_effect, outcome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        id,
        input.business_id,
        input.customer_id,
        input.order_id,
        input.external_return_id,
        input.external_order_id,
        input.reason ?? null,
        input.occurred_at ?? null,
        input.meta ?? {},
        input.fingerprint,
        input.reversal_transaction_id ?? null,
        input.points_effect,
        input.outcome
      ]
    );
    return rows[0];
  }
};
