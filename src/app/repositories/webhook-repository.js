import { one, many, exec } from "./base.js";
import { encryptSecret, rotateSecretToCurrent } from "../../utils/secret-crypto.js";

/**
 * Row of `webhook_endpoints`. `secret` is stored encrypted (`enc:v2:` prefix).
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   url: string,
 *   secret: string,
 *   events: string[],
 *   active: boolean,
 *   created_at: Date
 * }} WebhookEndpointRow
 */

/**
 * Row of `webhook_deliveries`.
 * @typedef {{
 *   id: string,
 *   endpoint_id: string,
 *   event: string,
 *   payload: Record<string, unknown>,
 *   status: string,
 *   attempts: number,
 *   last_error: string | null,
 *   created_at: Date,
 *   sent_at: Date | null
 * }} WebhookDeliveryRow
 */

/**
 * A delivery claimed for sending, joined with its endpoint ({@link WebhookRepo.claimPending}).
 * @typedef {Pick<WebhookDeliveryRow, "id" | "endpoint_id" | "event" | "payload" | "attempts">
 *   & Pick<WebhookEndpointRow, "url" | "secret" | "business_id">} WebhookDeliveryClaimRow
 */

/**
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   url: string,
 *   secret: string,
 *   events?: string[] | null,
 *   active?: boolean | null
 * }} WebhookEndpointCreateInput
 */

export const WebhookRepo = {
  /**
   * Resolves to `WebhookEndpointRow | null`.
   * @param {WebhookEndpointCreateInput} endpoint
   */
  async createEndpoint({ id, business_id, url, secret, events, active }) {
    const storedSecret = encryptSecret(secret);
    await exec(
      `INSERT INTO webhook_endpoints (id, business_id, url, secret, events, active)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, business_id, url, storedSecret, JSON.stringify(events ?? []), active ?? true],
    );
    return this.getEndpoint(id);
  },

  async encryptPlaintextSecrets() {
    /** @type {Pick<WebhookEndpointRow, "id" | "secret">[]} */
    const rows = await many(
      `SELECT id, secret
       FROM webhook_endpoints
       WHERE secret IS NOT NULL
         AND secret NOT LIKE 'enc:v1:%'
         AND secret NOT LIKE 'enc:v2:%'`,
    );
    let updated = 0;
    for (const row of rows) {
      const encrypted = encryptSecret(row.secret);
      if (encrypted === row.secret) continue;
      await exec(`UPDATE webhook_endpoints SET secret = $2 WHERE id = $1`, [row.id, encrypted]);
      updated += 1;
    }
    return updated;
  },

  async rotateSecretsToCurrentKey() {
    /** @type {Pick<WebhookEndpointRow, "id" | "secret">[]} */
    const rows = await many(
      `SELECT id, secret
       FROM webhook_endpoints
       WHERE secret IS NOT NULL`,
    );
    let rotated = 0;
    for (const row of rows) {
      const next = rotateSecretToCurrent(row.secret);
      if (next === row.secret) continue;
      await exec(`UPDATE webhook_endpoints SET secret = $2 WHERE id = $1`, [row.id, next]);
      rotated += 1;
    }
    return rotated;
  },

  /**
   * Resolves to `WebhookEndpointRow[]`.
   * @param {string} businessId
   */
  async listEndpoints(businessId) {
    return many(`SELECT * FROM webhook_endpoints WHERE business_id=$1 ORDER BY created_at DESC`, [
      businessId,
    ]);
  },

  /**
   * Resolves to `WebhookEndpointRow | null`.
   * @param {string} id
   */
  async getEndpoint(id) {
    return one(`SELECT * FROM webhook_endpoints WHERE id=$1`, [id]);
  },

  /** @param {{ id: string, endpoint_id: string, event: string, payload: unknown }} delivery */
  async enqueueDelivery({ id, endpoint_id, event, payload }) {
    await exec(
      `INSERT INTO webhook_deliveries (id, endpoint_id, event, payload) VALUES ($1,$2,$3,$4)`,
      [id, endpoint_id, event, JSON.stringify(payload)],
    );
  },

  /**
   * Resolves to `WebhookDeliveryClaimRow[]`.
   * @param {number} [limit]
   * @param {number} [maxAttempts]
   */
  async claimPending(limit = 20, maxAttempts = 3) {
    return many(
      `WITH c AS (
	         SELECT d.id, e.url, e.secret, e.business_id, d.event, d.payload
	         FROM webhook_deliveries d
	         JOIN webhook_endpoints e ON e.id=d.endpoint_id
	         WHERE d.status='PENDING'
	           AND d.attempts < $2
	           AND e.active=true
         ORDER BY d.created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
	       UPDATE webhook_deliveries d
	       SET status='SENDING'
	       FROM c
	       WHERE d.id=c.id
	       RETURNING d.id, d.endpoint_id, d.event, d.payload, d.attempts, c.url, c.secret, c.business_id`,
      [limit, maxAttempts],
    );
  },

  /** @param {string} id */
  async markSent(id) {
    await exec(`UPDATE webhook_deliveries SET status='SENT', sent_at=now() WHERE id=$1`, [id]);
  },

  /**
   * @param {string} id
   * @param {string | null} error
   * @param {number} [maxAttempts]
   */
  async recordFailure(id, error, maxAttempts = 3) {
    await exec(
      `UPDATE webhook_deliveries
       SET attempts = attempts + 1,
           last_error = $2,
           status = CASE WHEN attempts + 1 >= $3 THEN 'FAILED' ELSE 'PENDING' END
       WHERE id=$1`,
      [id, error, maxAttempts],
    );
  },
};
