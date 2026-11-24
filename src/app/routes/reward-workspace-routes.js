import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import { rateLimitByUser } from "../../middleware/rate-limit.js";
import * as services from "../services/reward-workspace-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */

const empty = z.object({}).strict();
/** @param {Response} res */
const invalid = (res) =>
  res
    .status(400)
    .json({ error: "Esta solicitud no admite parámetros adicionales.", code: "VALIDATION_ERROR" });
/**
 * Service overrides for tests: any export of reward-workspace-service.js.
 * @param {Partial<typeof services>} [deps]
 */
export function createRewardWorkspaceRoutes(deps = {}) {
  const router = Router(),
    s = { ...services, ...deps },
    base = "/admin/reward-workspace";
  router.use(
    base,
    /** @param {Request} _req @param {Response} res @param {NextFunction} next */
    (_req, res, next) => {
      res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      next();
    },
    requireStaff,
    tenantContext,
    requireOwner,
  );
  /** @param {TenantRequest} req */
  const actor = (req) => ({ businessId: req.tenantId, staff: req.staff });
  router.get(
    base,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        res.json(await s.getRewardWorkspace(actor(req)));
      },
    ),
  );
  router.post(
    base,
    csrfProtect,
    rateLimitByUser(100, 60_000),
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        res.json(await s.saveRewardWorkspace({ ...actor(req), input: req.body }));
      },
    ),
  );
  return router;
}
export const rewardWorkspaceRoutes = createRewardWorkspaceRoutes();
