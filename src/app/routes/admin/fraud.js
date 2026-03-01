import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validateQuery, branchFilterQuerySchema } from "../../../utils/schemas.js";
import { requireOwner, requireStaff, requireStaffPermission } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { Permission } from "../../../utils/permissions.js";
import { BranchRepo } from "../../repositories/branch-repository.js";
import { dbQuery } from "../../database.js";

export const adminFraudRoutes = Router();

adminFraudRoutes.get(
  "/admin/awards/suspicious",
  requireStaff,
  tenantContext,
  requirePlanFeature("fraud_monitoring"),
  requireStaffPermission(Permission.ADMIN_SUSPICIOUS_VIEW),
  validateQuery(branchFilterQuerySchema.extend({
    limit: z.coerce.number().int().min(1).max(200).default(50)
  })),
  asyncRoute(async (req, res) => {
    const { limit } = req.validatedQuery;
    const branchId = req.validatedQuery.branch_id ? String(req.validatedQuery.branch_id) : null;
    if (branchId) {
      const branch = await BranchRepo.getById(branchId);
      if (!branch || branch.business_id !== req.tenantId) {
        return res.status(400).json({ error: "Invalid branch_id" });
      }
    }
    const params = [req.tenantId, limit];
    let branchClause = "";
    if (branchId) {
      params.push(branchId);
      branchClause = " AND t.branch_id = $3";
    }
    const { rows } = await dbQuery(
      `SELECT
         t.id,
         t.created_at,
         t.branch_id,
         br.name AS branch_name,
         t.customer_id,
         c.name AS customer_name,
         c.phone AS customer_phone,
         t.staff_user_id,
         su.name AS staff_name,
         su.email AS staff_email,
         t.amount_q,
         t.visits,
         t.items,
         t.points,
         t.meta->'guard' AS guard
       FROM transactions t
       JOIN customers c ON c.id = t.customer_id
       LEFT JOIN staff_users su ON su.id = t.staff_user_id
       LEFT JOIN branches br ON br.id = t.branch_id
       WHERE t.business_id = $1
         AND COALESCE((t.meta->'guard'->>'suspicious')::boolean, false) = true
         ${branchClause}
       ORDER BY t.created_at DESC
       LIMIT $2`,
      params
    );
    return res.json({ ok: true, awards: rows });
  })
);

adminFraudRoutes.get(
  "/admin/alerts",
  requireStaff,
  requireOwner,
  tenantContext,
  validateQuery(z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50)
  })),
  asyncRoute(async (req, res) => {
    const { limit } = req.validatedQuery;
    const perType = Math.max(5, Math.min(50, Math.ceil(limit / 4)));
    const businessId = req.tenantId;

    const [suspiciousRes, jobsRes, webhookRes, paymentRes] = await Promise.all([
      dbQuery(
        `SELECT
           id,
           created_at,
           'HIGH'::text AS severity,
           'suspicious_award'::text AS alert_type,
           COALESCE(meta->'guard'->'reasons', '[]'::jsonb) AS details
         FROM transactions
         WHERE business_id = $1
           AND COALESCE((meta->'guard'->>'suspicious')::boolean, false) = true
         ORDER BY created_at DESC
         LIMIT $2`,
        [businessId, perType]
      ),
      dbQuery(
        `SELECT
           id,
           created_at,
           'MEDIUM'::text AS severity,
           'job_failed'::text AS alert_type,
           jsonb_build_object('job_type', job_type, 'error', error) AS details
         FROM background_jobs
         WHERE business_id = $1
           AND status = 'FAILED'
         ORDER BY created_at DESC
         LIMIT $2`,
        [businessId, perType]
      ),
      dbQuery(
        `SELECT
           d.id,
           d.created_at,
           'MEDIUM'::text AS severity,
           'webhook_delivery_failed'::text AS alert_type,
           jsonb_build_object('event', d.event, 'last_error', d.last_error, 'attempts', d.attempts, 'endpoint', e.url) AS details
         FROM webhook_deliveries d
         JOIN webhook_endpoints e ON e.id = d.endpoint_id
         WHERE e.business_id = $1
           AND d.status = 'FAILED'
         ORDER BY d.created_at DESC
         LIMIT $2`,
        [businessId, perType]
      ),
      dbQuery(
        `SELECT
           id,
           created_at,
           CASE WHEN status = 'FAILED' THEN 'MEDIUM'::text ELSE 'LOW'::text END AS severity,
           'payment_webhook_issue'::text AS alert_type,
           jsonb_build_object('status', status, 'reason', reason, 'error', error, 'provider', provider) AS details
         FROM payment_webhook_events
         WHERE business_id = $1
           AND status IN ('FAILED', 'PENDING_MAPPING')
         ORDER BY created_at DESC
         LIMIT $2`,
        [businessId, perType]
      )
    ]);

    const alerts = [
      ...suspiciousRes.rows,
      ...jobsRes.rows,
      ...webhookRes.rows,
      ...paymentRes.rows
    ]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);

    return res.json({ ok: true, alerts });
  })
);
