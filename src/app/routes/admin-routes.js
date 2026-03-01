import { Router } from "express";

import { adminSignupRoutes } from "./admin/signup.js";
import { adminInsightsRoutes } from "./admin/insights.js";
import { adminBillingRoutes } from "./admin/billing.js";
import { adminRewardsRoutes } from "./admin/rewards.js";
import { adminBranchRoutes } from "./admin/branches.js";
import { adminStaffRoutes } from "./admin/staff.js";
import { adminCustomerRoutes } from "./admin/customers.js";
import { adminWebhookRoutes } from "./admin/webhooks.js";
import { adminProgramRoutes } from "./admin/program.js";
import { adminPlanRoutes } from "./admin/plan.js";
import { adminFraudRoutes } from "./admin/fraud.js";
import { adminAuditRoutes } from "./admin/audit.js";
import { adminOpsRoutes } from "./admin/ops.js";
import { adminRbacRoutes } from "./admin/rbac.js";

export const adminRoutes = Router();

adminRoutes.use(adminSignupRoutes);
adminRoutes.use(adminInsightsRoutes);
adminRoutes.use(adminBillingRoutes);
adminRoutes.use(adminRewardsRoutes);
adminRoutes.use(adminBranchRoutes);
adminRoutes.use(adminStaffRoutes);
adminRoutes.use(adminCustomerRoutes);
adminRoutes.use(adminWebhookRoutes);
adminRoutes.use(adminProgramRoutes);
adminRoutes.use(adminPlanRoutes);
adminRoutes.use(adminFraudRoutes);
adminRoutes.use(adminAuditRoutes);
adminRoutes.use(adminOpsRoutes);
adminRoutes.use(adminRbacRoutes);

