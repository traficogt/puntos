import { many, one } from "./base.js";
import { conflict, notFound } from "../../utils/http-error.js";

/**
 * Directory projection of a customer: `customers` columns plus the coalesced
 * `customer_balances` counters.
 * @typedef {{
 *   id: string,
 *   name: string | null,
 *   phone: string,
 *   created_at: Date,
 *   last_visit_at: Date | null,
 *   is_test: boolean,
 *   points: number,
 *   pending_points: number,
 *   lifetime_points: number
 * }} CustomerDirectoryRow
 */

/**
 * @typedef {{
 *   customers: CustomerDirectoryRow[],
 *   total: number,
 *   page: number,
 *   limit: number,
 *   total_pages: number
 * }} CustomerDirectoryPage
 */

const fields = `c.id, c.name, c.phone, c.created_at, c.last_visit_at, c.is_test,
  COALESCE(b.points, 0) AS points, COALESCE(b.pending_points, 0) AS pending_points,
  COALESCE(b.lifetime_points, 0) AS lifetime_points`;

export const CustomerDirectoryRepo = {
  /**
   * Resolves to `CustomerDirectoryPage`.
   * @param {{ businessId: string, q?: string, page?: number, limit?: number }} params
   */
  async list({ businessId, q = "", page = 1, limit = 25 }) {
    // Escape literal search input before binding it; '%' and '_' are not wildcards.
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const filter = `c.business_id = $1 AND c.deleted_at IS NULL
      AND ($2 = '%%' OR c.name ILIKE $2 OR c.phone ILIKE $2)`;
    const count = await one(`SELECT COUNT(*)::int AS total FROM customers c WHERE ${filter}`, [
      businessId,
      pattern,
    ]);
    const customers = await many(
      `SELECT ${fields} FROM customers c
      LEFT JOIN customer_balances b ON b.customer_id = c.id
      WHERE ${filter} ORDER BY c.created_at DESC, c.id DESC LIMIT $3 OFFSET $4`,
      [businessId, pattern, limit, (page - 1) * limit],
    );
    const total = Number(count?.total || 0);
    return { customers, total, page, limit, total_pages: Math.max(1, Math.ceil(total / limit)) };
  },
  /**
   * Resolves to `CustomerDirectoryRow | null`.
   * @param {{ businessId: string, customerId: string }} params
   */
  async get({ businessId, customerId }) {
    return one(
      `SELECT ${fields} FROM customers c
      LEFT JOIN customer_balances b ON b.customer_id = c.id
      WHERE c.business_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
      [businessId, customerId],
    );
  },
  /**
   * Optimistic rename: the update only applies while the stored name still equals `previousName`.
   * Resolves to `CustomerDirectoryRow`.
   * @param {{ businessId: string, customerId: string, name: string | null, previousName: string | null }} params
   */
  async updateName({ businessId, customerId, name, previousName }) {
    const updated = await one(
      `UPDATE customers SET name = $3
      WHERE business_id = $1 AND id = $2 AND deleted_at IS NULL
        AND name IS NOT DISTINCT FROM $4 RETURNING id`,
      [businessId, customerId, name, previousName],
    );
    const customer = await CustomerDirectoryRepo.get({ businessId, customerId });
    if (!customer) throw notFound("No encontramos este cliente en tu negocio.");
    if (!updated)
      throw conflict("El nombre cambió en otra sesión. Vuelve a abrir el perfil antes de guardar.");
    return customer;
  },
  /**
   * Record the marker and its audit entry in one statement. A missing, deleted or
   * foreign customer produces neither an update nor an audit event.
   * @param {{ businessId: string, customerId: string, isTest: boolean }} params
   * @param {{ type: "STAFF" | "SUPER_ADMIN", id?: string, email?: string, impersonatedBy?: string | null, ip: string | null, ua: string | null }} actor
   */
  async setTestAccount({ businessId, customerId, isTest }, actor) {
    const action =
      actor.type === "SUPER_ADMIN"
        ? "super.customer.test_account.update"
        : "customer.test_account.update";
    const meta = {
      customer_id: customerId,
      is_test: isTest,
      ...(actor.email ? { super_admin_email: actor.email } : {}),
      ...(actor.impersonatedBy ? { impersonated_by_super_admin_email: actor.impersonatedBy } : {}),
    };
    const customer = await one(
      `WITH marked AS (
         UPDATE customers SET is_test = $3
         WHERE business_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING business_id
       )
       INSERT INTO audit_logs (id, business_id, actor_type, actor_id, action, ip, ua, meta)
       SELECT gen_random_uuid(), business_id, $4, $5, $6, $7, $8, $9::jsonb FROM marked
       RETURNING $2::uuid AS id, $3::boolean AS is_test`,
      [
        businessId,
        customerId,
        isTest,
        actor.type,
        actor.id ?? null,
        action,
        actor.ip,
        actor.ua,
        JSON.stringify(meta),
      ],
    );
    if (!customer) throw notFound("No encontramos este cliente en tu negocio.");
    return customer;
  },
};
