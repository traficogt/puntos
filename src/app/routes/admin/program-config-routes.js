import { asyncRoute } from "../../../middleware/common.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff, requireStaffPermission } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { validate } from "../../../utils/validation.js";
import {
  planFeaturesWithOverrides,
  canUseProgramType,
  suggestedPlanForFeature,
} from "../../../utils/plan.js";
import { Permission, hasPermission } from "../../../utils/permissions.js";
import { sanitizeProgramForClient } from "../../../utils/program-secrets.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { PlanConfigService } from "../../services/plan-config-service.js";
import { AUTOMATION_TEMPLATES, getBusinessOr404, ProgramSchema } from "./program-support.js";

/** @typedef {import("../_request-types.js").Response} Response */
/** @typedef {import("../_request-types.js").TenantRequest} TenantRequest */

/** @param {import("express").Router} router */
export function registerProgramConfigRoutes(router) {
  router.get(
    "/admin/program",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("program_rules"),
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const business = await getBusinessOr404(res, req.tenantId);
        if (!business) return;
        return res.json({
          ok: true,
          program_type: business.program_type,
          program_json: sanitizeProgramForClient(business.program_json),
        });
      },
    ),
  );

  router.post(
    "/admin/program",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("program_rules"),
    requireStaffPermission(Permission.ADMIN_PROGRAM_UPDATE_BASIC),
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const v = validate(ProgramSchema, req.body);
        if (!v.ok) return res.status(400).json({ error: v.error });

        const overrides = await PlanConfigService.getPlanFeatureOverrides().catch(() => ({}));
        const currentBusiness = await getBusinessOr404(res, req.tenantId);
        if (!currentBusiness) return;
        const features = planFeaturesWithOverrides(currentBusiness.plan, overrides);
        if (!canUseProgramType(currentBusiness.plan, v.data.program_type, overrides)) {
          return res.status(403).json({
            error: "Las tarjetas de regalo están disponibles desde el plan Negocio.",
            code: "PLAN_FEATURE_LOCKED",
            feature: "gift_cards",
            plan: currentBusiness.plan,
            suggested_plan: suggestedPlanForFeature("gift_cards"),
          });
        }
        const hasAdvanced = hasPermission(req.staff.role, Permission.ADMIN_PROGRAM_UPDATE_ADVANCED);

        const nextProgram = { ...(v.data.program_json || {}) };
        delete nextProgram.pos_integration;
        delete nextProgram.external_awards;
        if (!hasAdvanced) {
          delete nextProgram.campaign_rules;
          delete nextProgram.tier_policy;
          delete nextProgram.lifecycle;
        }

        if (!features.campaign_rules) delete nextProgram.campaign_rules;
        if (!features.tiers) delete nextProgram.tier_policy;
        if (!features.lifecycle_automation) delete nextProgram.lifecycle;

        const business = await BusinessRepo.updateProgram(req.tenantId, {
          program_type: v.data.program_type,
          program_json: nextProgram,
          preserveIntegrations: true,
        });
        return res.json({
          ok: true,
          business: {
            ...business,
            program_json: sanitizeProgramForClient(business?.program_json),
          },
        });
      },
    ),
  );

  router.get(
    "/admin/automations",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("lifecycle_automation"),
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const business = await getBusinessOr404(res, req.tenantId);
        if (!business) return;
        return res.json({
          ok: true,
          lifecycle: business.program_json?.lifecycle ?? {},
          templates: AUTOMATION_TEMPLATES,
        });
      },
    ),
  );
}
