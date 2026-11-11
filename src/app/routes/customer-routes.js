import { getDbClient } from '../database.js';
import { withPublicRewardAvailability } from '../services/reward-inventory-public.js';
import { getCustomerRewardProgress } from '../services/customer-reward-progress.js';
import { getCustomerStatement } from '../services/customer-statement-service.js';
import { businessRegion } from "../services/regional-settings.js";
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
import { PlanConfigService } from "../services/plan-config-service.js";
import { settlePendingPointsForCustomer, expirePointsForCustomer } from "../services/loyalty-ops-service.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/index.js";
import { tenantContext } from "../../middleware/tenant.js";
import { invalidateBrowserSessionById, invalidateBrowserSessionsForActor } from "../services/auth-session-service.js";
import { planFeaturesWithOverrides } from "../../utils/plan.js";

export const customerRoutes = Router();

function rejectMissingCustomer(req, res) {
  if (req.authSession?.id) {
    void invalidateBrowserSessionById(req.authSession.id, "customer_missing").catch(() => {});
  }
  res.clearCookie(config.CUSTOMER_COOKIE_NAME, { path: "/" });
  res.status(404).json({ error: "Customer not found", code: "CUSTOMER_NOT_FOUND" });
}

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
  if (!customer || customer.business_id !== auth.business_id) return rejectMissingCustomer(req, res);
  const business = await BusinessRepo.getById(req.tenantId);
  if (!business || business.id !== auth.business_id) return rejectMissingCustomer(req, res);
  const overrides = await PlanConfigService.getPlanFeatureOverrides().catch(() => ({}));
  const features = planFeaturesWithOverrides(business.plan, overrides);
  res.json({
    ok: true,
    business: {
      id: business.id,
      name: business.name,
      slug: business.slug,
      plan: business.plan,
      features,
      region: businessRegion(business),
      customer_branding: business.customer_branding_json ?? null
    },
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
  const customer = await CustomerRepo.getById(auth.id);
  if (!customer || customer.business_id !== auth.business_id) return rejectMissingCustomer(req, res);
  const tx = await TxnRepo.listByCustomer(auth.id, 50);
  const red = await RedemptionRepo.listByCustomer(auth.id, 50);
  res.json({ ok: true, transactions: tx, redemptions: red });
}));

customerRoutes.get("/customer/statement", requireCustomer, tenantContext, asyncRoute(async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (Object.keys(req.query).length) return res.status(400).json({ error: "El resumen muestra los últimos 30 días.", code: "VALIDATION_ERROR" });
  const auth = req.customerAuth;
  if (!req.tenantId || req.tenantId !== auth.business_id) return rejectMissingCustomer(req, res);
  const statement = await getCustomerStatement(getDbClient(), { businessId: auth.business_id, customerId: auth.id });
  if (!statement) return rejectMissingCustomer(req, res);
  return res.json({ ok: true, statement });
}));

customerRoutes.get("/customer/rewards", requireCustomer, tenantContext, requirePlanFeature("rewards"), asyncRoute(async (req, res) => {
  const auth = req.customerAuth;
  const customer = await CustomerRepo.getById(auth.id);
  if (!customer || customer.business_id !== auth.business_id) return rejectMissingCustomer(req, res);
  const rewards = await RewardRepo.listByBusiness(auth.business_id);
  const business = req._resolvedBusiness?.id === auth.business_id ? req._resolvedBusiness : await BusinessRepo.getById(auth.business_id);
  if (!business || business.id !== auth.business_id) return rejectMissingCustomer(req, res);
  const visible = await withPublicRewardAvailability(getDbClient(), { business, rewards: rewards.filter(r => r.active) });
  const progress = await getCustomerRewardProgress(getDbClient(), { businessId: auth.business_id, customerId: auth.id });
  if (!progress) return rejectMissingCustomer(req, res);
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, rewards: visible, progress });
}));

customerRoutes.get("/customer/export", requireCustomer, tenantContext, asyncRoute(async (req, res) => {
  const auth = req.customerAuth;
  const customer = await CustomerRepo.getById(auth.id);
  if (!customer || customer.business_id !== auth.business_id) return rejectMissingCustomer(req, res);
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
  await invalidateBrowserSessionsForActor({
    actorType: "CUSTOMER",
    actorId: auth.id,
    reason: "customer_deleted"
  }).catch(() => {});
  res.clearCookie(config.CUSTOMER_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
}));
