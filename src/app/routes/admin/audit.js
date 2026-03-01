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
