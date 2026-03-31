import { Router } from "express";

import { requireStaff } from "../../middleware/auth.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { tenantContext } from "../../middleware/tenant.js";

import { analyticsJobRoutes } from "./analytics/jobs.js";
import { analyticsChurnRoutes } from "./analytics/churn.js";
import { analyticsSegmentRoutes } from "./analytics/segments.js";
import { analyticsCohortRoutes } from "./analytics/cohorts.js";
import { analyticsRfmRoutes } from "./analytics/rfm.js";
import { analyticsDashboardRoutes } from "./analytics/dashboard.js";
import { analyticsCustomerRoutes } from "./analytics/customer-360.js";
import { analyticsLedgerRoutes } from "./analytics/ledger.js";
import { analyticsRedemptionRoutes } from "./analytics/redemptions.js";
import { analyticsAnomalyRoutes } from "./analytics/anomalies.js";
import { analyticsCorrectionRoutes } from "./analytics/corrections.js";
import { analyticsCertificationRoutes } from "./analytics/certification.js";

const router = Router();

// Scope analytics gating to analytics/job endpoints only.
// This router is mounted alongside other routers that also use `/admin/*` paths;
// using `/admin` here would inadvertently block unrelated admin routes (e.g. gift cards).
router.use(["/admin/analytics", "/admin/jobs"], requireStaff, tenantContext, requirePlanFeature("analytics"));

router.use(analyticsJobRoutes);
router.use(analyticsChurnRoutes);
router.use(analyticsSegmentRoutes);
router.use(analyticsCohortRoutes);
router.use(analyticsRfmRoutes);
router.use(analyticsDashboardRoutes);
router.use(analyticsCustomerRoutes);
router.use(analyticsLedgerRoutes);
router.use(analyticsRedemptionRoutes);
router.use(analyticsAnomalyRoutes);
router.use(analyticsCorrectionRoutes);
router.use(analyticsCertificationRoutes);

export default router;
