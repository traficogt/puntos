import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { TrialRepo } from "../../repositories/trial-repository.js";
import { ownerTrialPayload } from "../../services/trial-entitlement.js";

/** @typedef {import("../../../types/http-dto.js").AdminTrialResponse} AdminTrialResponse */
/** @typedef {import("../_request-types.js").Response} Response */
/** @typedef {import("../_request-types.js").TenantRequest} TenantRequest */

export const adminTrialRoutes = Router();

// Trial and billing state for the owner app banner and lock screen (design section 7.3).
// Readable while locked: it is the page that explains the lock and offers the upgrade.
adminTrialRoutes.get(
  "/admin/trial",
  requireStaff,
  requireOwner,
  tenantContext,
  asyncRoute(
    /** @param {TenantRequest} req @param {Response} res */
    async (req, res) => {
      const business = await BusinessRepo.getById(req.tenantId);
      if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
      const subscription = await TrialRepo.activeSubscription(req.tenantId).catch(() => null);
      /** @type {AdminTrialResponse} */
      const response = { ok: true, ...ownerTrialPayload(business, { subscription }) };
      res.set("Cache-Control", "no-store");
      return res.json(response);
    },
  ),
);
