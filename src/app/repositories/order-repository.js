import crypto from "node:crypto";

/** @typedef {import("./base.js").DbClient} DbClient */

/**
 * Row of `orders`. Money columns are NUMERIC and arrive as strings.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   customer_id: string,
 *   external_order_id: string,
 *   status: string,
 *   amount_q: string,
 *   subtotal_q: string | null,
 *   discount_q: string | null,
 *   tax_q: string | null,
 *   currency: string,
 *   occurred_at: Date | null,
 *   source: string,
 *   line_items_json: unknown[],
 *   meta: Record<string, unknown>,
 *   fingerprint: string,
 *   transaction_id: string | null,
 *   points_awarded: number,
 *   transaction_status: string | null,
 *   created_at: Date,
 *   updated_at: Date
 * }} OrderRow
 */

/**
 * Idempotency projection returned by {@link OrderRepo.findByBusinessAndExternalId}.
 * @typedef {Pick<OrderRow,
 *   | "id" | "business_id" | "customer_id" | "external_order_id" | "fingerprint"
 *   | "transaction_id" | "points_awarded" | "transaction_status">} OrderLookupRow
 */

/**
 * Projection returned by {@link OrderRepo.findDetailedByBusinessAndExternalId}.
 * @typedef {Omit<OrderLookupRow, "fingerprint">} OrderDetailRow
 */

/**
 * @typedef {{
 *   id?: string,
 *   business_id: string,
 *   customer_id: string,
 *   external_order_id: string,
 *   status: string,
 *   amount_q: number | string,
 *   subtotal_q?: number | string | null,
 *   discount_q?: number | string | null,
 *   tax_q?: number | string | null,
 *   currency: string,
 *   occurred_at?: Date | string | null,
 *   source?: string,
 *   line_items_json?: unknown[],
 *   meta?: Record<string, unknown>,
 *   fingerprint: string,
 *   transaction_id?: string | null,
 *   points_awarded?: number,
 *   transaction_status?: string | null
 * }} OrderCreateInput
 */

function makeId() {
  return crypto.randomUUID();
}

export const OrderRepo = {
  /**
   * Resolves to `OrderLookupRow | null`.
   * @param {DbClient} client
   * @param {string} businessId
   * @param {string} externalOrderId
   */
  async findByBusinessAndExternalId(client, businessId, externalOrderId) {
    const { rows } = await client.query(
      `SELECT id, business_id, customer_id, external_order_id, fingerprint, transaction_id, points_awarded, transaction_status
       FROM orders
       WHERE business_id = $1 AND external_order_id = $2
       LIMIT 1`,
      [businessId, externalOrderId],
    );
    return rows[0] ?? null;
  },

  /**
   * Resolves to `OrderDetailRow | null`.
   * @param {DbClient} client
   * @param {string} businessId
   * @param {string} externalOrderId
   */
  async findDetailedByBusinessAndExternalId(client, businessId, externalOrderId) {
    const { rows } = await client.query(
      `SELECT id, business_id, customer_id, external_order_id, transaction_id, points_awarded, transaction_status
       FROM orders
       WHERE business_id = $1 AND external_order_id = $2
       LIMIT 1`,
      [businessId, externalOrderId],
    );
    return rows[0] ?? null;
  },

  /**
   * Resolves to `OrderRow`.
   * @param {DbClient} client
   * @param {OrderCreateInput} input
   */
  async create(client, input) {
    const id = input.id ?? makeId();
    const { rows } = await client.query(
      `INSERT INTO orders
       (id, business_id, customer_id, external_order_id, status, amount_q, subtotal_q, discount_q, tax_q, currency, occurred_at, source, line_items_json, meta, fingerprint, transaction_id, points_awarded, transaction_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        id,
        input.business_id,
        input.customer_id,
        input.external_order_id,
        input.status,
        input.amount_q,
        input.subtotal_q,
        input.discount_q,
        input.tax_q,
        input.currency,
        input.occurred_at,
        input.source ?? "api",
        JSON.stringify(input.line_items_json ?? []),
        JSON.stringify(input.meta ?? {}),
        input.fingerprint,
        input.transaction_id ?? null,
        input.points_awarded ?? 0,
        input.transaction_status ?? null,
      ],
    );
    return rows[0];
  },
};
