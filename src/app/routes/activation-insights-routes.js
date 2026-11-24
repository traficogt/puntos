import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { asyncRoute } from "../../middleware/common.js";
import * as services from "../services/activation-insights-service.js";
import { errorStatus } from "../../utils/error-shape.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */

const query = z
  .object({
    branch_id: z
      .guid()
      .transform((value) => value.toLowerCase())
      .optional(),
  })
  .strict();
const empty = z.object({}).strict();
/**
 * Service overrides for tests: any export of activation-insights-service.js.
 * @param {Partial<typeof services>} [deps]
 */
export function createActivationInsightsRoutes(deps = {}) {
  const router = Router(),
    service = { ...services, ...deps },
    base = "/admin/activation-insights";
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
    requirePlanFeature("analytics"),
  );
  for (const { path, read } of [
    { path: "reward-exposure", read: service.getRewardExposure },
    { path: "staff-activity", read: service.getStaffActivity },
  ]) {
    router.get(
      `${base}/${path}`,
      asyncRoute(
        /** @param {TenantRequest} req @param {Response} res */
        async (req, res) => {
          const parsed = query.safeParse(req.query);
          if (
            !parsed.success ||
            Number(req.get("Content-Length") || 0) > 0 ||
            req.get("Transfer-Encoding") ||
            !empty.safeParse(req.body ?? {}).success
          )
            return res.status(400).json({
              error: "Revisa la sucursal solicitada. Esta consulta no acepta cuerpo.",
              code: "VALIDATION_ERROR",
            });
          try {
            return res.json(
              await read({ businessId: req.tenantId, branchId: parsed.data.branch_id ?? null }),
            );
          } catch (error) {
            const status = errorStatus(error);
            if (status && status < 500) throw error;
            return res.status(503).json({
              error: "No se pudo consultar este resumen. Vuelve a intentar.",
              code: "ACTIVATION_INSIGHTS_UNAVAILABLE",
            });
          }
        },
      ),
    );
  }
  return router;
}
export const activationInsightsRoutes = createActivationInsightsRoutes();
