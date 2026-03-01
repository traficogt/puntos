import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { CustomerRepo } from "../../repositories/customer-repository.js";
import { toCSV } from "../../../utils/csv.js";

export const adminCustomerRoutes = Router();

adminCustomerRoutes.get(
  "/admin/customers.csv",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("customer_export"),
  asyncRoute(async (req, res) => {
    const rows = await CustomerRepo.listByBusiness(req.tenantId, 5000);
    const csv = toCSV(rows, ["id", "phone", "name", "created_at", "last_visit_at", "points", "lifetime_points"]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"customers.csv\"");
    return res.send(csv);
  })
);

