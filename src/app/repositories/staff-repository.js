import { one, many, exec } from "./base.js";

/**
 * Row of `staff_users` (including the MFA and gift-card columns added by later
 * `ALTER TABLE` statements in the schema).
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   branch_id: string | null,
 *   name: string,
 *   email: string | null,
 *   phone: string | null,
 *   role: string,
 *   password_hash: string,
 *   active: boolean,
 *   can_manage_gift_cards: boolean,
 *   verified_email: string | null,
 *   email_verified_at: Date | null,
 *   mfa_enabled: boolean,
 *   mfa_secret_enc: string | null,
 *   mfa_pending_secret_enc: string | null,
 *   mfa_pending_created_at: Date | null,
 *   mfa_confirmed_at: Date | null,
 *   created_at: Date
 * }} StaffRow
 */

/**
 * Columns returned by {@link StaffRepo.listByBusiness} (no credentials).
 * @typedef {Pick<StaffRow,
 *   | "id" | "business_id" | "branch_id" | "name" | "email" | "phone" | "role"
 *   | "active" | "can_manage_gift_cards" | "created_at">} StaffListRow
 */

/**
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   branch_id?: string | null,
 *   name: string,
 *   email?: string | null,
 *   phone?: string | null,
 *   role: string,
 *   password_hash: string
 * }} StaffCreateInput
 */

export const StaffRepo = {
  /**
   * Resolves to `StaffRow | null`.
   * @param {StaffCreateInput} staff
   */
  async create({ id, business_id, branch_id, name, email, phone, role, password_hash }) {
    await exec(
      `INSERT INTO staff_users (id, business_id, branch_id, name, email, phone, role, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, business_id, branch_id ?? null, name, email ?? null, phone ?? null, role, password_hash],
    );
    return this.getById(id);
  },

  /**
   * Resolves to `StaffRow | null`.
   * @param {string} id
   */
  async getById(id) {
    return one(`SELECT * FROM staff_users WHERE id=$1`, [id]);
  },

  /**
   * Resolves to `StaffRow | null`.
   * @param {string} email
   */
  async getByEmail(email) {
    const normalized = String(email || "").toLowerCase();
    if (!normalized) return null;
    // staff_users is strict-tenant RLS; login requires cross-tenant lookup.
    return one(`SELECT * FROM app.staff_login_lookup($1)`, [normalized]);
  },

  /**
   * Resolves to `StaffListRow[]`.
   * @param {string} businessId
   */
  async listByBusiness(businessId) {
    return many(
      `SELECT id, business_id, branch_id, name, email, phone, role, active, can_manage_gift_cards, created_at
                 FROM staff_users WHERE business_id=$1 ORDER BY created_at DESC`,
      [businessId],
    );
  },
};
