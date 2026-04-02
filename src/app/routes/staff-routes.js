import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../middleware/common.js";
import { validate } from "../../utils/validation.js";
import { browserCookieMaxAge, cookieOpts } from "../../utils/auth-token.js";
import { config } from "../../config/index.js";
import { requireRecentReauth, requireStaff, requireStaffPermission } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { strictRateLimit } from "../../middleware/rate-limit.js";
import { staffLogin, awardPoints, redeemReward, syncAwards, refundAward, lookupCustomerByQrToken } from "../services/staff-service.js";
import { RewardRepo } from "../repositories/reward-repository.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { getPermissionMatrix, Permission } from "../../utils/permissions.js";
import { awardPointsSchema, redeemRewardSchema, staffLoginSchema, staffLookupCustomerSchema } from "../../utils/schemas.js";
import { settlePendingPointsForBusiness } from "../services/loyalty-ops-service.js";
import { tenantContext } from "../../middleware/tenant.js";
import { invalidateBrowserSessionById } from "../services/auth-session-service.js";
import {
  confirmStaffMfaEnrollment,
  disableStaffMfa,
  lockdownStaffAccount,
  reauthenticateStaffSession,
  requestStaffEmailChange,
  startStaffMfaEnrollment
} from "../services/account-security-service.js";

export const staffRoutes = Router();

const StaffReauthSchema = z.object({
  password: z.string().min(1).max(128),
  mfaCode: z.string().regex(/^\d{6}$/).optional()
});

const StaffEmailChangeSchema = z.object({
  newEmail: z.string().email()
});

const StaffMfaConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/)
});

staffRoutes.post("/staff/login", strictRateLimit, asyncRoute(async (req, res) => {
  const v = validate(staffLoginSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const { staff, token } = await staffLogin(v.data);
  res.cookie(config.STAFF_COOKIE_NAME, token, { ...cookieOpts(req), maxAge: browserCookieMaxAge("STAFF") });
  res.json({ ok: true, staff });
}));

staffRoutes.post("/staff/security/reauth", requireStaff, csrfProtect, asyncRoute(async (req, res) => {
  const v = validate(StaffReauthSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const out = await reauthenticateStaffSession({
    staff: req.staff,
    password: v.data.password,
    mfaCode: v.data.mfaCode,
    sessionId: req.authSession?.id
  });
  res.json(out);
}));

staffRoutes.post("/staff/security/mfa/enroll", requireStaff, csrfProtect, requireRecentReauth(), asyncRoute(async (req, res) => {
  const out = await startStaffMfaEnrollment({
    staffId: req.staff.id,
    businessId: req.staff.business_id
  });
  res.json({ ok: true, ...out });
}));

staffRoutes.post("/staff/security/mfa/confirm", requireStaff, csrfProtect, requireRecentReauth({ requireMfaIfEnabled: false }), asyncRoute(async (req, res) => {
  const v = validate(StaffMfaConfirmSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const out = await confirmStaffMfaEnrollment({
    staffId: req.staff.id,
    code: v.data.code,
    sessionId: req.authSession?.id
  });
  res.json(out);
}));

staffRoutes.post("/staff/security/mfa/disable", requireStaff, csrfProtect, requireRecentReauth(), asyncRoute(async (_req, res) => {
  const out = await disableStaffMfa({ staffId: _req.staff.id });
  res.json(out);
}));

staffRoutes.post("/staff/security/email-change", requireStaff, csrfProtect, requireRecentReauth(), asyncRoute(async (req, res) => {
  const v = validate(StaffEmailChangeSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const out = await requestStaffEmailChange({
    staff: req.staff,
    newEmail: v.data.newEmail,
    ip: req.ip || null,
    ua: req.headers["user-agent"] || null
  });
  res.json(out);
}));

staffRoutes.post("/staff/security/lockdown", requireStaff, csrfProtect, requireRecentReauth(), asyncRoute(async (req, res) => {
  const out = await lockdownStaffAccount({
    staffId: req.staff.id,
    ip: req.ip || null,
    ua: req.headers["user-agent"] || null
  });
  res.clearCookie(config.STAFF_COOKIE_NAME, { path: "/" });
  res.json(out);
}));

staffRoutes.post("/staff/logout", requireStaff, csrfProtect, asyncRoute(async (req, res) => {
  if (req.authSession?.id) {
    await invalidateBrowserSessionById(req.authSession.id, "logout").catch(() => {});
  }
  res.clearCookie(config.STAFF_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
}));

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

staffRoutes.post("/staff/customer/lookup", csrfProtect, requireStaff, tenantContext, asyncRoute(async (req, res) => {
  const v = validate(staffLookupCustomerSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const out = await lookupCustomerByQrToken({
    staff: req.staff,
    customerQrToken: v.data.customerQrToken
  });
  res.json({ ok: true, ...out });
}));


staffRoutes.post("/staff/award", csrfProtect, requireStaff, tenantContext, requireStaffPermission(Permission.STAFF_AWARD), asyncRoute(async (req, res) => {
  const v = validate(awardPointsSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const payload = v.data;

  const out = await awardPoints({
    staff: req.staff,
    ...payload
  });
  res.json({ ok: true, ...out });
}));

export const RedeemSchema = redeemRewardSchema;

staffRoutes.post("/staff/redeem", csrfProtect, requireStaff, tenantContext, requirePlanFeature("redemptions"), requireStaffPermission(Permission.STAFF_REDEEM), asyncRoute(async (req, res) => {
  const v = validate(RedeemSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const payload = v.data;

  const out = await redeemReward({ staff: req.staff, ...payload });
  res.json({ ok: true, ...out });
}));

export const SyncSchema = z.object({
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

staffRoutes.post("/staff/sync", csrfProtect, requireStaff, tenantContext, requireStaffPermission(Permission.STAFF_SYNC), asyncRoute(async (req, res) => {
  const v = validate(SyncSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const out = await syncAwards({ staff: req.staff, awards: v.data.awards });
  res.json({ ok: true, results: out });
}));

export const RefundSchema = z.object({
  transactionId: z.string().uuid(),
  requestId: z.string().uuid(),
  reason: z.string().min(2).max(200).optional()
});

staffRoutes.post("/staff/refund", csrfProtect, requireStaff, tenantContext, requireStaffPermission(Permission.STAFF_REFUND), asyncRoute(async (req, res) => {
  const v = validate(RefundSchema, req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const out = await refundAward({
    staff: req.staff,
    transactionId: v.data.transactionId,
    requestId: v.data.requestId,
    reason: v.data.reason ?? "refund"
  });
  res.json(out);
}));

staffRoutes.post("/staff/settle-pending", csrfProtect, requireStaff, tenantContext, requirePlanFeature("lifecycle_automation"), requireStaffPermission(Permission.STAFF_REFUND), asyncRoute(async (req, res) => {
  const out = await settlePendingPointsForBusiness(req.staff.business_id);
  res.json({ ok: true, ...out });
}));
