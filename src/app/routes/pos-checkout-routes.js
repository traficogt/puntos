import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import { validateRequest } from "../../utils/schemas.js";
import * as services from "../services/pos-checkout-config.js";
// Structural shape only; normalizeCheckoutSource in the service applies the strict
// schema (UUID formats, ranges, unknown keys) and keeps its specific messages.
const checkoutSourceShape = z.looseObject({
  source: z.string(),
  branchId: z.string().nullable(),
  staffId: z.string(),
  enabled: z.boolean(),
  version: z.number(),
});
export function createPosCheckoutRoutes(deps = {}) {
  const router = Router(),
    s = { ...services, ...deps },
    base = "/admin/pos-checkout/sources";
  router.use(
    base,
    (_req, res, next) => {
      res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      next();
    },
    requireStaff,
    tenantContext,
    requireOwner,
  );
  const actor = (req) => ({ businessId: req.tenantId, staff: req.staff });
  router.get(
    base,
    asyncRoute(async (req, res) => {
      if (Object.keys(req.query).length)
        return res.status(400).json({ error: "No se admiten filtros." });
      res.json(await s.getCheckoutSources(actor(req)));
    }),
  );
  router.put(
    base,
    csrfProtect,
    validateRequest(checkoutSourceShape),
    asyncRoute(async (req, res) => {
      if (Object.keys(req.query).length)
        return res.status(400).json({ error: "No se admiten filtros." });
      res.json(await s.configureCheckoutSource({ ...actor(req), input: req.validated }));
    }),
  );
  return router;
}
export const posCheckoutRoutes = createPosCheckoutRoutes();
