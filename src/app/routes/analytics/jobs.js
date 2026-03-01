import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validateQuery } from "../../../utils/schemas.js";
import { requireOwner } from "../../../middleware/auth.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { enqueueJob } from "../../services/job-service.js";
import { JobRepo } from "../../repositories/job-repository.js";

export const analyticsJobRoutes = Router();

analyticsJobRoutes.post(
  "/admin/analytics/calculate",
  csrfProtect,
  requireOwner,
  asyncRoute(async (req, res) => {
    const job = await enqueueJob({
      businessId: req.tenantId,
      jobType: "analytics.calculate",
      payload: { trigger: "manual" }
    });
    return res.status(202).json({
      ok: true,
      message: "Recalculo de analitica en cola",
      job: { id: job.id, status: job.status, created_at: job.created_at }
    });
  })
);

analyticsJobRoutes.get(
  "/admin/jobs/:id",
  requireOwner,
  asyncRoute(async (req, res) => {
    const job = await JobRepo.getById(String(req.params.id));
    if (!job || job.business_id !== req.tenantId) {
      return res.status(404).json({ error: "Job not found" });
    }
    return res.json({
      ok: true,
      job: {
        id: job.id,
        job_type: job.job_type,
        status: job.status,
        attempts: job.attempts,
        created_at: job.created_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        error: job.error
      }
    });
  })
);

analyticsJobRoutes.get(
  "/admin/jobs",
  requireOwner,
  validateQuery(z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20)
  })),
  asyncRoute(async (req, res) => {
    const { limit } = req.validatedQuery;
    const jobs = await JobRepo.listByBusiness(req.tenantId, limit);
    return res.json({
      ok: true,
      jobs: jobs.map((j) => ({
        id: j.id,
        job_type: j.job_type,
        status: j.status,
        attempts: j.attempts,
        created_at: j.created_at,
        started_at: j.started_at,
        completed_at: j.completed_at,
        error: j.error
      }))
    });
  })
);
