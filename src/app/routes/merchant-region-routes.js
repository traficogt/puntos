import { Router } from "express";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import { getMerchantRegion, updateMerchantRegion } from "../services/merchant-region-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */

/**
 * Service overrides for tests, typed by what the router hands them; results are
 * forwarded to `res.json` untouched, so test stubs may answer with reduced shapes.
 * @param {{
 *   getMerchantRegion?: (input: { businessId: string }) => Promise<unknown>,
 *   updateMerchantRegion?: (input: {
 *     businessId: string,
 *     staffId: string,
 *     impersonated_by: string | null,
 *     input: unknown
 *   }) => Promise<unknown>
 * }} [deps]
 */
export function createMerchantRegionRoutes(deps = {}) {
  const service = { getMerchantRegion, updateMerchantRegion, ...deps },
    router = Router(),
    base = "/admin/region";
  router.use(
    base,
    /** @param {Request} _req @param {Response} res @param {NextFunction} next */
    (_req, res, next) => {
      res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      next();
    },
    requireStaff,
    requireOwner,
    tenantContext,
  );
  router.use(
    base,
    /** @param {Request} req @param {Response} res @param {NextFunction} next */
    (req, res, next) =>
      Object.keys(req.query).length || (req.method === "GET" && Object.keys(req.body ?? {}).length)
        ? res.status(400).json({ error: "Esta configuración usa el negocio de tu sesión." })
        : next(),
  );
  router.get(
    base,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => res.json(await service.getMerchantRegion({ businessId: req.tenantId })),
    ),
  );
  router.put(
    base,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) =>
        res.json(
          await service.updateMerchantRegion({
            businessId: req.tenantId,
            staffId: req.staff.id,
            impersonated_by: req.staff.impersonated_by ?? null,
            input: req.body,
          }),
        ),
    ),
  );
  return router;
}
export const merchantRegionRoutes = createMerchantRegionRoutes();
