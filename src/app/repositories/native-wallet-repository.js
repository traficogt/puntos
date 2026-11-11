import { getDbClient } from '../database.js';
import { withWalletRewardInventory, walletInventoryEngagement } from '../services/reward-inventory-public.js';
import crypto from "node:crypto";
import { walletSnapshotSql } from "./native-wallet-snapshot.js";
import { buildWalletEngagement } from "../services/native-wallet/engagement.js";
import { one, many } from "./base.js";
import { encryptSecret, decryptSecretMaybe } from "../../utils/secret-crypto.js";

const publicColumns = `id, business_id, customer_id, provider, serial_number, revoked_at,
  revision, synced_revision, attempts, next_attempt_at, locked_until, lock_token, created_at, updated_at`;

function credentials(row) {
  if (!row) return null;
  const membershipToken = decryptSecretMaybe(row.membership_token);
  return { ...row, membership_token: membershipToken, barcode: `PFW1.${membershipToken}`,
    authentication_token: decryptSecretMaybe(row.authentication_token) };
}

function membershipHash(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

// Credential-bearing methods are internal only. Route handlers must explicitly
// construct public responses instead of serializing a pass or snapshot.
export const NativeWalletRepo = {
  async ensurePass({ id, businessId, customerId, provider, membershipToken, authenticationToken }) {
    const row = await one(
      `INSERT INTO native_wallet_passes
        (id, business_id, customer_id, provider, membership_token, membership_hash, authentication_token)
       SELECT $1, c.business_id, c.id, $4, $5, $6, $7 FROM customers c
       WHERE c.id=$3 AND c.business_id=$2 AND c.deleted_at IS NULL
       ON CONFLICT (business_id, customer_id, provider) WHERE revoked_at IS NULL
       DO UPDATE SET id=native_wallet_passes.id RETURNING *`,
      [id, businessId, customerId, provider, encryptSecret(membershipToken), membershipHash(membershipToken), encryptSecret(authenticationToken)]
    );
    return credentials(row);
  },

  async getCustomerPasses(businessId, customerId) {
    return many(`SELECT ${publicColumns} FROM native_wallet_passes
      WHERE business_id=$1 AND customer_id=$2 ORDER BY created_at, id`, [businessId, customerId]);
  },

  async getSnapshot(id) {
    const stored = credentials(await one(walletSnapshotSql, [id]));
    if (!stored) return null;
    const snapshot = await withWalletRewardInventory(getDbClient(), stored);
    const wallet_engagement = walletInventoryEngagement(snapshot, buildWalletEngagement(snapshot));
    return { ...snapshot, wallet_engagement, next_refresh_at: wallet_engagement.next_refresh_at };
  },

  async getBySerial(serial, provider = null) {
    return credentials(await one(`SELECT * FROM native_wallet_passes
      WHERE serial_number=$1 AND ($2::text IS NULL OR provider=$2)`, [serial, provider]));
  },

  async findByMembershipToken(token) {
    return credentials(await one("SELECT * FROM native_wallet_passes WHERE membership_hash=$1", [membershipHash(token)]));
  },

  async revokeCustomerPasses(businessId, customerId) {
    return many(`UPDATE native_wallet_passes SET revoked_at=now()
      WHERE business_id=$1 AND customer_id=$2 AND revoked_at IS NULL RETURNING ${publicColumns}`, [businessId, customerId]);
  },

  async registerDevice({ passId, deviceId, pushToken }) {
    return one(`INSERT INTO native_wallet_registrations (pass_id, business_id, device_id, push_token)
      SELECT id, business_id, $2, $3 FROM native_wallet_passes WHERE id=$1 AND provider='apple'
      ON CONFLICT (pass_id, device_id) DO UPDATE SET push_token=EXCLUDED.push_token, updated_at=now()
      RETURNING *, (xmax=0) AS created`, [passId, deviceId, pushToken]);
  },

  async unregisterDevice(passId, deviceId) {
    return one("DELETE FROM native_wallet_registrations WHERE pass_id=$1 AND device_id=$2 RETURNING pass_id, device_id", [passId, deviceId]);
  },

  async getDeviceUpdates(deviceId, provider = "apple", since = null) {
    // A sequence is allocated before COMMIT. Lock the registered rows before
    // filtering so an earlier, still-running change cannot be skipped when a
    // later transaction has already committed a larger revision.
    return one(`WITH registered AS MATERIALIZED (
      SELECT p.id, p.serial_number, p.revision
      FROM native_wallet_passes p JOIN native_wallet_registrations r ON r.pass_id=p.id
      WHERE r.device_id=$1 AND p.provider=$2 ORDER BY p.id FOR SHARE OF p
    ) SELECT COALESCE(array_agg(p.serial_number ORDER BY p.serial_number)
        FILTER (WHERE p.revision > COALESCE($3::bigint, 0)), ARRAY[]::text[]) AS serial_numbers,
        GREATEST(COALESCE(max(p.revision), 0), COALESCE($3::bigint, 0))::text AS last_updated
      FROM registered p`, [deviceId, provider, since]);
  },

  async listRegistrations(passId) {
    return many("SELECT * FROM native_wallet_registrations WHERE pass_id=$1 ORDER BY device_id", [passId]);
  },

  async deletePushToken(token) {
    return many("DELETE FROM native_wallet_registrations WHERE push_token=$1 RETURNING pass_id, device_id", [token]);
  },

  async claimDue(limit = 20, providers = ["apple", "google"], leaseSeconds = 300) {
    return many(`WITH due AS (
      SELECT id FROM native_wallet_passes
      WHERE provider=ANY($2::text[]) AND (revision>synced_revision OR content_refresh_at<=now()) AND next_attempt_at<=now()
        AND (locked_until IS NULL OR locked_until<=now())
      ORDER BY next_attempt_at, id FOR UPDATE SKIP LOCKED LIMIT $1
    ) UPDATE native_wallet_passes p SET revision=CASE WHEN p.revision<=p.synced_revision AND p.content_refresh_at<=now() THEN p.revision+1 ELSE p.revision END, locked_until=now()+($3 * interval '1 second'), lock_token=gen_random_uuid()
      FROM due WHERE p.id=due.id RETURNING p.id, p.provider, p.revision, p.locked_until, p.lock_token`,
    [Math.max(1, Math.min(100, Math.trunc(Number(limit)) || 20)), providers, Math.max(30, Math.min(900, Number(leaseSeconds) || 300))]);
  },

  async markSynced(id, revision, lockToken = null, nextRefreshAt = null) {
    return one(`UPDATE native_wallet_passes SET synced_revision=GREATEST(synced_revision, LEAST(revision, $2::bigint)),
      attempts=0, locked_until=NULL, lock_token=NULL, content_refresh_at=$4::timestamptz,
      next_attempt_at=CASE WHEN revision>$2::bigint THEN now() ELSE next_attempt_at END
      WHERE id=$1 AND ($3::uuid IS NULL OR lock_token=$3) RETURNING ${publicColumns}`, [id, revision, lockToken, nextRefreshAt]);
  },

  async markFailed(id, lockToken = null) {
    return one(`UPDATE native_wallet_passes SET attempts=LEAST(attempts, 1000000)+1,
      next_attempt_at=now()+(LEAST(3600, 15 * power(2, LEAST(attempts, 8))) * interval '1 second'),
      locked_until=NULL, lock_token=NULL
      WHERE id=$1 AND ($2::uuid IS NULL OR lock_token=$2) RETURNING ${publicColumns}`, [id, lockToken]);
  }
};
