import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { PlanConfigService } from "../../services/plan-config-service.js";
import { planFeaturesWithOverrides, planLimits } from "../../../utils/plan.js";

/** @typedef {import("../../../types/http-dto.js").AdminPlanResponse} AdminPlanResponse */

export const adminPlanRoutes = Router();

adminPlanRoutes.get(
  "/admin/plan",
  requireStaff,
  requireOwner,
  tenantContext,
  asyncRoute(async (req, res) => {
    const business = await BusinessRepo.getById(req.tenantId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    const limits = planLimits(business.plan);
    const overrides = await PlanConfigService.getPlanFeatureOverrides().catch(() => ({}));
    const features = planFeaturesWithOverrides(business.plan, overrides);
    /** @type {AdminPlanResponse} */
    const response = { ok: true, plan: business.plan, limits, features };
    return res.json(response);
  })
);
