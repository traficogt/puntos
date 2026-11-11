import { Router } from "express";
import { z } from "zod";

import { requireOwner } from "../../../middleware/auth.js";
import { asyncRoute } from "../../../middleware/common.js";
import { getMerchantOverview } from "../../services/merchant-overview-service.js";

export const analyticsOverviewRoutes = Router();

const OverviewQuery = z.object({
  days: z.enum(["7", "30", "90"]).default("30").transform(Number),
  branch_id: z.guid().transform(value => value.toLowerCase()).optional()
}).strict();

// Staff authentication, tenant context and the analytics plan gate are applied
// by analytics-routes.js before this owner-only endpoint is reached.
analyticsOverviewRoutes.get(
  "/admin/analytics/overview",
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
