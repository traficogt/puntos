import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { previewPosSale } from "../../services/pos-integration-service.js";

/** @typedef {import("../_request-types.js").Response} Response */
/** @typedef {import("../_request-types.js").TenantRequest} TenantRequest */

/**
 * Overrides for tests. `previewPosSale` is typed by what the router hands it (the
 * tenant id and the raw body); its result is forwarded to `res.json` untouched, so
 * test stubs may answer with a reduced shape. `requireStaff` stays `any`: it is an
 * Express middleware, but tests/unit/pos-preflight-routes.test.js stubs it with a
 * guard that returns the 401 response on one path and falls through on the other,
 * which `noImplicitReturns` rejects as soon as `res` is typed.
 * @param {{
 *   requireStaff?: any,
 *   previewPosSale?: (businessId: string, input: unknown) => Promise<unknown>
 * }} [deps]
 */
export function createPosOnboardingRoutes(deps = {}) {
  const router = Router();
  router.post(
    "/admin/pos/preflight",
    deps.requireStaff ?? requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("external_awards"),
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        res.set("Cache-Control", "no-store");
        return res.json(await (deps.previewPosSale ?? previewPosSale)(req.tenantId, req.body));
      },
    ),
  );
  return router;
}

export const posOnboardingRoutes = createPosOnboardingRoutes();
