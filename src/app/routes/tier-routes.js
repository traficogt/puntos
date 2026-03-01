import { Router } from "express";
import { z } from "zod";
import { TierService } from "../services/tier-service.js";
import { requireStaff, requireOwner, requireCustomer } from "../../middleware/auth.js";
import { asyncRoute } from "../../middleware/common.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { validate } from "../../utils/validation.js";
import { tenantContext } from "../../middleware/tenant.js";

const router = Router();

const TierCreateSchema = z.object({
  name: z.string().min(1).max(120),
  tier_level: z.number().int().min(1).max(100),
  min_points: z.number().int().min(0).optional(),
  min_spend: z.number().min(0).optional(),
  min_visits: z.number().int().min(0).optional(),
  points_multiplier: z.number().min(1).max(20).optional(),
  perks: z.array(z.string().max(200)).max(30).optional(),
  color: z.string().max(20).optional().nullable(),
  icon_url: z.string().max(300).optional().nullable()
});

const TierUpdateSchema = TierCreateSchema.partial();

router.get(
  "/admin/tiers",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("tiers"),
  asyncRoute(async (req, res) => {
    const tiers = await TierService.getBusinessTiersWithStats(req.tenantId);
    res.json({ ok: true, tiers });
  })
);

router.post(
  "/admin/tiers",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("tiers"),
  asyncRoute(async (req, res) => {
    const v = validate(TierCreateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const tierData = {
      name: v.data.name,
      tier_level: v.data.tier_level,
      min_points: v.data.min_points,
      min_spend: v.data.min_spend,
      min_visits: v.data.min_visits,
      points_multiplier: v.data.points_multiplier,
      perks: v.data.perks,
      color: v.data.color,
      icon_url: v.data.icon_url
    };

    const tier = await TierService.createTier(req.tenantId, tierData);
    res.status(201).json({ ok: true, tier });
  })
);

router.put(
  "/admin/tiers/:id",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("tiers"),
  asyncRoute(async (req, res) => {
    const v = validate(TierUpdateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const updates = {};
    for (const key of ["name", "min_points", "min_spend", "min_visits", "points_multiplier", "perks", "color", "icon_url", "active"]) {
      if (v.data[key] !== undefined) updates[key] = v.data[key];
    }

    const tier = await TierService.updateTier(req.params.id, req.tenantId, updates);
    res.json({ ok: true, tier });
  })
);

router.delete(
  "/admin/tiers/:id",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("tiers"),
  asyncRoute(async (req, res) => {
    await TierService.deleteTier(req.params.id, req.tenantId);
    res.json({ ok: true });
  })
);

router.get(
  "/customer/tier",
  requireCustomer,
  tenantContext,
  requirePlanFeature("tiers"),
  asyncRoute(async (req, res) => {
    const customerId = req.customerAuth.id;
    const tierInfo = await TierService.getCustomerTierInfo(customerId);
    res.json({ ok: true, tier: tierInfo });
  })
);

export default router;
