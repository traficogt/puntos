import { Router } from "express";
import { z } from "zod";

import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { asyncRoute } from "../../../middleware/common.js";
import { getMerchantOverview } from "../../services/merchant-overview-service.js";

export const analyticsOverviewRoutes = Router();

const OverviewQuery = z.object({
  days: z.enum(["7", "30", "90"]).default("30").transform(Number),
  branch_id: z.guid().transform(value => value.toLowerCase()).optional()
}).strict();

// Basic participation reporting: gated on `basic_reporting` (available on every tier) at the
// route level, so the deep-analytics gate in analytics-routes.js never applies to it.
analyticsOverviewRoutes.get(
  "/admin/analytics/overview",
  requireStaff,
  tenantContext,
  requirePlanFeature("basic_reporting"),
  requireOwner,
  asyncRoute(async (req, res) => {
    const parsed = OverviewQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Selecciona 7, 30 o 90 días y una sucursal válida.", code: "VALIDATION_ERROR" });
    }
    const result = await getMerchantOverview({
      businessId: req.tenantId,
      days: parsed.data.days,
      branchId: parsed.data.branch_id ?? null
    });
    return res.json(result);
  })
);
