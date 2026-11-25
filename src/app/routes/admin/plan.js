import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { TrialRepo } from "../../repositories/trial-repository.js";
import { PlanConfigService } from "../../services/plan-config-service.js";
import { ownerTrialPayload, planDisplayName } from "../../services/trial-entitlement.js";
import { planFeaturesWithOverrides, planLimits } from "../../../utils/plan.js";

/** @typedef {import("../../../types/http-dto.js").AdminPlanResponse} AdminPlanResponse */
/** @typedef {import("../_request-types.js").Response} Response */
/** @typedef {import("../_request-types.js").TenantRequest} TenantRequest */

export const adminPlanRoutes = Router();

adminPlanRoutes.get(
  "/admin/plan",
  requireStaff,
  requireOwner,
  tenantContext,
  asyncRoute(
    /** @param {TenantRequest} req @param {Response} res */
    async (req, res) => {
      const business = await BusinessRepo.getById(req.tenantId);
      if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
      const limits = planLimits(business.plan);
      const overrides = await PlanConfigService.getPlanFeatureOverrides().catch(() => ({}));
      const features = planFeaturesWithOverrides(business.plan, overrides);
      // Soft-cap usage: "active" = visited or created within 90 days, the same rule the plan limit
      // uses. Caps never block a sale at the counter; this lets the owner see headroom and plan ahead.
      // A usage failure must never break plan info (the dashboard gates on it), hence the null fallback.
      const activeCustomers = await BusinessRepo.activeCustomerCount(req.tenantId).catch(
        () => null,
      );
      // Additive trial/billing state (design section 7.3): the installed PWA ignores the
      // new keys; the Mantine banner and lock screen read them.
      const subscription = await TrialRepo.activeSubscription(req.tenantId).catch(() => null);
      const { trial, billing } = ownerTrialPayload(business, { subscription });
      /** @type {AdminPlanResponse} */
      const response = {
        ok: true,
        plan: business.plan,
        plan_name: planDisplayName(business.plan),
        limits,
        features,
        usage: { active_customers: activeCustomers },
        trial: {
          status: trial.status,
          started_at: trial.started_at,
          ends_at: trial.ends_at,
          days_left: trial.days_left,
          upgrade_url: trial.upgrade_url,
        },
        billing,
      };
      return res.json(response);
    },
  ),
);
