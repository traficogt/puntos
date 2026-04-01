import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validateQuery } from "../../../utils/schemas.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { toCSV } from "../../../utils/csv.js";
import { dbQuery } from "../../database.js";

export const adminAuditRoutes = Router();

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5000).default(50),
  impersonated_only: z.preprocess(
    (value) => value === "1" || value === "true" || value === true,
    z.boolean().default(false)
  ),
  from: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().datetime()]).optional()
  ),
  to: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().datetime()]).optional()
  )
});

async function listAuditEvents(businessId, { limit, impersonatedOnly, from, to }) {
  const params = [businessId];
  let dateClause = "";
  if (from) {
    params.push(String(from));
    dateClause += ` AND a.created_at::date >= $${params.length}::date`;
  }
  if (to) {
    params.push(String(to));
    dateClause += ` AND a.created_at::date <= $${params.length}::date`;
  }
  let impersonatedClause = "";
  if (impersonatedOnly) {
    params.push("impersonated_by_super_admin_email");
    impersonatedClause = ` AND a.meta ? $${params.length}`;
  }
  params.push(limit);

  const { rows } = await dbQuery(
    `SELECT
       a.id,
       a.created_at,
       CASE
         WHEN a.actor_type = 'SUPER_ADMIN' THEN 'PLATFORM'
         ELSE a.actor_type
       END AS actor_type,
       a.actor_id,
       CASE
         WHEN a.actor_type = 'SUPER_ADMIN' AND a.action = 'super.plan.update' THEN 'platform.plan.update'
         ELSE a.action
       END AS action,
       CASE
         WHEN a.actor_type = 'SUPER_ADMIN' THEN '{}'::jsonb
         ELSE a.meta
       END AS meta,
       CASE
         WHEN a.actor_type = 'SUPER_ADMIN' THEN 'Plataforma'
         ELSE s.name
       END AS actor_name,
       CASE
         WHEN a.actor_type = 'SUPER_ADMIN' THEN NULL
         ELSE s.email
       END AS actor_email
     FROM audit_logs a
     LEFT JOIN staff_users s ON s.id = a.actor_id
     WHERE a.business_id = $1
       AND (
         (COALESCE(a.actor_type, '') <> 'SUPER_ADMIN' AND a.action NOT LIKE 'super.%')
         OR a.action = 'super.plan.update'
       )
       ${dateClause}
       ${impersonatedClause}
     ORDER BY a.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function getAuditEventDetail(businessId, eventId) {
  const { rows } = await dbQuery(
    `SELECT
       a.id,
       a.created_at,
       a.actor_type,
       a.actor_id,
       a.action,
       a.meta,
       s.name AS actor_name,
       s.email AS actor_email
     FROM audit_logs a
     LEFT JOIN staff_users s ON s.id = a.actor_id
     WHERE a.business_id = $1
       AND a.id = $2`,
    [businessId, eventId]
  );
  const event = rows[0] ?? null;
  if (!event) return null;

  const meta = event.meta && typeof event.meta === "object" ? event.meta : {};
  const detail = { event, linked: {} };

  if (meta.transaction_id) {
    const tx = await dbQuery(
      `SELECT
         t.*,
         c.name AS customer_name,
         c.phone AS customer_phone,
         su.name AS staff_name
       FROM transactions t
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN staff_users su ON su.id = t.staff_user_id
       WHERE t.business_id = $1
         AND t.id = $2`,
      [businessId, meta.transaction_id]
    );
    detail.linked.transaction = tx.rows[0] ?? null;
  }

  if (meta.reversal_transaction_id) {
    const tx = await dbQuery(
      `SELECT
         t.*,
         c.name AS customer_name,
         c.phone AS customer_phone,
         su.name AS staff_name
       FROM transactions t
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN staff_users su ON su.id = t.staff_user_id
       WHERE t.business_id = $1
         AND t.id = $2`,
      [businessId, meta.reversal_transaction_id]
    );
    detail.linked.reversal_transaction = tx.rows[0] ?? null;
  }

  if (meta.redemption_id) {
    const redemption = await dbQuery(
      `SELECT
         r.*,
         rw.name AS reward_name,
         c.name AS customer_name,
         c.phone AS customer_phone
       FROM redemptions r
       JOIN rewards rw ON rw.id = r.reward_id
       JOIN customers c ON c.id = r.customer_id
       WHERE r.business_id = $1
         AND r.id = $2`,
      [businessId, meta.redemption_id]
    );
    detail.linked.redemption = redemption.rows[0] ?? null;
  }

  if (meta.gift_card_id) {
    const card = await dbQuery(
      `SELECT *
       FROM gift_cards
       WHERE business_id = $1
         AND id = $2`,
      [businessId, meta.gift_card_id]
    );
    detail.linked.gift_card = card.rows[0] ?? null;
  }

  if (meta.gift_card_tx_id) {
    const tx = await dbQuery(
      `SELECT *
       FROM gift_card_transactions
       WHERE business_id = $1
         AND id = $2`,
      [businessId, meta.gift_card_tx_id]
    );
    detail.linked.gift_card_transaction = tx.rows[0] ?? null;
  }

  return detail;
}

adminAuditRoutes.get(
  "/admin/audit",
  requireStaff,
  requireOwner,
  tenantContext,
  validateQuery(auditQuerySchema.extend({
    limit: z.coerce.number().int().min(1).max(200).default(50)
  })),
  asyncRoute(async (req, res) => {
    const {
      limit,
      impersonated_only: impersonatedOnly,
      from,
      to
    } = req.validatedQuery;
    const rows = await listAuditEvents(req.tenantId, { limit, impersonatedOnly, from, to });
    return res.json({ ok: true, events: rows });
  })
);

adminAuditRoutes.get(
  "/admin/audit/:id",
  requireStaff,
  requireOwner,
  tenantContext,
  asyncRoute(async (req, res) => {
    const detail = await getAuditEventDetail(req.tenantId, String(req.params.id || ""));
    if (!detail) return res.status(404).json({ error: "Audit event not found" });
    return res.json({ ok: true, ...detail });
  })
);

adminAuditRoutes.get(
  "/admin/audit.csv",
  requireStaff,
  requireOwner,
  tenantContext,
  validateQuery(auditQuerySchema),
  asyncRoute(async (req, res) => {
    const {
      limit,
      impersonated_only: impersonatedOnly,
      from,
      to
    } = req.validatedQuery;
    const rows = await listAuditEvents(req.tenantId, { limit, impersonatedOnly, from, to });
    const csvRows = rows.map((row) => ({
      created_at: row.created_at,
      actor_type: row.actor_type,
      actor_name: row.actor_name || "",
      actor_email: row.actor_email || "",
      action: row.action,
      impersonated_by_super_admin_email: row.meta?.impersonated_by_super_admin_email || "",
      meta: row.meta && Object.keys(row.meta).length ? JSON.stringify(row.meta) : ""
    }));
    const csv = toCSV(csvRows, [
      "created_at",
      "actor_type",
      "actor_name",
      "actor_email",
      "action",
      "impersonated_by_super_admin_email",
      "meta"
    ]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"audit-log.csv\"");
    return res.send(csv);
  })
);
