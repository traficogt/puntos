import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner, requireStaffPermission } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { Permission } from "../../utils/permissions.js";
import { asyncRoute } from "../../middleware/common.js";
import * as services from "../services/merchant-launch-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */

const empty = z.object({}).strict();
/**
 * Service overrides for tests: any export of merchant-launch-service.js.
 * @param {Partial<typeof services>} [deps]
 */
export function createMerchantLaunchRoutes(deps = {}) {
  const router = Router(),
    s = { ...services, ...deps },
    base = "/admin/launch/program";
  router.use(
    base,
    /** @param {Request} _req @param {Response} res @param {NextFunction} next */
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("program_rules"),
  );
  router.get(
    base,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (!empty.safeParse(req.query).success)
          return res.status(400).json({ error: "Esta consulta no acepta parámetros." });
        return res.json(await s.getLaunchProgram({ businessId: req.tenantId }));
      },
    ),
  );
  router.put(
    base,
    requireStaffPermission(Permission.ADMIN_PROGRAM_UPDATE_BASIC),
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (
          !empty.safeParse(req.query).success ||
          !services.LaunchProgramInput.safeParse(req.body).success
        )
          return res
            .status(400)
            .json({ error: "Revisa la regla de puntos.", code: "VALIDATION_ERROR" });
        return res.json(
          await s.updateLaunchProgram({
            businessId: req.tenantId,
            staffId: req.staff.id,
            input: req.body,
            ip: req.ip,
            ua: req.get("user-agent") || null,
            ...(req.staff.impersonated_by ? { impersonated_by: req.staff.impersonated_by } : {}),
          }),
        );
      },
    ),
  );
  return router;
}
