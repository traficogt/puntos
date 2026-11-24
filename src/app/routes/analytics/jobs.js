import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { uuidParamsSchema, validateParams, validateQuery } from "../../../utils/schemas.js";
import { requireOwner } from "../../../middleware/auth.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { enqueueJob } from "../../services/job-service.js";
import { JobRepo } from "../../repositories/job-repository.js";

/** @typedef {import("../_request-types.js").Response} Response */
/** @typedef {import("../_request-types.js").TenantRequest} TenantRequest */
/**
 * @template Q
 * @typedef {import("../_request-types.js").WithValidatedQuery<Q>} WithValidatedQuery
 */
/**
 * @template P
 * @typedef {import("../_request-types.js").WithValidatedParams<P>} WithValidatedParams
 */
/** @typedef {z.infer<typeof uuidParamsSchema>} UuidParams */

/**
 * The signature `enqueueJob` (services/job-service.js) implements. Its
 * `businessId = null` default makes TypeScript infer the parameter as `null`
 * only, so a tenant id cannot be passed through the inferred type; the services
 * owner should annotate it, after which this alias can go. It resolves to the
 * row it just inserted (re-read by id).
 * @typedef {(input: {
 *   businessId: string | null,
 *   jobType: string,
 *   payload?: Record<string, unknown>,
 *   runAfter?: Date | string | null
 * }) => Promise<import("../../repositories/job-repository.js").BackgroundJobRow>} EnqueueJob
 */
const enqueueBackgroundJob = /** @type {EnqueueJob} */ (/** @type {unknown} */ (enqueueJob));

export const analyticsJobRoutes = Router();

const jobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** @typedef {z.infer<typeof jobsQuerySchema>} JobsQuery */

analyticsJobRoutes.post(
  "/admin/analytics/calculate",
  csrfProtect,
  requireOwner,
  asyncRoute(
    /** @param {TenantRequest} req @param {Response} res */
    async (req, res) => {
      const job = await enqueueBackgroundJob({
        businessId: req.tenantId,
        jobType: "analytics.calculate",
        payload: { trigger: "manual" },
      });
      return res.status(202).json({
        ok: true,
        message: "Recalculo de analitica en cola",
        job: { id: job.id, status: job.status, created_at: job.created_at },
      });
    },
  ),
);

analyticsJobRoutes.get(
  "/admin/jobs/:id",
  requireOwner,
  validateParams(uuidParamsSchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedParams<UuidParams>} req @param {Response} res */
    async (req, res) => {
      const job = await JobRepo.getById(req.validatedParams.id);
      if (!job || job.business_id !== req.tenantId) {
        return res.status(404).json({ error: "Tarea no encontrada" });
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
          error: job.error,
        },
      });
    },
  ),
);

analyticsJobRoutes.get(
  "/admin/jobs",
  requireOwner,
  validateQuery(jobsQuerySchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedQuery<JobsQuery>} req @param {Response} res */
    async (req, res) => {
      const { limit } = req.validatedQuery;
      /** @type {import("../../repositories/job-repository.js").BackgroundJobRow[]} */
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
          error: j.error,
        })),
      });
    },
  ),
);
