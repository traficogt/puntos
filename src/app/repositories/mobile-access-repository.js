import { dbQuery, getDbPlatformAdmin } from "../database.js";

/**
 * Row of `mobile_access_codes` (one-time SMS codes keyed by phone, not tenant).
 * @typedef {{
 *   id: string,
 *   phone: string,
 *   code_hash: string,
 *   attempts: number,
 *   created_at: Date,
 *   expires_at: Date,
 *   consumed_at: Date | null
 * }} MobileAccessCodeRow
 */

/**
 * Row of `mobile_access_grants` (a verified phone's short-lived card-selection token).
 * @typedef {{
 *   id: string,
 *   token_hash: string,
 *   phone: string,
 *   created_at: Date,
 *   expires_at: Date,
 *   consumed_at: Date | null
 * }} MobileAccessGrantRow
 */

/**
 * Business card offered to a verified phone ({@link MobileAccessRepo.listCards}).
 * @typedef {{
 *   id: string,
 *   name: string,
 *   slug: string,
 *   customer_branding_json: Record<string, unknown>
 * }} MobileAccessCardRow
 */

/**
 * Membership of a phone in one business ({@link MobileAccessRepo.getMembership}).
 * @typedef {{
 *   customer: {
 *     id: string,
 *     business_id: string,
 *     name: string | null,
 *     phone: string,
 *     points: number,
 *     pending_points: number,
 *     lifetime_points: number
 *   },
 *   business: { id: string, name: string, slug: string }
 * }} MobileAccessMembership
 */

// Global phone credentials and membership lookup are internal platform operations.
/**
 * @param {string} sql
 * @param {unknown[]} [args]
 */
function query(sql, args = []) {
  if (!getDbPlatformAdmin()) throw new Error("Mobile access requires trusted platform context");
  return dbQuery(sql, args);
}

export const MobileAccessRepo = {
  /** @param {string} phone */
  async lockPhone(phone) {
    await query("SELECT pg_advisory_xact_lock(hashtext('mobile-access'), hashtext($1))", [phone]);
  },
  /**
   * @param {string} phone
   * @returns {Promise<{ minute: number, hour: number }>}
   */
  async requestCounts(phone) {
    const { rows } = await query(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '60 seconds')::int AS minute,
      count(*)::int AS hour FROM mobile_access_codes WHERE phone=$1 AND created_at > now() - interval '1 hour'`,
      [phone],
    );
    return rows[0];
  },
  /** @param {{ id: string, phone: string, code_hash: string, expires_at: Date | string }} code */
  async createCode({ id, phone, code_hash, expires_at }) {
    await query(
      "UPDATE mobile_access_codes SET consumed_at=now() WHERE phone=$1 AND consumed_at IS NULL",
      [phone],
    );
    await query(
      "INSERT INTO mobile_access_codes(id,phone,code_hash,expires_at) VALUES($1,$2,$3,$4)",
      [id, phone, code_hash, expires_at],
    );
  },
  /** @param {string} id */
  async invalidateCode(id) {
    await query(
      "UPDATE mobile_access_codes SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL",
      [id],
    );
  },
  /**
   * Resolves to `Pick<MobileAccessCodeRow, "id" | "code_hash"> | null`.
   * @param {string} phone
   */
  async latestCode(phone) {
    const { rows } = await query(
      `SELECT id,code_hash FROM mobile_access_codes WHERE phone=$1 AND consumed_at IS NULL
      AND expires_at>now() AND attempts<5 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [phone],
    );
    return rows[0] ?? null;
  },
  /** @param {string} id */
  async failCode(id) {
    await query("UPDATE mobile_access_codes SET attempts=attempts+1 WHERE id=$1 AND attempts<5", [
      id,
    ]);
  },
  /** @param {string} id */
  async consumeCode(id) {
    const { rowCount } = await query(
      `UPDATE mobile_access_codes SET consumed_at=now() WHERE id=$1
      AND consumed_at IS NULL AND expires_at>now() AND attempts<5`,
      [id],
    );
    return rowCount === 1;
  },
  /**
   * Resolves to `MobileAccessCardRow[]`.
   * @param {string} phone
   */
  async listCards(phone) {
    const { rows } = await query(
      `SELECT b.id,b.name,b.slug,b.customer_branding_json FROM customers c JOIN businesses b ON b.id=c.business_id
      WHERE c.phone=$1 AND c.deleted_at IS NULL ORDER BY b.name,b.id`,
      [phone],
    );
    return rows;
  },
  /**
   * Resolves to `MobileAccessMembership | null`.
   * @param {string} phone
   * @param {string} businessId
   */
  async getMembership(phone, businessId) {
    // Lock only the customer against deletion. Balance reads do not take locks;
    // financial writers retain their existing balance -> device -> customer order.
    const { rows } = await query(
      `SELECT c.id,c.business_id,c.name,c.phone,
      COALESCE(cb.points,0) AS points,COALESCE(cb.pending_points,0) AS pending_points,
      COALESCE(cb.lifetime_points,0) AS lifetime_points,b.name AS business_name,b.slug AS business_slug
      FROM customers c JOIN businesses b ON b.id=c.business_id
      LEFT JOIN customer_balances cb ON cb.customer_id=c.id
      WHERE c.phone=$1 AND c.business_id=$2 AND c.deleted_at IS NULL FOR SHARE OF c`,
      [phone, businessId],
    );
    if (!rows[0]) return null;
    const { business_name, business_slug, ...customer } = rows[0];
    return {
      customer,
      business: { id: customer.business_id, name: business_name, slug: business_slug },
    };
  },
  /** @param {{ id: string, token_hash: string, phone: string, expires_at: Date | string }} grant */
  async createGrant({ id, token_hash, phone, expires_at }) {
    await query(
      "INSERT INTO mobile_access_grants(id,token_hash,phone,expires_at) VALUES($1,$2,$3,$4)",
      [id, token_hash, phone, expires_at],
    );
  },
  /**
   * Resolves to `Pick<MobileAccessGrantRow, "id" | "phone"> | null`.
   * @param {string} tokenHash
   */
  async lockGrant(tokenHash) {
    const { rows } = await query(
      `SELECT id,phone FROM mobile_access_grants WHERE token_hash=$1
      AND consumed_at IS NULL AND expires_at>now() FOR UPDATE`,
      [tokenHash],
    );
    return rows[0] ?? null;
  },
  /** @param {string} id */
  async consumeGrant(id) {
    const { rowCount } = await query(
      `UPDATE mobile_access_grants SET consumed_at=now()
      WHERE id=$1 AND consumed_at IS NULL AND expires_at>now()`,
      [id],
    );
    return rowCount === 1;
  },
};
