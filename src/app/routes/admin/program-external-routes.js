import { asyncRoute } from "../../../middleware/common.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { validate } from "../../../utils/validation.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import {
  ExternalAwardsSchema,
  formatExternalAwards,
  getBusinessOr404
} from "./program-support.js";

export function registerProgramExternalRoutes(router) {
  router.get(
    "/admin/external-awards",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("external_awards"),
    asyncRoute(async (req, res) => {
      const business = await getBusinessOr404(res, req.tenantId);
      if (!business) return;
      return res.json({ ok: true, external_awards: formatExternalAwards(business.program_json) });
    })
  );

  router.put(
    "/admin/external-awards",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("external_awards"),
    csrfProtect,
    asyncRoute(async (req, res) => {
      const v = validate(ExternalAwardsSchema, req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const business = await getBusinessOr404(res, req.tenantId);
      if (!business) return;

      const current = business.program_json?.external_awards ?? {};
      const nextApiKey = v.data.api_key !== undefined ? String(v.data.api_key) : String(current.api_key || "");
      if (v.data.enabled && !nextApiKey) {
        return res.status(400).json({ error: "api_key es requerida cuando la integración está habilitada" });
      }

      const updated = await BusinessRepo.updateProgram(req.tenantId, {
        program_type: business.program_type,
        program_json: {
          ...(business.program_json ?? {}),
          external_awards: {
            enabled: v.data.enabled,
            api_key: nextApiKey
          }
        }
      });
      return res.json({ ok: true, external_awards: formatExternalAwards(updated.program_json) });
    })
  );
}
