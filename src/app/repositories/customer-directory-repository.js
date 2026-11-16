import {many, one} from './base.js';
import {conflict, notFound} from '../../utils/http-error.js';

const fields = `c.id, c.name, c.phone, c.created_at, c.last_visit_at,
  COALESCE(b.points, 0) AS points, COALESCE(b.pending_points, 0) AS pending_points,
  COALESCE(b.lifetime_points, 0) AS lifetime_points`;

export const CustomerDirectoryRepo = {
  async list({businessId, q = '', page = 1, limit = 25}) {
    // Escape literal search input before binding it; '%' and '_' are not wildcards.
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const filter = `c.business_id = $1 AND c.deleted_at IS NULL
      AND ($2 = '%%' OR c.name ILIKE $2 OR c.phone ILIKE $2)`;
    const count = await one(`SELECT COUNT(*)::int AS total FROM customers c WHERE ${filter}`, [businessId, pattern]);
    const customers = await many(`SELECT ${fields} FROM customers c
      LEFT JOIN customer_balances b ON b.customer_id = c.id
      WHERE ${filter} ORDER BY c.created_at DESC, c.id DESC LIMIT $3 OFFSET $4`,
    [businessId, pattern, limit, (page - 1) * limit]);
    const total = Number(count?.total || 0);
    return {customers, total, page, limit, total_pages: Math.max(1, Math.ceil(total / limit))};
  },
  async get({businessId, customerId}) {
    return one(`SELECT ${fields} FROM customers c
      LEFT JOIN customer_balances b ON b.customer_id = c.id
      WHERE c.business_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`, [businessId, customerId]);
  },
  async updateName({businessId, customerId, name, previousName}) {
    const updated = await one(`UPDATE customers SET name = $3
      WHERE business_id = $1 AND id = $2 AND deleted_at IS NULL
        AND name IS NOT DISTINCT FROM $4 RETURNING id`, [businessId, customerId, name, previousName]);
    const customer = await CustomerDirectoryRepo.get({businessId, customerId});
    if (!customer) throw notFound('No encontramos este cliente en tu negocio.');
    if (!updated) throw conflict('El nombre cambió en otra sesión. Vuelve a abrir el perfil antes de guardar.');
    return customer;
  },
};
