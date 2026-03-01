import { Router } from "express";
import { z } from "zod";
import { ReferralService } from "../services/referral-service.js";
import { requireStaff, requireOwner, requireCustomer } from "../../middleware/auth.js";
import { asyncRoute } from "../../middleware/common.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { validate } from "../../utils/validation.js";
import { validateQuery } from "../../utils/schemas.js";
import { tenantContext } from "../../middleware/tenant.js";

const router = Router();

const ReferralSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  referrer_reward_points: z.number().int().min(0).max(100000).optional(),
  referred_reward_points: z.number().int().min(0).max(100000).optional(),
  min_purchase_to_complete: z.number().min(0).nullable().optional(),
  reward_on_signup: z.boolean().optional(),
  custom_message: z.string().max(500).optional().nullable()
});

router.get(
  "/customer/referral-code",
  requireCustomer,
  requirePlanFeature("referrals"),
  asyncRoute(async (req, res) => {
    const customerId = req.customerAuth.id;
    const code = await ReferralService.getCustomerReferralCode(customerId);
    res.json({ ok: true, referral_code: code });
  })
);

router.get(
  "/customer/referrals",
  requireCustomer,
  tenantContext,
  requirePlanFeature("referrals"),
  asyncRoute(async (req, res) => {
    const customerId = req.customerAuth.id;
    const stats = await ReferralService.getCustomerReferralStats(customerId);
    res.json({ ok: true, ...stats });
  })
);

router.get(
  "/admin/referral-settings",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("referrals"),
  asyncRoute(async (req, res) => {
    const settings = await ReferralService.getSettings(req.tenantId);
    res.json({ ok: true, settings });
  })
);

router.put(
  "/admin/referral-settings",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("referrals"),
  asyncRoute(async (req, res) => {
    const v = validate(ReferralSettingsSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const settingsData = {
      enabled: v.data.enabled,
      referrer_reward_points: v.data.referrer_reward_points,
      referred_reward_points: v.data.referred_reward_points,
      min_purchase_to_complete: v.data.min_purchase_to_complete,
      reward_on_signup: v.data.reward_on_signup,
      custom_message: v.data.custom_message
    };

    const settings = await ReferralService.updateSettings(req.tenantId, settingsData);

    res.json({ ok: true, settings });
  })
);

router.get(
  "/admin/referral-leaderboard",
  requireStaff,
  tenantContext,
  requirePlanFeature("referrals"),
  validateQuery(z.object({
    limit: z.coerce.number().int().min(1).max(100).default(10)
  })),
  asyncRoute(async (req, res) => {
    const { limit } = req.validatedQuery;
    const leaderboard = await ReferralService.getLeaderboard(req.tenantId, limit);
    res.json({ ok: true, leaderboard });
  })
);

export default router;
