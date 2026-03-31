import { asyncRoute } from "../../../middleware/common.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { validate } from "../../../utils/validation.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { CampaignRulesSchema, getBusinessOr404 } from "./program-support.js";

export function registerProgramCampaignRoutes(router) {
  router.get(
    "/admin/campaign-rules",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("campaign_rules"),
    asyncRoute(async (req, res) => {
      const business = await getBusinessOr404(res, req.tenantId);
      if (!business) return;
      return res.json({ ok: true, rules: business.program_json?.campaign_rules ?? [] });
    })
  );

  router.put(
    "/admin/campaign-rules",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("campaign_rules"),
    csrfProtect,
    asyncRoute(async (req, res) => {
      const v = validate(CampaignRulesSchema, req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const business = await getBusinessOr404(res, req.tenantId);
      if (!business) return;

      const updated = await BusinessRepo.updateProgram(req.tenantId, {
        program_type: business.program_type,
        program_json: {
          ...(business.program_json ?? {}),
          campaign_rules: v.data.rules.map((rule) => ({ ...rule, active: rule.active !== false }))
        }
      });
      return res.json({ ok: true, rules: updated.program_json?.campaign_rules ?? [] });
    })
  );
}
