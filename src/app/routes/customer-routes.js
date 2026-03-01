import { Router } from "express";
import { asyncRoute } from "../../middleware/common.js";
import { requireCustomer } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { TxnRepo } from "../repositories/transaction-repository.js";
import { RewardRepo } from "../repositories/reward-repository.js";
import { RedemptionRepo } from "../repositories/redemption-repository.js";
import { toCSV } from "../../utils/csv.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { settlePendingPointsForCustomer, expirePointsForCustomer } from "../services/loyalty-ops-service.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/index.js";
import { tenantContext } from "../../middleware/tenant.js";

export const customerRoutes = Router();

customerRoutes.get("/customer/me", requireCustomer, tenantContext, asyncRoute(async (req, res) => {
  if (!req.tenantId) return res.status(400).json({ error: "Tenant context missing", code: "TENANT_REQUIRED" });
  const auth = req.customerAuth;
  if (config.NODE_ENV !== "test") {
    await settlePendingPointsForCustomer(auth.id, auth.business_id).catch((err) => {
      logger.warn({ err: err?.message, customerId: auth.id, businessId: auth.business_id }, "settlePendingPointsForCustomer failed");
    });
    await expirePointsForCustomer(auth.id, auth.business_id).catch((err) => {
      logger.warn({ err: err?.message, customerId: auth.id, businessId: auth.business_id }, "expirePointsForCustomer failed");
    });
  }
  const customer = await CustomerRepo.getById(auth.id);
  if (!customer || customer.business_id !== auth.business_id) return res.status(404).json({ error: "Customer not found" });
  const business = await BusinessRepo.getById(req.tenantId);
  res.json({
    ok: true,
    business: { id: business.id, name: business.name, slug: business.slug },
    customer: {
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
      points: customer.points,
      pending_points: customer.pending_points,
      lifetime_points: customer.lifetime_points,
      created_at: customer.created_at,
      last_visit_at: customer.last_visit_at
    }
  });
}));

customerRoutes.get("/customer/history", requireCustomer, tenantContext, asyncRoute(async (req, res) => {
  const auth = req.customerAuth;
  const tx = await TxnRepo.listByCustomer(auth.id, 50);
  const red = await RedemptionRepo.listByCustomer(auth.id, 50);
  res.json({ ok: true, transactions: tx, redemptions: red });
}));

customerRoutes.get("/customer/rewards", requireCustomer, tenantContext, requirePlanFeature("rewards"), asyncRoute(async (req, res) => {
  const auth = req.customerAuth;
  const rewards = await RewardRepo.listByBusiness(auth.business_id);
  res.json({ ok: true, rewards: rewards.filter(r => r.active) });
}));

customerRoutes.get("/customer/export", requireCustomer, tenantContext, requirePlanFeature("customer_export"), asyncRoute(async (req, res) => {
  const auth = req.customerAuth;
  const customer = await CustomerRepo.getById(auth.id);
  const tx = await TxnRepo.listByCustomer(auth.id, 200);
  const red = await RedemptionRepo.listByCustomer(auth.id, 200);

  const csv = toCSV(
    [{
      customer_id: customer.id,
      phone: customer.phone,
      name: customer.name,
      points: customer.points,
      pending_points: customer.pending_points,
      lifetime_points: customer.lifetime_points
    }],
    ["customer_id", "phone", "name", "points", "pending_points", "lifetime_points"]
  );

  res.setHeader("Content-Type", "application/json");
  res.json({ customer, transactions: tx, redemptions: red, csv_customer: csv });
}));

customerRoutes.delete("/customer/me", csrfProtect, requireCustomer, tenantContext, asyncRoute(async (req, res) => {
  const auth = req.customerAuth;
  await CustomerRepo.softDelete(auth.id);
  res.json({ ok: true });
}));
