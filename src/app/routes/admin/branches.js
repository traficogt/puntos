import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { asyncRoute } from "../../../middleware/common.js";
import { validate } from "../../../utils/validation.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { BranchRepo } from "../../repositories/branch-repository.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { planLimits } from "../../../utils/plan.js";
import { makeId } from "./_util.js";
import { WalletLocationService, WalletLocationSchema } from "../../services/native-wallet/locations.js";

export const adminBranchRoutes = Router();

export const BranchSchema = z.object({
  name: z.string().min(2).max(120),
  address: z.string().max(250).optional(),
  code: z.string().min(3).max(80).optional()
});

adminBranchRoutes.get(
  "/admin/branches",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("multi_branch"),
  asyncRoute(async (req, res) => {
    const branches = await BranchRepo.listByBusiness(req.tenantId);
    return res.json({ ok: true, branches });
  })
);

adminBranchRoutes.post(
  "/admin/branches",
  requireStaff,
  requireOwner,
  tenantContext,
  csrfProtect,
  requirePlanFeature("multi_branch"),
  asyncRoute(async (req, res) => {
    const v = validate(BranchSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const business = await BusinessRepo.getById(req.tenantId);
    const limits = planLimits(business.plan);
    const count = await BusinessRepo.countBranches(req.tenantId);
    if (count >= limits.branches) return res.status(403).json({ error: "Plan limit: branches exceeded" });

    const branch = await BranchRepo.create({
      id: makeId(),
      business_id: req.tenantId,
      name: v.data.name,
      address: v.data.address ?? null,
      code: v.data.code ?? `${business.slug}-${crypto.randomBytes(3).toString("hex")}`
    });

    return res.json({ ok: true, branch });
  })
);

// Configuring an existing branch is also available to a single-branch owner.
adminBranchRoutes.get("/admin/branches/wallet-locations", requireStaff, requireOwner, tenantContext,
  asyncRoute(async (req, res) => res.json(await WalletLocationService.list({ businessId: req.tenantId }))));
adminBranchRoutes.put("/admin/branches/:id/wallet-location", requireStaff, requireOwner, tenantContext, csrfProtect,
  asyncRoute(async (req, res) => {
    const id = z.guid().safeParse(req.params.id);
    const location = WalletLocationSchema.safeParse(req.body);
    if (!id.success || !location.success) return res.status(400).json({ error: "Revisa la sucursal y ambas coordenadas de la ubicación." });
    return res.json(await WalletLocationService.save({ businessId: req.tenantId, branchId: id.data, staff: req.staff, location: location.data }));
  }));
