import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../middleware/common.js";
import { validate } from "../../utils/validation.js";
import { cookieOpts } from "../../utils/auth-token.js";
import { config } from "../../config/index.js";
import { requireStaff, requireStaffPermission } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { strictRateLimit } from "../../middleware/rate-limit.js";
import { staffLogin, awardPoints, redeemReward, syncAwards, refundAward } from "../services/staff-service.js";
import { RewardRepo } from "../repositories/reward-repository.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { getPermissionMatrix, Permission } from "../../utils/permissions.js";
import { staffLoginSchema } from "../../utils/schemas.js";
import { settlePendingPointsForBusiness } from "../services/loyalty-ops-service.js";
import { tenantContext } from "../../middleware/tenant.js";

export const staffRoutes = Router();

staffRoutes.post("/staff/login", strictRateLimit, asyncRoute(async (req, res) => {
  const v = validate(staffLoginSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const { staff, token } = await staffLogin(v.data);
  res.cookie(config.STAFF_COOKIE_NAME, token, { ...cookieOpts(), maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true, staff });
}));

staffRoutes.post("/staff/logout", csrfProtect, (req, res) => {
  res.clearCookie(config.STAFF_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

staffRoutes.get("/staff/me", requireStaff, tenantContext, (req, res) => {
  res.json({ ok: true, staff: req.staff });
});

staffRoutes.get("/staff/permissions", requireStaff, tenantContext, (req, res) => {
  res.json({ ok: true, role: req.staff.role, matrix: getPermissionMatrix() });
});

staffRoutes.get("/staff/program", requireStaff, tenantContext, asyncRoute(async (req, res) => {
  const business = await BusinessRepo.getById(req.tenantId);
  if (!business) return res.status(404).json({ error: "Business not found" });
  res.json({
    ok: true,
    program_type: business.program_type,
    program_json: business.program_json
  });
}));


staffRoutes.get("/staff/rewards", requireStaff, tenantContext, requirePlanFeature("rewards"), asyncRoute(async (req, res) => {
  const rewards = await RewardRepo.listByBusiness(req.tenantId);
  const visible = rewards
    .filter((r) => r.active)
    .filter((r) => {
      const scope = Array.isArray(r.branch_ids) ? r.branch_ids.map((v) => String(v)) : [];
      if (!scope.length) return true;
      if (!req.staff.branch_id) return false;
      return scope.includes(String(req.staff.branch_id));
    });
  res.json({ ok: true, rewards: visible });
}));


const AwardSchema = z.object({
  customerQrToken: z.string().min(20),
  amount_q: z.number().nonnegative().optional(),
  visits: z.number().int().positive().optional(),
  items: z.number().int().positive().optional(),
  meta: z.any().optional(),
  txId: z.string().uuid().optional()
});

staffRoutes.post("/staff/award", csrfProtect, requireStaff, tenantContext, requireStaffPermission(Permission.STAFF_AWARD), asyncRoute(async (req, res) => {
  const v = validate(AwardSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const payload = v.data;

  const out = await awardPoints({
    staff: req.staff,
    ...payload
  });
  res.json({ ok: true, ...out });
}));

const RedeemSchema = z.object({
  customerId: z.string().uuid(),
  rewardId: z.string().uuid()
});

staffRoutes.post("/staff/redeem", csrfProtect, requireStaff, tenantContext, requirePlanFeature("redemptions"), requireStaffPermission(Permission.STAFF_REDEEM), asyncRoute(async (req, res) => {
  const v = validate(RedeemSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const payload = v.data;

  const out = await redeemReward({ staff: req.staff, ...payload });
  res.json({ ok: true, ...out });
}));

const SyncSchema = z.object({
  awards: z.array(z.object({
    txId: z.string().uuid(),
    customerQrToken: z.string().min(20),
    amount_q: z.number().nonnegative().optional(),
    visits: z.number().int().positive().optional(),
    items: z.number().int().positive().optional(),
    meta: z.any().optional(),
    client_ts: z.string().optional()
  })).max(200)
});

staffRoutes.post("/staff/sync", csrfProtect, requireStaff, requireStaffPermission(Permission.STAFF_SYNC), asyncRoute(async (req, res) => {
  const v = validate(SyncSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const out = await syncAwards({ staff: req.staff, awards: v.data.awards });
  res.json({ ok: true, results: out });
}));

const RefundSchema = z.object({
  transactionId: z.string().uuid(),
  reason: z.string().min(2).max(200).optional(),
  allowNegative: z.boolean().optional()
});

staffRoutes.post("/staff/refund", csrfProtect, requireStaff, requireStaffPermission(Permission.STAFF_REFUND), asyncRoute(async (req, res) => {
  const v = validate(RefundSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const out = await refundAward({
    staff: req.staff,
    transactionId: v.data.transactionId,
    reason: v.data.reason ?? "refund",
    allowNegative: v.data.allowNegative ?? true
  });
  res.json(out);
}));

staffRoutes.post("/staff/settle-pending", csrfProtect, requireStaff, requirePlanFeature("lifecycle_automation"), requireStaffPermission(Permission.STAFF_REFUND), asyncRoute(async (req, res) => {
  const out = await settlePendingPointsForBusiness(req.staff.business_id);
  res.json({ ok: true, ...out });
}));
