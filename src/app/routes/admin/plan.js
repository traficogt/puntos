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
    if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
    const limits = planLimits(business.plan);
    const overrides = await PlanConfigService.getPlanFeatureOverrides().catch(() => ({}));
    const features = planFeaturesWithOverrides(business.plan, overrides);
    // Soft-cap usage: "active" = visited or created within 90 days, the same rule the plan limit
    // uses. Caps never block a sale at the counter; this lets the owner see headroom and plan ahead.
    // A usage failure must never break plan info (the dashboard gates on it), hence the null fallback.
    const activeCustomers = await BusinessRepo.activeCustomerCount(req.tenantId).catch(() => null);
    /** @type {AdminPlanResponse} */
    const response = {
      ok: true,
      plan: business.plan,
      limits,
      features,
      usage: { active_customers: activeCustomers },
    };
    return res.json(response);
  }),
);
