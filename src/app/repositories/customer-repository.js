import { one, many, exec } from "./base.js";
import { conflict } from "../../utils/http-error.js";

/**
 * Row of `customers`.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   phone: string,
 *   name: string | null,
 *   birthday: Date | null,
 *   created_at: Date,
 *   last_visit_at: Date | null,
 *   deleted_at: Date | null,
 *   imported_at: Date | null
 * }} CustomerRow
 */

/**
 * Row of `customer_balances`.
 * @typedef {{
 *   customer_id: string,
 *   points: number,
 *   pending_points: number,
 *   lifetime_points: number,
 *   tier: string | null,
 *   updated_at: Date
 * }} CustomerBalanceRow
 */

/**
 * Customer joined with its balance counters (the shape most lookups return).
 * @typedef {CustomerRow
 *   & Pick<CustomerBalanceRow, "points" | "pending_points" | "lifetime_points" | "tier">} CustomerWithBalanceRow
 */

/**
 * Directory projection returned by {@link CustomerRepo.listByBusiness}.
 * @typedef {Pick<CustomerRow, "id" | "phone" | "name" | "created_at" | "last_visit_at">
 *   & Pick<CustomerBalanceRow, "points" | "pending_points" | "lifetime_points">} CustomerListRow
 */

/**
 * @typedef {{ id: string, business_id: string, phone: string, name?: string | null }} CustomerCreateInput
 */

export const CustomerRepo = {
  // ✅ Alias expected by customer-service.js
  /**
   * Resolves to `CustomerWithBalanceRow | null`.
   * @param {CustomerCreateInput} customer
   */
  async create({ id, business_id, phone, name }) {
    return CustomerRepo.upsertByPhone({ id, business_id, phone, name });
  },

  /**
   * Resolves to `CustomerWithBalanceRow | null`: both the fresh and the existing
   * (conflicting) customer come back joined with their balance counters.
   * @param {CustomerCreateInput} customer
   */
  async upsertByPhone({ id, business_id, phone, name }) {
    const created = await one(
      `INSERT INTO customers (id, business_id, phone, name) VALUES ($1,$2,$3,$4)
       ON CONFLICT (business_id, phone) DO NOTHING
       RETURNING id`,
      [id, business_id, phone, name ?? null],
    );
    if (!created) {
      // Same joined shape as the fresh path (getById): callers such as the mobile
      // join/login response project points/pending_points/lifetime_points from it.
      const existing = await CustomerRepo.getByBusinessAndPhone(business_id, phone);
      if (existing) return existing;
      throw conflict(
        "Esta tarjeta fue desactivada o eliminada. Contacta al negocio para recibir ayuda.",
      );
    }

    await exec(
      `INSERT INTO customer_balances (customer_id, points, lifetime_points)
       VALUES ($1,0,0)
       ON CONFLICT DO NOTHING`,
      [id],
    );

    return CustomerRepo.getById(id);
  },

  /**
   * Resolves to `CustomerWithBalanceRow | null`.
   * @param {string} id
   */
  async getById(id) {
    return one(
      `SELECT c.*, b.points, b.lifetime_points, b.tier
              , b.pending_points
       FROM customers c
       JOIN customer_balances b ON b.customer_id=c.id
       WHERE c.id=$1 AND c.deleted_at IS NULL`,
      [id],
    );
  },

  /**
   * Resolves to `CustomerWithBalanceRow | null`.
   * @param {string} businessId
   * @param {string} customerId
   */
  async getByBusinessAndId(businessId, customerId) {
    return one(
      `SELECT c.*, b.points, b.lifetime_points, b.tier
              , b.pending_points
       FROM customers c
       JOIN customer_balances b ON b.customer_id=c.id
       WHERE c.business_id=$1 AND c.id=$2 AND c.deleted_at IS NULL`,
      [businessId, customerId],
    );
  },

  /**
   * Resolves to `CustomerWithBalanceRow | null`.
   * @param {string} businessId
   * @param {string} phone
   */
  async getByBusinessAndPhone(businessId, phone) {
    return one(
      `SELECT c.*, b.points, b.lifetime_points, b.tier
              , b.pending_points
       FROM customers c
       JOIN customer_balances b ON b.customer_id=c.id
       WHERE c.business_id=$1 AND c.phone=$2 AND c.deleted_at IS NULL`,
      [businessId, phone],
    );
  },

  /**
   * Resolves to `CustomerWithBalanceRow | null`.
   * @param {string} customerId
   * @param {string | null} name
   */
  async updateName(customerId, name) {
    await exec(`UPDATE customers SET name=$2 WHERE id=$1`, [customerId, name]);
    return CustomerRepo.getById(customerId);
  },

  /** @param {string} customerId */
  async touchVisit(customerId) {
    await exec(`UPDATE customers SET last_visit_at=now() WHERE id=$1`, [customerId]);
  },

  /**
   * @param {string} customerId
   * @param {number} delta
   */
  async addPoints(customerId, delta) {
    await exec(
      `UPDATE customer_balances
       SET points = points + $2,
           lifetime_points = lifetime_points + GREATEST($2,0),
           updated_at=now()
       WHERE customer_id=$1`,
      [customerId, delta],
    );
  },

  /**
   * @param {string} customerId
   * @param {number} points
   */
  async setPoints(customerId, points) {
    await exec(`UPDATE customer_balances SET points=$2, updated_at=now() WHERE customer_id=$1`, [
      customerId,
      points,
    ]);
  },

  /** @param {string} customerId */
  async softDelete(customerId) {
    await exec(`UPDATE customers SET deleted_at=now() WHERE id=$1`, [customerId]);
  },

  /**
   * Resolves to `CustomerListRow[]`.
   * @param {string} businessId
   * @param {number} [limit]
   */
  async listByBusiness(businessId, limit = 200) {
    return many(
      `SELECT c.id, c.phone, c.name, c.created_at, c.last_visit_at,
              b.points, b.pending_points, b.lifetime_points
       FROM customers c
       JOIN customer_balances b ON b.customer_id=c.id
       WHERE c.business_id=$1 AND c.deleted_at IS NULL
       ORDER BY c.created_at DESC
       LIMIT $2`,
      [businessId, limit],
    );
  },
};
