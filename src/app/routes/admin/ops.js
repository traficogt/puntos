import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { dbQuery } from "../../database.js";
import { enqueueJob } from "../../services/job-service.js";

export const adminOpsRoutes = Router();

adminOpsRoutes.get(
  "/admin/ops/summary",
  requireStaff,
  requireOwner,
  tenantContext,
  asyncRoute(async (req, res) => {
    const businessId = req.tenantId;

    const [jobsAgg, webhookAgg, paymentAgg, suspiciousAgg, recentFailedJobs] = await Promise.all([
      dbQuery(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed_jobs,
           COUNT(*) FILTER (WHERE status IN ('QUEUED', 'RUNNING'))::int AS pending_jobs,
           COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS jobs_last_24h
         FROM background_jobs
         WHERE business_id = $1`,
        [businessId]
      ),
      dbQuery(
        `SELECT
           COUNT(*) FILTER (WHERE d.status = 'FAILED')::int AS failed_webhooks,
           COUNT(*) FILTER (WHERE d.status = 'PENDING')::int AS pending_webhooks
         FROM webhook_deliveries d
         JOIN webhook_endpoints e ON e.id = d.endpoint_id
         WHERE e.business_id = $1`,
        [businessId]
      ),
      dbQuery(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'PENDING_MAPPING')::int AS pending_mapping,
           COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed_payment_webhooks
         FROM payment_webhook_events
         WHERE business_id = $1`,
        [businessId]
      ),
      dbQuery(
        `SELECT COUNT(*)::int AS suspicious_awards_24h
         FROM transactions
         WHERE business_id = $1
           AND created_at >= now() - interval '24 hours'
           AND COALESCE((meta->'guard'->>'suspicious')::boolean, false) = true`,
        [businessId]
      ),
      dbQuery(
        `SELECT id, job_type, status, created_at, error
         FROM background_jobs
         WHERE business_id = $1
           AND status = 'FAILED'
         ORDER BY created_at DESC
         LIMIT 5`,
        [businessId]
      )
    ]);

    const failedJobs = Number(jobsAgg.rows?.[0]?.failed_jobs ?? 0);
    const pendingJobs = Number(jobsAgg.rows?.[0]?.pending_jobs ?? 0);
    const failedWebhooks = Number(webhookAgg.rows?.[0]?.failed_webhooks ?? 0);
    const pendingWebhooks = Number(webhookAgg.rows?.[0]?.pending_webhooks ?? 0);
    const pendingMapping = Number(paymentAgg.rows?.[0]?.pending_mapping ?? 0);
    const failedPaymentWebhooks = Number(paymentAgg.rows?.[0]?.failed_payment_webhooks ?? 0);
    const suspicious24h = Number(suspiciousAgg.rows?.[0]?.suspicious_awards_24h ?? 0);

    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      summary: {
        failed_jobs: failedJobs,
        pending_jobs: pendingJobs,
        failed_webhooks: failedWebhooks,
        pending_webhooks: pendingWebhooks,
        payment_pending_mapping: pendingMapping,
        payment_failed: failedPaymentWebhooks,
        suspicious_awards_24h: suspicious24h,
        health_score: Math.max(
          0,
          100 - (failedJobs * 8) - (failedWebhooks * 6) - (failedPaymentWebhooks * 5) - (suspicious24h * 2)
        )
      },
      recent_failed_jobs: recentFailedJobs.rows
    });
  })
);

adminOpsRoutes.post(
  "/admin/lifecycle/run",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("lifecycle_automation"),
  csrfProtect,
  asyncRoute(async (req, res) => {
    const job = await enqueueJob({
      businessId: req.tenantId,
      jobType: "lifecycle.run",
      payload: { trigger: "manual" }
    });
    return res.status(202).json({ ok: true, job: { id: job.id, status: job.status, created_at: job.created_at } });
  })
);

