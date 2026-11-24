import { createHash, timingSafeEqual } from "node:crypto";
import { one, many } from "./base.js";
import { withTransaction } from "../database.js";
import { encryptSecret, decryptSecretMaybe, isEncryptedSecret } from "../../utils/secret-crypto.js";
import { HttpError } from "../../utils/http-error.js";
import { errorCode } from "../../utils/error-shape.js";

/**
 * Row of `mobile_push_devices`. BIGINT counters arrive as strings; the token is
 * stored encrypted and only decrypted inside {@link MobilePushRepo.getSnapshot}.
 * @typedef {{
 *   installation_id: string,
 *   secret_hash: string,
 *   token_ciphertext: string,
 *   token_hash: string,
 *   topic: string,
 *   environment: string,
 *   business_id: string,
 *   customer_id: string,
 *   session_id: string,
 *   enabled: boolean,
 *   consent_expires_at: Date,
 *   generation: string,
 *   revision: string,
 *   synced_revision: string,
 *   points: number,
 *   pending_points: number,
 *   baseline_points: number,
 *   baseline_pending: number,
 *   attempts: number,
 *   next_attempt_at: Date,
 *   locked_until: Date | null,
 *   lock_token: string | null,
 *   last_test_at: Date | null,
 *   created_at: Date,
 *   updated_at: Date
 * }} MobilePushDeviceRow
 */

/**
 * A claimed device: the worker must present the same generation and lock token
 * for every follow-up mutation ({@link MobilePushRepo.claimDue}).
 * @typedef {Pick<MobilePushDeviceRow, "installation_id" | "generation" | "revision" | "lock_token">} MobilePushClaim
 */

/**
 * @typedef {{
 *   businessId: string,
 *   customerId: string,
 *   sessionId: string,
 *   installationId: string,
 *   installationSecret: string,
 *   token: string,
 *   topic: string
 * }} MobilePushRegisterInput
 */

/** @param {string} value */
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const validConsent = `d.enabled AND d.consent_expires_at>now()
  AND EXISTS (SELECT 1 FROM customers c JOIN businesses b ON b.id=c.business_id
    WHERE c.id=d.customer_id AND c.business_id=d.business_id AND c.deleted_at IS NULL)
  AND app.mobile_push_session_valid(d.session_id,d.customer_id,d.business_id,false)`;
const sameClaim = `d.installation_id=$1 AND d.generation=$2 AND d.lock_token=$3 AND d.locked_until>now()`;
/** @param {MobilePushClaim} claim */
const claimParams = (claim) => [claim.installation_id, claim.generation, claim.lock_token];
/**
 * True only when `row` exists and `secret` hashes to its stored secret, so a
 * positive result also narrows `row` to a present device.
 * @param {MobilePushDeviceRow | null | undefined} row
 * @param {string} secret
 * @returns {row is MobilePushDeviceRow}
 */
function owns(row, secret) {
  const supplied = Buffer.from(hash(secret), "hex");
  const expected = Buffer.from(row?.secret_hash || "0".repeat(64), "hex");
  return timingSafeEqual(supplied, expected) && Boolean(row);
}
const unavailable = () => new HttpError(409, "No se pudo registrar este dispositivo.");

