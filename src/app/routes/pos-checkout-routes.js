import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import { validateRequest } from "../../utils/schemas.js";
import * as services from "../services/pos-checkout-config.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */
/**
 * @template Body
 * @typedef {import("./_request-types.js").WithValidated<Body>} WithValidated
 */

// Structural shape only; normalizeCheckoutSource in the service applies the strict
// schema (UUID formats, ranges, unknown keys) and keeps its specific messages.
const checkoutSourceShape = z.looseObject({
  source: z.string(),
  branchId: z.string().nullable(),
  staffId: z.string(),
  enabled: z.boolean(),
  version: z.number(),
});

/** @typedef {z.infer<typeof checkoutSourceShape>} CheckoutSourceBody */

/**
 * Service overrides for tests: any export of pos-checkout-config.js.
 * @param {Partial<typeof services>} [deps]
 */
export function createPosCheckoutRoutes(deps = {}) {
  const router = Router(),
    s = { ...services, ...deps },
    base = "/admin/pos-checkout/sources";
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
        if (Object.keys(req.query).length)
          return res.status(400).json({ error: "No se admiten filtros." });
        res.json(await s.getCheckoutSources(actor(req)));
      },
    ),
  );
  router.put(
    base,
    csrfProtect,
    validateRequest(checkoutSourceShape),
    asyncRoute(
      /** @param {TenantRequest & WithValidated<CheckoutSourceBody>} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (Object.keys(req.query).length)
          return res.status(400).json({ error: "No se admiten filtros." });
        res.json(await s.configureCheckoutSource({ ...actor(req), input: req.validated }));
      },
    ),
  );
  return router;
}
export const posCheckoutRoutes = createPosCheckoutRoutes();
