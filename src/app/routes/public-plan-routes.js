import { Router } from "express";
import { asyncRoute } from "../../middleware/common.js";
import { lenientRateLimit } from "../../middleware/rate-limit.js";
import { config } from "../../config/index.js";
import { PlanConfigService } from "../services/plan-config-service.js";
import { publicPlanCatalog } from "../services/public-plan-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */

/**
 * @param {{
 *   listPlans?: () => ReturnType<typeof PlanConfigService.listPlans>,
 *   getBillingCatalog?: () => ReturnType<typeof PlanConfigService.getBillingCatalog>,
 *   trialDays?: number,
 * }} [deps]
 */
export function createPublicPlanRoutes({
  listPlans = () => PlanConfigService.listPlans(),
  getBillingCatalog = () => PlanConfigService.getBillingCatalog(),
  trialDays = config.TRIAL_DAYS,
} = {}) {
  const router = Router();
  // The same catalog /precios renders, as JSON for the website and the owner app
  // ("Plan y facturación"). Public, briefly cacheable, no tenant context.
  router.get(
    "/public/plans",
    lenientRateLimit,
    asyncRoute(
      /** @param {Request} _req @param {Response} res */
      async (_req, res) => {
        const [plans, catalog] = await Promise.all([listPlans(), getBillingCatalog()]);
        res.set("Cache-Control", "public, max-age=300").json({
          ok: true,
          ...publicPlanCatalog(plans, { trialDays, gtqReference: catalog.gtq_reference }),
        });
      },
    ),
  );
  return router;
}

export const publicPlanRoutes = createPublicPlanRoutes();