// These rows contain credentials and are never serialized by the API. Global
// access is restricted to this service; each mutation validates its binding.
export const MobilePushRepo = {
  /**
   * Resolves to `MobilePushDeviceRow | null`.
   * @param {string} id installation id
   */
  async getDevice(id) {
    return one("SELECT * FROM mobile_push_devices WHERE installation_id=$1", [id]);
  },

  /**
   * @param {MobilePushRegisterInput} input
   * @param {typeof withTransaction} [transaction]
   * @returns {Promise<{ enabled: true, expiresAt: string }>}
   */
  async register(input, transaction = withTransaction) {
    try {
      return await transaction(async () => {
        const {
          businessId,
          customerId,
          sessionId,
          installationId,
          installationSecret,
          token,
          topic,
        } = input;
        // KEY SHARE protects against hard deletion while allowing ledger FK
        // checks and last-visit updates. The balance lock serializes registration
        // counts and baselines; take it before the session and device locks.
        const customer = await one(
          "SELECT id FROM customers WHERE id=$1 AND business_id=$2 AND deleted_at IS NULL FOR KEY SHARE",
          [customerId, businessId],
        );
        if (!customer) throw unavailable();
        await one(
          "INSERT INTO customer_balances(customer_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING customer_id",
          [customerId],
        );
        const balance = await one(
          "SELECT points,pending_points FROM customer_balances WHERE customer_id=$1 FOR UPDATE",
          [customerId],
        );
        const active = await one("SELECT app.mobile_push_session_valid($1,$2,$3,true) AS valid", [
          sessionId,
          customerId,
          businessId,
        ]);
        if (!active?.valid) throw unavailable();
        await one(
          "SELECT pg_advisory_xact_lock(hashtext('mobile-push-installation'),hashtext($1))",
          [installationId],
        );
        /** @type {MobilePushDeviceRow | null} */
        const existing = await one(
          "SELECT * FROM mobile_push_devices WHERE installation_id=$1 FOR UPDATE",
          [installationId],
        );
        if (existing && !owns(existing, installationSecret)) throw unavailable();
        const count = await one(
          `SELECT count(*)::integer AS total FROM mobile_push_devices d WHERE d.customer_id=$1 AND d.business_id=$2 AND d.installation_id<>$3 AND ${validConsent}`,
          [customerId, businessId, installationId],
        );
        if (count.total >= 20) throw unavailable();
        const encrypted = encryptSecret(token);
        if (!isEncryptedSecret(encrypted))
          throw new HttpError(503, "Notificaciones no disponibles.");
        const previousSession = existing
          ? await one("SELECT app.mobile_push_session_valid($1,$2,$3,false) AS valid", [
              existing.session_id,
              existing.customer_id,
              existing.business_id,
            ])
          : null;
        const reset =
          !previousSession?.valid ||
          existing?.session_id !== sessionId ||
          !existing ||
          !existing.enabled ||
          new Date(existing.consent_expires_at).getTime() <= Date.now() ||
          existing.customer_id !== customerId ||
          existing.business_id !== businessId ||
          existing.topic !== topic;
        const row = await one(
          `INSERT INTO mobile_push_devices
          (installation_id,secret_hash,token_ciphertext,token_hash,topic,business_id,customer_id,session_id,consent_expires_at,points,pending_points,baseline_points,baseline_pending)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '30 days',$9,$10,$9,$10)
          ON CONFLICT(installation_id) DO UPDATE SET token_ciphertext=EXCLUDED.token_ciphertext,token_hash=EXCLUDED.token_hash,
            topic=EXCLUDED.topic,business_id=EXCLUDED.business_id,customer_id=EXCLUDED.customer_id,session_id=EXCLUDED.session_id,
            enabled=true,consent_expires_at=EXCLUDED.consent_expires_at,generation=mobile_push_devices.generation+1,
            points=EXCLUDED.points,pending_points=EXCLUDED.pending_points,
            synced_revision=CASE WHEN $11 THEN mobile_push_devices.revision ELSE mobile_push_devices.synced_revision END,
            baseline_points=CASE WHEN $11 THEN EXCLUDED.points ELSE mobile_push_devices.baseline_points END,
            baseline_pending=CASE WHEN $11 THEN EXCLUDED.pending_points ELSE mobile_push_devices.baseline_pending END,
            locked_until=NULL,lock_token=NULL,next_attempt_at=now(),attempts=0,updated_at=now()
          RETURNING consent_expires_at`,
          [
            installationId,
            hash(installationSecret),
            encrypted,
            hash(token),
            topic,
            businessId,
            customerId,
            sessionId,
            balance.points,
            balance.pending_points,
            reset,
          ],
        );
        return { enabled: true, expiresAt: new Date(row.consent_expires_at).toISOString() };
      });
    } catch (error) {
      if (errorCode(error) === "23505") throw unavailable();
      throw error;
    }
  },

  /**
   * @param {string} id installation id
   * @param {string} secret installation secret
   */
  async revoke(id, secret) {
    const row = await this.getDevice(id);
    if (owns(row, secret))
      await one(
        `UPDATE mobile_push_devices SET enabled=false,generation=generation+1,
      locked_until=NULL,lock_token=NULL,updated_at=now() WHERE installation_id=$1 AND secret_hash=$2 RETURNING installation_id`,
        [id, row.secret_hash],
      );
    return { ok: true };
  },

  /**
   * Resolves to `MobilePushClaim[]`.
   * @param {number} [limit]
   */
  async claimDue(limit = 20) {
    // Recheck after row locking too: a concurrent valid re-registration must
    // never be disabled by cleanup's older snapshot. No source locks are taken.
    await one(`WITH invalid AS (SELECT d.installation_id FROM mobile_push_devices d
      WHERE d.enabled AND NOT (${validConsent}) ORDER BY d.installation_id
      FOR UPDATE OF d SKIP LOCKED LIMIT 100)
      UPDATE mobile_push_devices d SET enabled=false,generation=d.generation+1,
        locked_until=NULL,lock_token=NULL,updated_at=now()
      FROM invalid WHERE d.installation_id=invalid.installation_id AND d.enabled AND NOT (${validConsent})
      RETURNING d.installation_id`);
    return many(
      `WITH due AS (SELECT d.installation_id FROM mobile_push_devices d
      WHERE ${validConsent} AND d.revision>d.synced_revision AND d.next_attempt_at<=now()
        AND (d.locked_until IS NULL OR d.locked_until<=now())
      ORDER BY d.next_attempt_at,d.installation_id FOR UPDATE OF d SKIP LOCKED LIMIT $1)
      UPDATE mobile_push_devices d SET locked_until=now()+interval '5 minutes',lock_token=gen_random_uuid()
      FROM due WHERE d.installation_id=due.installation_id
      RETURNING d.installation_id,d.generation,d.revision,d.lock_token`,
      [Math.max(1, Math.min(20, Math.trunc(Number(limit)) || 20))],
    );
  },

  /**
   * Resolves to `(MobilePushDeviceRow & { plan: string, token: string }) | null`.
   * @param {MobilePushClaim} claim
   */
  async getSnapshot(claim) {
    const row = await one(
      `SELECT d.*,b.plan FROM mobile_push_devices d JOIN businesses b ON b.id=d.business_id
      WHERE ${sameClaim} AND ${validConsent}`,
      claimParams(claim),
    );
    return row ? { ...row, token: decryptSecretMaybe(row.token_ciphertext) } : null;
  },

  /**
   * @param {MobilePushClaim} claim
   * @param {{ revision: string | number, points: number, pending_points: number }} snapshot
   */
  async acknowledge(claim, snapshot) {
    return one(
      `UPDATE mobile_push_devices d SET synced_revision=GREATEST(d.synced_revision,$4::bigint),
      baseline_points=$5,baseline_pending=$6,attempts=0,locked_until=NULL,lock_token=NULL,
      next_attempt_at=CASE WHEN d.revision>$4::bigint THEN now() ELSE d.next_attempt_at END
      WHERE ${sameClaim} AND ${validConsent} AND $4::bigint<=d.revision AND $4::bigint>=d.synced_revision RETURNING installation_id`,
      [...claimParams(claim), snapshot.revision, snapshot.points, snapshot.pending_points],
    );
  },

  /**
   * @param {MobilePushClaim} claim
   * @param {{ invalidToken?: boolean, retryable?: boolean }} [outcome]
   */
  async fail(claim, { invalidToken = false, retryable = true } = {}) {
    return one(
      `UPDATE mobile_push_devices d SET enabled=CASE WHEN $4 THEN false ELSE d.enabled END,
      generation=d.generation+CASE WHEN $4 THEN 1 ELSE 0 END,
      attempts=LEAST(d.attempts+1,1000000),locked_until=NULL,lock_token=NULL,
      next_attempt_at=now()+(CASE WHEN $5 THEN LEAST(3600,15*power(2,LEAST(d.attempts,8))) ELSE 3600 END)*interval '1 second'
      WHERE ${sameClaim} RETURNING installation_id`,
      [...claimParams(claim), invalidToken, retryable],
    );
  },

  /**
   * Resolves to `MobilePushClaim | null`.
   * @param {{ installationId: string, installationSecret: string, customerId: string, businessId: string }} input
   */
  async claimTest(input) {
    const row = await this.getDevice(input.installationId);
    if (!owns(row, input.installationSecret)) return null;
    return one(
      `UPDATE mobile_push_devices d SET last_test_at=now(),locked_until=now()+interval '30 seconds',lock_token=gen_random_uuid()
      WHERE d.installation_id=$1 AND d.secret_hash=$2 AND d.customer_id=$3 AND d.business_id=$4 AND ${validConsent}
      AND (d.last_test_at IS NULL OR d.last_test_at<now()-interval '1 minute')
      AND (d.locked_until IS NULL OR d.locked_until<=now())
      RETURNING d.installation_id,d.generation,d.revision,d.lock_token`,
      [input.installationId, row.secret_hash, input.customerId, input.businessId],
    );
  },

  /** @param {MobilePushClaim} claim */
  async releaseTest(claim) {
    return one(
      `UPDATE mobile_push_devices d SET locked_until=NULL,lock_token=NULL WHERE ${sameClaim} RETURNING installation_id`,
      claimParams(claim),
    );
  },
};
