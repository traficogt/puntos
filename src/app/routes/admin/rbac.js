import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { getPermissionMatrix } from "../../../utils/permissions.js";

/** @typedef {import("../_request-types.js").Request} Request */
/** @typedef {import("../_request-types.js").Response} Response */

export const adminRbacRoutes = Router();

adminRbacRoutes.get(
  "/admin/rbac/matrix",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("rbac_matrix"),
  asyncRoute(
    /** @param {Request} _req @param {Response} res */
    async (_req, res) => res.json({ ok: true, matrix: getPermissionMatrix() }),
  ),
);
