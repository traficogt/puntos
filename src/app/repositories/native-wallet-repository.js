import { getDbClient } from "../database.js";
import {
  withWalletRewardInventory,
  walletInventoryEngagement,
} from "../services/reward-inventory-public.js";
import crypto from "node:crypto";
import { walletSnapshotSql } from "./native-wallet-snapshot.js";
import { buildWalletEngagement } from "../services/native-wallet/engagement.js";
import { one, many } from "./base.js";
import { encryptSecret, decryptSecretMaybe } from "../../utils/secret-crypto.js";

/**
 * Row of `native_wallet_passes`. BIGINT revisions arrive as strings; the two
 * token columns are stored encrypted and decrypted by {@link credentials}.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   customer_id: string,
 *   provider: "apple" | "google",
 *   serial_number: string,
 *   membership_token: string,
 *   membership_hash: string,
 *   authentication_token: string,
 *   revoked_at: Date | null,
 *   revision: string,
 *   synced_revision: string,
 *   attempts: number,
 *   next_attempt_at: Date,
 *   locked_until: Date | null,
 *   lock_token: string | null,
 *   content_refresh_at: Date | null,
 *   pending_message: string | null,
 *   pending_message_expires_at: Date | null,
 *   created_at: Date,
 *   updated_at: Date
 * }} NativeWalletPassRow
 */

/**
 * Credential-free projection (`publicColumns`) that route handlers may serialise.
 * @typedef {Pick<NativeWalletPassRow,
 *   | "id" | "business_id" | "customer_id" | "provider" | "serial_number" | "revoked_at"
 *   | "revision" | "synced_revision" | "attempts" | "next_attempt_at" | "locked_until"
 *   | "lock_token" | "created_at" | "updated_at">} NativeWalletPassPublicRow
 */

/**
 * A pass with its tokens decrypted and the barcode payload derived.
 * @typedef {NativeWalletPassRow & { barcode: string }} NativeWalletPassCredentials
 */

/**
 * Columns added by `walletSnapshotSql` on top of the pass row.
 * @typedef {NativeWalletPassRow & {
 *   customer_name: string | null,
 *   customer_deleted_at: Date | null,
 *   points: number,
 *   pending_points: number,
 *   lifetime_points: number,
 *   tier: string | null,
 *   business_name: string,
 *   business_slug: string | null,
 *   program_type: string | null,
 *   program_json: Record<string, unknown> | null,
 *   customer_branding_json: Record<string, unknown> | null,
 *   is_voided: boolean,
 *   snapshot_at: Date,
 *   timezone: string,
 *   wallet_cycle: Record<string, unknown> | null,
 *   wallet_next_day: Date,
 *   wallet_daily_redemptions: number,
 *   wallet_branches: import("./native-wallet-snapshot.js").WalletSnapshotBranch[],
 *   wallet_rewards: import("./native-wallet-snapshot.js").WalletSnapshotReward[]
 * }} NativeWalletSnapshotRow
 */

/**
 * Row of `native_wallet_registrations` (Apple device registrations).
 * @typedef {{
 *   pass_id: string,
 *   business_id: string,
 *   device_id: string,
 *   push_token: string,
 *   created_at: Date,
 *   updated_at: Date
 * }} NativeWalletRegistrationRow
 */

/**
 * Transient lifecycle message carried by a pass ({@link walletMessage}).
 * @typedef {{ text: string, id: string, start: string, end: string }} WalletMessage
 */

const publicColumns = `id, business_id, customer_id, provider, serial_number, revoked_at,
  revision, synced_revision, attempts, next_attempt_at, locked_until, lock_token, created_at, updated_at`;

/**
 * @template {NativeWalletPassRow} T
 * @param {T | null} row
 * @returns {(T & { barcode: string }) | null}
 */
