import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { validate } from "../../../utils/validation.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { rateLimitByUser } from "../../../middleware/rate-limit.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { RewardRepo } from "../../repositories/reward-repository.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { planLimits } from "../../../utils/plan.js";
import { dbQuery } from "../../database.js";
import { rewardCreateSchema, rewardUpdateSchema } from "../../../utils/schemas.js";
import { makeId } from "./_util.js";
import { withImpersonationMeta } from "../../../utils/impersonation.js";

export const adminRewardsRoutes = Router();

/** @param {any} req @param {string} action @param {Record<string, unknown>} meta */
function rewardAudit(req, action, meta) {
  return {
    id: makeId(), business_id: req.tenantId, actor_type: "STAFF", actor_id: req.staff.id, action,
    ip: req.ip ?? null, ua: req.get?.("user-agent") ?? null, meta: withImpersonationMeta(meta, req.staff)
  };
}

/** @param {{ businessId: string, branchIds?: string[] }} params */
async function validateRewardBranchScope({ businessId, branchIds }) {
  const unique = [...new Set((branchIds || []).map((v) => String(v)).filter(Boolean))];
  if (!unique.length) return [];
  const { rows } = await dbQuery(
    "SELECT id FROM branches WHERE business_id = $1 AND id = ANY($2::uuid[])",
    [businessId, unique]
  );
  if (rows.length !== unique.length) {
    throw new Error("Algunas sucursales seleccionadas no existen en este negocio");
  }
  return unique;
}

adminRewardsRoutes.get(
  "/admin/rewards",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("rewards"),
  asyncRoute(async (req, res) => {
    const rewards = await RewardRepo.listByBusiness(req.tenantId);
    return res.json({ ok: true, rewards });
  })
);

adminRewardsRoutes.post(
  "/admin/rewards",
  requireStaff,
  requireOwner,
  tenantContext,
  csrfProtect,
  rateLimitByUser(100, 60_000),
  requirePlanFeature("rewards"),
  asyncRoute(async (req, res) => {
    const v = validate(rewardCreateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    let scopedBranchIds = [];
    try {
      scopedBranchIds = await validateRewardBranchScope({
        businessId: req.tenantId,
        branchIds: v.data.branch_ids ?? []
      });
    } catch (e) {
      return res.status(400).json({ error: e.message || "Sucursales inválidas para la recompensa" });
    }

    const business = await BusinessRepo.getById(req.tenantId);
    const limits = planLimits(business.plan);
    const count = await BusinessRepo.countRewards(req.tenantId);
    if (count >= limits.rewards) return res.status(403).json({ error: "Plan limit: rewards exceeded" });

    const rewardId = makeId();
    const reward = await RewardRepo.create({
      id: rewardId,
      business_id: req.tenantId,
      name: v.data.name,
      description: v.data.description ?? null,
      points_cost: v.data.points_cost,
      active: v.data.active ?? true,
      stock: v.data.stock ?? null,
      valid_until: v.data.valid_until ? new Date(v.data.valid_until) : null,
      branch_ids: scopedBranchIds
    }, {
      audit: rewardAudit(req, "reward.create", {
        reward_id: rewardId, name: v.data.name, points_cost: v.data.points_cost, active: v.data.active ?? true,
        stock: v.data.stock ?? null, valid_until: v.data.valid_until ?? null, branch_ids: scopedBranchIds
      })
    });
    return res.json({ ok: true, reward });
  })
);

adminRewardsRoutes.patch(
  "/admin/rewards/:id",
  requireStaff,
  requireOwner,
  tenantContext,
  csrfProtect,
  rateLimitByUser(100, 60_000),
  requirePlanFeature("rewards"),
  asyncRoute(async (req, res) => {
    const v = validate(rewardUpdateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const patch = { ...v.data };

    let scopedBranchIds;
    if (Object.prototype.hasOwnProperty.call(patch, "branch_ids")) {
      try {
        scopedBranchIds = await validateRewardBranchScope({
          businessId: req.tenantId,
          branchIds: patch.branch_ids ?? []
        });
      } catch (e) {
        return res.status(400).json({ error: e.message || "Sucursales inválidas para la recompensa" });
      }
      delete patch.branch_ids;
    }

    const reward = await RewardRepo.getById(req.params.id);
    if (!reward || reward.business_id !== req.tenantId) return res.status(404).json({ error: "Not found" });

    const changes = Object.fromEntries(Object.keys(patch).map((key) => [key, { from: reward[key] ?? null, to: patch[key] ?? null }]));
    if (scopedBranchIds !== undefined) {
      changes.branch_ids = { from: (reward.branch_ids ?? []).map(String), to: scopedBranchIds };
    }
    // The audit entry commits with the last write of this update.
    const audit = Object.keys(changes).length
      ? rewardAudit(req, "reward.update", { reward_id: reward.id, changes })
      : undefined;
    const patchesFields = Object.keys(patch).length > 0;
    if (scopedBranchIds !== undefined) {
      await RewardRepo.setBranches(req.params.id, scopedBranchIds, { audit: patchesFields ? undefined : audit });
    }
    const updated = await RewardRepo.update(req.params.id, patch, { audit: patchesFields ? audit : undefined });
    return res.json({ ok: true, reward: updated });
  })
);

