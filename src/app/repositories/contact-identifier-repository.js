import crypto from "node:crypto";

/** @typedef {import("./base.js").DbClient} DbClient */

/**
 * Row of `contact_identifiers`.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   customer_id: string,
 *   identifier_type: string,
 *   identifier_value: string,
 *   label: string | null,
 *   active: boolean,
 *   meta: Record<string, unknown>,
 *   created_at: Date,
 *   updated_at: Date
 * }} ContactIdentifierRow
 */

/**
 * @typedef {{
 *   id?: string,
 *   business_id: string,
 *   customer_id: string,
 *   identifier_type: string,
 *   identifier_value: string,
 *   label?: string | null,
 *   active?: boolean,
 *   meta?: Record<string, unknown>
 * }} ContactIdentifierCreateInput
 */

function makeId() {
  return crypto.randomUUID();
}

/**
 * @param {string | null | undefined} identifierValue
 * @returns {string | null | undefined}
 */
function normalizeIdentifierValue(identifierValue) {
  if (identifierValue == null) return identifierValue;
  return String(identifierValue).trim();
}

export const ContactIdentifierRepo = {
  /**
   * Resolves to `ContactIdentifierRow`.
   * @param {DbClient} client
   * @param {ContactIdentifierCreateInput} input
   */
  async create(client, input) {
    const id = input.id ?? makeId();
    const identifierValue = normalizeIdentifierValue(input.identifier_value);
    const { rows } = await client.query(
      `INSERT INTO contact_identifiers
       (id, business_id, customer_id, identifier_type, identifier_value, label, active, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        id,
        input.business_id,
        input.customer_id,
        input.identifier_type,
        identifierValue,
        input.label ?? null,
        input.active ?? true,
        input.meta ?? {},
      ],
    );
    return rows[0];
  },

  /**
   * Resolves to `ContactIdentifierRow | null`.
   * @param {DbClient} client
   * @param {string} businessId
   * @param {string} identifierType
   * @param {string} identifierValue
   */
  async getByBusinessTypeAndValue(client, businessId, identifierType, identifierValue) {
    const { rows } = await client.query(
      `SELECT *
       FROM contact_identifiers
       WHERE business_id = $1
         AND identifier_type = $2
         AND identifier_value = $3
         AND active = true
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [businessId, identifierType, normalizeIdentifierValue(identifierValue)],
    );
    return rows[0] ?? null;
  },

  /**
   * Resolves to `ContactIdentifierRow | null`.
   * @param {DbClient} client
   * @param {string} businessId
   * @param {string} identifierType
   * @param {string} identifierValue
   */
  async getAnyByBusinessTypeAndValue(client, businessId, identifierType, identifierValue) {
    const { rows } = await client.query(
      `SELECT *
       FROM contact_identifiers
       WHERE business_id = $1
         AND identifier_type = $2
         AND identifier_value = $3
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [businessId, identifierType, normalizeIdentifierValue(identifierValue)],
    );
    return rows[0] ?? null;
  },

  /**
   * Resolves to `ContactIdentifierRow[]`.
   * @param {DbClient} client
   * @param {string} businessId
   * @param {string} customerId
   */
  async listByCustomer(client, businessId, customerId) {
    const { rows } = await client.query(
      `SELECT *
       FROM contact_identifiers
       WHERE business_id = $1
         AND customer_id = $2
       ORDER BY created_at DESC`,
      [businessId, customerId],
    );
    return rows;
  },

  /**
   * Resolves to `ContactIdentifierRow | null`.
   * @param {DbClient} client
   * @param {string} businessId
   * @param {string} identifierType
   * @param {string} identifierValue
   */
  async deactivate(client, businessId, identifierType, identifierValue) {
    const { rows } = await client.query(
      `WITH target AS (
         SELECT id
         FROM contact_identifiers
         WHERE business_id = $1
           AND identifier_type = $2
           AND identifier_value = $3
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       )
       UPDATE contact_identifiers
       SET active = false,
           updated_at = now()
       WHERE id IN (SELECT id FROM target)
       RETURNING *`,
      [businessId, identifierType, normalizeIdentifierValue(identifierValue)],
    );
    return rows[0] ?? null;
  },
};
