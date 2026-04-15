import crypto from "node:crypto";

function makeId() {
  return crypto.randomUUID();
}

function normalizeIdentifierValue(identifierValue) {
  if (identifierValue == null) return identifierValue;
  return String(identifierValue).trim();
}

export const ContactIdentifierRepo = {
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
        JSON.stringify(input.meta ?? {})
      ]
    );
    return rows[0];
  },

  async getByBusinessTypeAndValue(client, businessId, identifierType, identifierValue) {
    const { rows } = await client.query(
      `SELECT *
       FROM contact_identifiers
       WHERE business_id = $1
         AND identifier_type = $2
         AND identifier_value = $3
       LIMIT 1`,
      [businessId, identifierType, normalizeIdentifierValue(identifierValue)]
    );
    return rows[0] ?? null;
  },

  async listByCustomer(client, customerId) {
    const { rows } = await client.query(
      `SELECT *
       FROM contact_identifiers
       WHERE customer_id = $1
       ORDER BY created_at DESC`,
      [customerId]
    );
    return rows;
  },

  async deactivate(client, businessId, identifierType, identifierValue) {
    const { rows } = await client.query(
      `UPDATE contact_identifiers
       SET active = false,
           updated_at = now()
       WHERE business_id = $1
         AND identifier_type = $2
         AND identifier_value = $3
       RETURNING *`,
      [businessId, identifierType, normalizeIdentifierValue(identifierValue)]
    );
    return rows[0] ?? null;
  }
};
