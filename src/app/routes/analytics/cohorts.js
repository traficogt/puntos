import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validateQuery } from "../../../utils/schemas.js";
import { AnalyticsRepository } from "../../repositories/analytics-repository.js";

/** @typedef {import("../_request-types.js").Response} Response */
/** @typedef {import("../_request-types.js").TenantRequest} TenantRequest */
/**
 * @template Q
 * @typedef {import("../_request-types.js").WithValidatedQuery<Q>} WithValidatedQuery
 */

export const analyticsCohortRoutes = Router();

export const CohortRetentionQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(60).default(12),
});

export const TopCustomersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** @typedef {z.infer<typeof CohortRetentionQuerySchema>} CohortRetentionQuery */
/** @typedef {z.infer<typeof TopCustomersQuerySchema>} TopCustomersQuery */

analyticsCohortRoutes.get(
  "/admin/analytics/cohorts",
  validateQuery(CohortRetentionQuerySchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedQuery<CohortRetentionQuery>} req @param {Response} res */
    async (req, res) => {
      const { months } = req.validatedQuery;

      const cohorts = await AnalyticsRepository.getCohortRetention(req.tenantId, months);

      return res.json({ ok: true, cohorts });
    },
  ),
);

analyticsCohortRoutes.get(
  "/admin/analytics/top-customers",
  validateQuery(TopCustomersQuerySchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedQuery<TopCustomersQuery>} req @param {Response} res */
    async (req, res) => {
      const { limit } = req.validatedQuery;

      const customers = await AnalyticsRepository.getTopCustomersByLTV(req.tenantId, limit);

      return res.json({ ok: true, customers });
    },
  ),
);
