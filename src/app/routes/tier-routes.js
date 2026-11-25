import { Router } from "express";
import { z } from "zod";
import { TierService } from "../services/tier-service.js";
import { requireStaff, requireOwner, requireCustomer } from "../../middleware/auth.js";
import { asyncRoute } from "../../middleware/common.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { validate } from "../../utils/validation.js";
import { uuidParamsSchema, validateParams } from "../../utils/schemas.js";
import { tenantContext } from "../../middleware/tenant.js";

/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */
/** @typedef {Promise<Response | void>} HandlerResult early `return res...` or fall-through */
/**
 * @template P
 * @typedef {import("./_request-types.js").WithValidatedParams<P>} WithValidatedParams
 */
/** @typedef {z.infer<typeof uuidParamsSchema>} UuidParams */

const router = Router();

export const TierCreateSchema = z.object({
  name: z.string().min(1).max(120),
  tier_level: z.number().int().min(1).max(100),
  min_points: z.number().int().min(0).optional(),
  min_spend: z.number().min(0).optional(),
  min_visits: z.number().int().min(0).optional(),
  points_multiplier: z.number().min(1).max(20).optional(),
  perks: z.array(z.string().max(200)).max(30).optional(),
  color: z.string().max(20).optional().nullable(),
  icon_url: z.string().max(300).optional().nullable(),
});

// Edits may also toggle `active`: deleteTier refuses a tier that still has members and
// tells the owner to deactivate it instead, and this PUT is the only path that can.
export const TierUpdateSchema = TierCreateSchema.partial().extend({
  active: z.boolean().optional(),
});

router.get(
  "/admin/tiers",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("tiers"),
  asyncRoute(
    /** @param {TenantRequest} req @param {Response} res */
    async (req, res) => {
      const tiers = await TierService.getBusinessTiersWithStats(req.tenantId);
      res.json({ ok: true, tiers });
    },
  ),
);

router.post(
  "/admin/tiers",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("tiers"),
  asyncRoute(
    /** @param {TenantRequest} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
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
        icon_url: v.data.icon_url,
      };

      const tier = await TierService.createTier(req.tenantId, tierData);
      res.status(201).json({ ok: true, tier });
    },
  ),
);

router.put(
  "/admin/tiers/:id",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("tiers"),
  validateParams(uuidParamsSchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedParams<UuidParams>} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const v = validate(TierUpdateSchema, req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      /** @type {Record<string, unknown>} */
      const updates = {};
      for (const key of [
        "name",
        "min_points",
        "min_spend",
        "min_visits",
        "points_multiplier",
        "perks",
        "color",
        "icon_url",
        "active",
      ]) {
        if (v.data[key] !== undefined) updates[key] = v.data[key];
      }

      const tier = await TierService.updateTier(req.validatedParams.id, req.tenantId, updates);
      res.json({ ok: true, tier });
    },
  ),
);

router.delete(
  "/admin/tiers/:id",
  csrfProtect,
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("tiers"),
  validateParams(uuidParamsSchema),
  asyncRoute(
    /** @param {TenantRequest & WithValidatedParams<UuidParams>} req @param {Response} res */
    async (req, res) => {
      await TierService.deleteTier(req.validatedParams.id, req.tenantId);
      res.json({ ok: true });
    },
  ),
);

router.get(
  "/customer/tier",
  requireCustomer,
  tenantContext,
  requirePlanFeature("tiers"),
  asyncRoute(
    /** @param {TenantRequest} req @param {Response} res */
    async (req, res) => {
      const customerId = req.customerAuth.id;
      const tierInfo = await TierService.getCustomerTierInfo(customerId);
      res.json({ ok: true, tier: tierInfo });
    },
  ),
);

export default router;
