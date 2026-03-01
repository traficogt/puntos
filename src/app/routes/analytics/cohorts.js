import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validateQuery } from "../../../utils/schemas.js";
import { AnalyticsRepository } from "../../repositories/analytics-repository.js";

export const analyticsCohortRoutes = Router();

analyticsCohortRoutes.get(
  "/admin/analytics/cohorts",
  validateQuery(z.object({
    months: z.coerce.number().int().min(1).max(60).default(12)
  })),
  asyncRoute(async (req, res) => {
    const { months } = req.validatedQuery;

    const cohorts = await AnalyticsRepository.getCohortRetention(req.tenantId, months);

    return res.json({ ok: true, cohorts });
  })
);

analyticsCohortRoutes.get(
  "/admin/analytics/top-customers",
  validateQuery(z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50)
  })),
  asyncRoute(async (req, res) => {
    const { limit } = req.validatedQuery;

    const customers = await AnalyticsRepository.getTopCustomersByLTV(req.tenantId, limit);

    return res.json({ ok: true, customers });
  })
);
