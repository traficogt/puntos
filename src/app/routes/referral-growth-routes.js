import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { asyncRoute } from "../../middleware/common.js";
import { tenantContext } from "../../middleware/tenant.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { getReferralGrowth } from "../services/referral-growth-service.js";

const Query = z
  .object({
    days: z.enum(["30", "90"]).default("30").transform(Number),
    phase: z.enum(["all", "awaiting_purchase", "purchased"]).default("all"),
    limit: z
      .string()
      .regex(/^\d+$/)
      .default("25")
      .transform(Number)
      .pipe(z.number().int().min(1).max(100)),
    offset: z
      .string()
      .regex(/^\d+$/)
      .default("0")
      .transform(Number)
      .pipe(z.number().int().min(0).max(10000)),
  })
  .strict();

export function createReferralGrowthRoutes({
  getGrowth = getReferralGrowth,
} = {}) {
  const router = Router();
  router.get(
    "/admin/referral-growth",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("referrals"),
    asyncRoute(async (req, res) => {
      const parsed = Query.safeParse(req.query);
      if (!parsed.success)
        return res
          .status(400)
          .json({
            error: "Selecciona un período, un filtro y una página válidos.",
            code: "VALIDATION_ERROR",
          });
      return res.json(
        await getGrowth({ businessId: req.tenantId, ...parsed.data }),
      );
    }),
  );
  return router;
}
