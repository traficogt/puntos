import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { previewPosSale } from "../../services/pos-integration-service.js";

export function createPosOnboardingRoutes(deps = {}) {
  const router = Router();
  router.post("/admin/pos/preflight",
    deps.requireStaff ?? requireStaff, requireOwner, tenantContext,
    requirePlanFeature("external_awards"), csrfProtect,
    asyncRoute(async (req, res) => {
      res.set("Cache-Control", "no-store");
      return res.json(await (deps.previewPosSale ?? previewPosSale)(req.tenantId, req.body));
    }));
  return router;
}

export const posOnboardingRoutes = createPosOnboardingRoutes();