function credentials(row) {
  if (!row) return null;
  const membershipToken = decryptSecretMaybe(row.membership_token);
  return {
    ...row,
    membership_token: membershipToken,
    barcode: `PFW1.${membershipToken}`,
    authentication_token: decryptSecretMaybe(row.authentication_token),
  };
}

/** @param {string} token */
function membershipHash(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

// A transient lifecycle-automation message rides on the pass until it expires. Apple
// renders it as a changeMessage field (lock-screen alert); Google as a messages[] entry.
// Exported for unit tests; returns null when there is no live message.
/**
 * @param {Pick<NativeWalletPassRow, "pending_message" | "pending_message_expires_at"> | null | undefined} row
 * @returns {WalletMessage | null}
 */
export function walletMessage(row) {
  const text = row?.pending_message;
  const expires = row?.pending_message_expires_at;
  if (!text || !expires || new Date(expires).getTime() <= Date.now()) return null;
  const clipped = String(text).slice(0, 240);
  const end = new Date(expires).toISOString();
  return {
    text: clipped,
    id: "pfm_" + crypto.createHash("sha256").update(`${clipped}|${end}`).digest("hex").slice(0, 24),
    start: new Date().toISOString(),
    end,
  };
}

// Credential-bearing methods are internal only. Route handlers must explicitly
// construct public responses instead of serializing a pass or snapshot.
export const NativeWalletRepo = {
  /**
   * Resolves to `NativeWalletPassCredentials | null`.
   * @param {{
   *   id: string,
   *   businessId: string,
   *   customerId: string,
   *   provider: string,
   *   membershipToken: string,
   *   authenticationToken: string
   * }} pass
   */
  async ensurePass({ id, businessId, customerId, provider, membershipToken, authenticationToken }) {
    const row = await one(
      `INSERT INTO native_wallet_passes
        (id, business_id, customer_id, provider, membership_token, membership_hash, authentication_token)
       SELECT $1, c.business_id, c.id, $4, $5, $6, $7 FROM customers c
       WHERE c.id=$3 AND c.business_id=$2 AND c.deleted_at IS NULL
       ON CONFLICT (business_id, customer_id, provider) WHERE revoked_at IS NULL
       DO UPDATE SET id=native_wallet_passes.id RETURNING *`,
      [
        id,
        businessId,
        customerId,
        provider,
        encryptSecret(membershipToken),
        membershipHash(membershipToken),
        encryptSecret(authenticationToken),
      ],
    );
    return credentials(row);
  },

  /**
   * Resolves to `NativeWalletPassPublicRow[]`.
   * @param {string} businessId
   * @param {string} customerId
   */
  async getCustomerPasses(businessId, customerId) {
    return many(
      `SELECT ${publicColumns} FROM native_wallet_passes
      WHERE business_id=$1 AND customer_id=$2 ORDER BY created_at, id`,
      [businessId, customerId],
    );
  },

  /** @param {string} id */
  async getSnapshot(id) {
    /** @type {NativeWalletSnapshotRow | null} */
    const snapshotRow = await one(walletSnapshotSql, [id]);
    const stored = credentials(snapshotRow);
    if (!stored) return null;
    const snapshot = await withWalletRewardInventory(getDbClient(), stored);
    const wallet_engagement = walletInventoryEngagement(snapshot, buildWalletEngagement(snapshot));
    return {
      ...snapshot,
      wallet_engagement,
      wallet_message: walletMessage(stored),
      next_refresh_at: wallet_engagement.next_refresh_at,
    };
  },

  /**
   * Resolves to `NativeWalletPassCredentials | null`.
   * @param {string} serial
   * @param {string | null} [provider]
   */
  async getBySerial(serial, provider = null) {
    const row = await one(
      `SELECT * FROM native_wallet_passes
      WHERE serial_number=$1 AND ($2::text IS NULL OR provider=$2)`,
      [serial, provider],
    );
    return credentials(row);
  },

  /**
   * Resolves to `NativeWalletPassCredentials | null`.
   * @param {string} token
   */
  async findByMembershipToken(token) {
    const row = await one("SELECT * FROM native_wallet_passes WHERE membership_hash=$1", [
      membershipHash(token),
    ]);
    return credentials(row);
  },

  /**
   * Resolves to `NativeWalletPassPublicRow[]`.
   * @param {string} businessId
   * @param {string} customerId
   */
  async revokeCustomerPasses(businessId, customerId) {
    return many(
      `UPDATE native_wallet_passes SET revoked_at=now()
      WHERE business_id=$1 AND customer_id=$2 AND revoked_at IS NULL RETURNING ${publicColumns}`,
      [businessId, customerId],
    );
  },

  // Queue a transient wallet-push message on the customer's active passes and mark them
  // due so the wallet worker (processDue) delivers the push. Returns the queued passes;
  // an empty array means the customer has no active pass (caller falls back to SMS/email).
  /**
   * Resolves to `Pick<NativeWalletPassRow, "id" | "provider">[]`.
   * @param {{ businessId: string, customerId: string, message: string, expiresAt: Date | string }} input
   */
  async queueWalletMessage({ businessId, customerId, message, expiresAt }) {
    return many(
      `UPDATE native_wallet_passes
      SET pending_message=$3, pending_message_expires_at=$4,
          revision=revision+1, next_attempt_at=now(), updated_at=now()
      WHERE business_id=$1 AND customer_id=$2 AND revoked_at IS NULL
      RETURNING id, provider`,
      [businessId, customerId, String(message).slice(0, 240), expiresAt],
    );
  },

  /**
   * Resolves to `(NativeWalletRegistrationRow & { created: boolean }) | null`.
   * @param {{ passId: string, deviceId: string, pushToken: string }} registration
   */
  async registerDevice({ passId, deviceId, pushToken }) {
    return one(
      `INSERT INTO native_wallet_registrations (pass_id, business_id, device_id, push_token)
      SELECT id, business_id, $2, $3 FROM native_wallet_passes WHERE id=$1 AND provider='apple'
      ON CONFLICT (pass_id, device_id) DO UPDATE SET push_token=EXCLUDED.push_token, updated_at=now()
      RETURNING *, (xmax=0) AS created`,
      [passId, deviceId, pushToken],
    );
  },

  /**
   * Resolves to `Pick<NativeWalletRegistrationRow, "pass_id" | "device_id"> | null`.
   * @param {string} passId
   * @param {string} deviceId
   */
  async unregisterDevice(passId, deviceId) {
    return one(
      "DELETE FROM native_wallet_registrations WHERE pass_id=$1 AND device_id=$2 RETURNING pass_id, device_id",
      [passId, deviceId],
    );
  },

  /**
   * @param {string} deviceId
   * @param {string} [provider]
   * @param {string | number | null} [since] the device's last known revision
   * @returns {Promise<{ serial_numbers: string[], last_updated: string }>}
   */
  async getDeviceUpdates(deviceId, provider = "apple", since = null) {
    // A sequence is allocated before COMMIT. Lock the registered rows before
    // filtering so an earlier, still-running change cannot be skipped when a
    // later transaction has already committed a larger revision.
    const updates = await one(
      `WITH registered AS MATERIALIZED (
      SELECT p.id, p.serial_number, p.revision
      FROM native_wallet_passes p JOIN native_wallet_registrations r ON r.pass_id=p.id
      WHERE r.device_id=$1 AND p.provider=$2 ORDER BY p.id FOR SHARE OF p
    ) SELECT COALESCE(array_agg(p.serial_number ORDER BY p.serial_number)
        FILTER (WHERE p.revision > COALESCE($3::bigint, 0)), ARRAY[]::text[]) AS serial_numbers,
        GREATEST(COALESCE(max(p.revision), 0), COALESCE($3::bigint, 0))::text AS last_updated
      FROM registered p`,
      [deviceId, provider, since],
    );
    // An aggregate without GROUP BY: the statement always yields exactly one row.
    return /** @type {{ serial_numbers: string[], last_updated: string }} */ (updates);
  },

  /**
   * Resolves to `NativeWalletRegistrationRow[]`.
   * @param {string} passId
   */
  async listRegistrations(passId) {
    return many("SELECT * FROM native_wallet_registrations WHERE pass_id=$1 ORDER BY device_id", [
      passId,
    ]);
  },

  /**
   * Resolves to `Pick<NativeWalletRegistrationRow, "pass_id" | "device_id">[]`.
   * @param {string} token
   */
  async deletePushToken(token) {
    return many(
      "DELETE FROM native_wallet_registrations WHERE push_token=$1 RETURNING pass_id, device_id",
      [token],
    );
  },

  /**
   * Resolves to `Pick<NativeWalletPassRow, "id" | "provider" | "revision" | "locked_until" | "lock_token">[]`.
   * @param {number} [limit]
   * @param {string[]} [providers]
   * @param {number} [leaseSeconds]
   */
  async claimDue(limit = 20, providers = ["apple", "google"], leaseSeconds = 300) {
    return many(
      `WITH due AS (
      SELECT id FROM native_wallet_passes
      WHERE provider=ANY($2::text[]) AND (revision>synced_revision OR content_refresh_at<=now()) AND next_attempt_at<=now()
        AND (locked_until IS NULL OR locked_until<=now())
      ORDER BY next_attempt_at, id FOR UPDATE SKIP LOCKED LIMIT $1
    ) UPDATE native_wallet_passes p SET revision=CASE WHEN p.revision<=p.synced_revision AND p.content_refresh_at<=now() THEN p.revision+1 ELSE p.revision END, locked_until=now()+($3 * interval '1 second'), lock_token=gen_random_uuid()
      FROM due WHERE p.id=due.id RETURNING p.id, p.provider, p.revision, p.locked_until, p.lock_token`,
      [
        Math.max(1, Math.min(100, Math.trunc(Number(limit)) || 20)),
        providers,
        Math.max(30, Math.min(900, Number(leaseSeconds) || 300)),
      ],
    );
  },

  /**
   * Resolves to `NativeWalletPassPublicRow | null`.
   * @param {string} id
   * @param {string | number} revision
   * @param {string | null} [lockToken]
   * @param {Date | string | null} [nextRefreshAt]
   */
  async markSynced(id, revision, lockToken = null, nextRefreshAt = null) {
    return one(
      `UPDATE native_wallet_passes SET synced_revision=GREATEST(synced_revision, LEAST(revision, $2::bigint)),
      attempts=0, locked_until=NULL, lock_token=NULL, content_refresh_at=$4::timestamptz,
      next_attempt_at=CASE WHEN revision>$2::bigint THEN now() ELSE next_attempt_at END
      WHERE id=$1 AND ($3::uuid IS NULL OR lock_token=$3) RETURNING ${publicColumns}`,
      [id, revision, lockToken, nextRefreshAt],
    );
  },

  /**
   * Resolves to `NativeWalletPassPublicRow | null`.
   * @param {string} id
   * @param {string | null} [lockToken]
   */
  async markFailed(id, lockToken = null) {
    // Provider calls can keep the transaction open longer than the backoff.
    // Schedule from this failure statement, not the transaction's start time.
    return one(
      `UPDATE native_wallet_passes SET attempts=LEAST(attempts, 1000000)+1,
      next_attempt_at=statement_timestamp()+(LEAST(3600, 15 * power(2, LEAST(attempts, 8))) * interval '1 second'),
      locked_until=NULL, lock_token=NULL
      WHERE id=$1 AND ($2::uuid IS NULL OR lock_token=$2) RETURNING ${publicColumns}`,
      [id, lockToken],
    );
  },
};
