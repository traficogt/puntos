import { one, many, exec } from "./base.js";

/**
 * Row of `branches` (wallet location columns come from the native-wallet migration).
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   name: string,
 *   address: string | null,
 *   code: string,
 *   wallet_location_enabled: boolean,
 *   wallet_latitude: number | null,
 *   wallet_longitude: number | null,
 *   created_at: Date
 * }} BranchRow
 */

/**
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   name: string,
 *   address?: string | null,
 *   code: string
 * }} BranchCreateInput
 */

export const BranchRepo = {
  /**
   * Resolves to `BranchRow | null`.
   * @param {BranchCreateInput} branch
   */
  async create({ id, business_id, name, address, code }) {
    await exec(
      `INSERT INTO branches (id, business_id, name, address, code) VALUES ($1,$2,$3,$4,$5)`,
      [id, business_id, name, address ?? null, code],
    );
    return this.getById(id);
  },

  /**
   * Resolves to `BranchRow | null`.
   * @param {string} id
   */
  async getById(id) {
    return one(`SELECT * FROM branches WHERE id=$1`, [id]);
  },

  /**
   * Resolves to `BranchRow[]`.
   * @param {string} businessId
   */
  async listByBusiness(businessId) {
    return many(`SELECT * FROM branches WHERE business_id=$1 ORDER BY created_at DESC`, [
      businessId,
    ]);
  },

  /**
   * Resolves to `BranchRow | null`.
   * @param {string} code
   */
  async getByCode(code) {
    return one(`SELECT * FROM branches WHERE code=$1`, [code]);
  },
};
