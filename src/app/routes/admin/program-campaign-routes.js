import { config } from "../../../config/index.js";
import { asyncRoute } from "../../../middleware/common.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { validate } from "../../../utils/validation.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { CampaignRulesSchema, getBusinessOr404 } from "./program-support.js";

/** @typedef {import("../_request-types.js").Response} Response */
/** @typedef {import("../_request-types.js").TenantRequest} TenantRequest */
/** @typedef {import("zod").infer<typeof CampaignRulesSchema>["rules"][number]} CampaignRule */

/** @param {import("express").Router} router */
export function registerProgramCampaignRoutes(router) {
  router.get(
    "/admin/campaign-rules",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("campaign_rules"),
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const business = await getBusinessOr404(res, req.tenantId);
        if (!business) return;
        return res.json({
          ok: true,
          timezone: config.CRON_TZ || "UTC",
          rules: business.program_json?.campaign_rules ?? [],
        });
      },
    ),
  );

  router.put(
    "/admin/campaign-rules",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("campaign_rules"),
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const v = validate(CampaignRulesSchema, req.body);
        if (!v.ok) return res.status(400).json({ error: v.error });
        const business = await getBusinessOr404(res, req.tenantId);
        if (!business) return;

        const updated = await BusinessRepo.updateCampaignRules(
          req.tenantId,
          v.data.rules.map(
            /** @param {CampaignRule} rule */
            (rule) => ({ ...rule, active: rule.active !== false }),
          ),
        );
        return res.json({ ok: true, rules: updated.program_json?.campaign_rules ?? [] });
      },
    ),
  );
}
