import { one, many, exec } from "./base.js";
import { encryptSecret, rotateSecretToCurrent } from "../../utils/secret-crypto.js";

export const WebhookRepo = {
  async createEndpoint({ id, business_id, url, secret, events, active }) {
    const storedSecret = encryptSecret(secret);
    await exec(
      `INSERT INTO webhook_endpoints (id, business_id, url, secret, events, active)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, business_id, url, storedSecret, JSON.stringify(events ?? []), active ?? true]
    );
    return this.getEndpoint(id);
  },

  async encryptPlaintextSecrets() {
    const rows = await many(
      `SELECT id, secret
       FROM webhook_endpoints
       WHERE secret IS NOT NULL
         AND secret NOT LIKE 'enc:v1:%'
         AND secret NOT LIKE 'enc:v2:%'`
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
    const rows = await many(
      `SELECT id, secret
       FROM webhook_endpoints
       WHERE secret IS NOT NULL`
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

  async listEndpoints(businessId) {
    return many(`SELECT * FROM webhook_endpoints WHERE business_id=$1 ORDER BY created_at DESC`, [businessId]);
  },

  async getEndpoint(id) {
    return one(`SELECT * FROM webhook_endpoints WHERE id=$1`, [id]);
  },

  async enqueueDelivery({ id, endpoint_id, event, payload }) {
    await exec(
      `INSERT INTO webhook_deliveries (id, endpoint_id, event, payload) VALUES ($1,$2,$3,$4)`,
      [id, endpoint_id, event, JSON.stringify(payload)]
    );
  },

  /**
   * Claims deliveries for one worker. A claim is a lease: rows left in SENDING by
   * a crash or deploy become claimable again after `leaseSeconds`, with a new
   * claim token so the abandoned worker can no longer change them.
   */
  async claimPending(limit = 20, maxAttempts = 3, leaseSeconds = 300) {
    const lease = Math.max(30, Math.trunc(Number(leaseSeconds)) || 300);
    // Claims made before claimed_at existed (or by a not-yet-upgraded worker)
    // start their lease now instead of being reclaimed while still in flight.
    await exec(`UPDATE webhook_deliveries SET claimed_at=now() WHERE status='SENDING' AND claimed_at IS NULL`);
    // An expired claim counts as an attempt; the delivery may or may not have
    // reached the receiver. Rows out of attempts stop instead of looping.
    await exec(
      `UPDATE webhook_deliveries
       SET status='FAILED', attempts=attempts+1, last_error='Delivery claim expired', claim_token=NULL
       WHERE status='SENDING' AND claimed_at < now() - ($1 * interval '1 second') AND attempts + 1 >= $2`,
      [lease, maxAttempts]
    );
    return many(
      `WITH c AS (
         SELECT d.id, e.url, e.secret, e.business_id, d.event, d.payload
         FROM webhook_deliveries d
         JOIN webhook_endpoints e ON e.id=d.endpoint_id
         WHERE d.attempts < $2
           AND e.active=true
           AND (d.status='PENDING'
             OR (d.status='SENDING' AND d.claimed_at < now() - ($3 * interval '1 second')))
         ORDER BY d.created_at ASC
         FOR UPDATE OF d SKIP LOCKED
         LIMIT $1
       )
       UPDATE webhook_deliveries d
       SET status='SENDING',
           claimed_at=now(),
           claim_token=gen_random_uuid(),
           attempts=d.attempts + CASE WHEN d.status='SENDING' THEN 1 ELSE 0 END,
           last_error=CASE WHEN d.status='SENDING' THEN 'Delivery claim expired' ELSE d.last_error END
       FROM c
       WHERE d.id=c.id
       RETURNING d.id, d.endpoint_id, d.event, d.payload, d.attempts, d.claim_token, c.url, c.secret, c.business_id`,
      [limit, maxAttempts, lease]
    );
  },

  /** @returns {Promise<boolean>} false when the claim was lost to a reclaim. */
  async markSent(id, claimToken) {
    const result = await exec(
      `UPDATE webhook_deliveries SET status='SENT', sent_at=now(), claim_token=NULL
       WHERE id=$1 AND status='SENDING' AND claim_token=$2`,
      [id, claimToken]
    );
    return result.rowCount === 1;
  },

  /** @returns {Promise<boolean>} false when the claim was lost to a reclaim. */
  async recordFailure(id, error, maxAttempts = 3, claimToken = null) {
    const result = await exec(
      `UPDATE webhook_deliveries
       SET attempts = attempts + 1,
           last_error = $2,
           status = CASE WHEN attempts + 1 >= $3 THEN 'FAILED' ELSE 'PENDING' END,
           claim_token = NULL
       WHERE id=$1 AND status='SENDING' AND claim_token=$4`,
      [id, error, maxAttempts, claimToken]
    );
    return result.rowCount === 1;
  }
};
