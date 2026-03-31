import { asyncRoute } from "../../../middleware/common.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff, requireStaffPermission } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { validate } from "../../../utils/validation.js";
import { planFeaturesWithOverrides } from "../../../utils/plan.js";
import { Permission, hasPermission } from "../../../utils/permissions.js";
import { withImpersonationMeta } from "../../../utils/impersonation.js";
import { AuditRepo } from "../../repositories/audit-repository.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { PlanConfigService } from "../../services/plan-config-service.js";
import { makeId } from "./_util.js";
import {
  AUTOMATION_TEMPLATES,
  AutomationTemplateSchema,
  automationTemplateMap,
  getBusinessOr404,
  ProgramSchema
} from "./program-support.js";

export function registerProgramConfigRoutes(router) {
  router.get(
    "/admin/program",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("program_rules"),
    asyncRoute(async (req, res) => {
      const business = await getBusinessOr404(res, req.tenantId);
      if (!business) return;
      return res.json({
        ok: true,
        program_type: business.program_type,
        program_json: business.program_json
      });
    })
  );

  router.post(
    "/admin/program",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("program_rules"),
    requireStaffPermission(Permission.ADMIN_PROGRAM_UPDATE_BASIC),
    csrfProtect,
    asyncRoute(async (req, res) => {
      const v = validate(ProgramSchema, req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });

      const overrides = await PlanConfigService.getPlanFeatureOverrides().catch(() => ({}));
      const currentBusiness = await getBusinessOr404(res, req.tenantId);
      if (!currentBusiness) return;
      const features = planFeaturesWithOverrides(currentBusiness.plan, overrides);
      const hasAdvanced = hasPermission(req.staff.role, Permission.ADMIN_PROGRAM_UPDATE_ADVANCED);

      const nextProgram = { ...(v.data.program_json || {}) };
      if (!hasAdvanced) {
        delete nextProgram.campaign_rules;
        delete nextProgram.external_awards;
        delete nextProgram.tier_policy;
        delete nextProgram.lifecycle;
      }

      if (!features.campaign_rules) delete nextProgram.campaign_rules;
      if (!features.external_awards) delete nextProgram.external_awards;
      if (!features.tiers) delete nextProgram.tier_policy;
      if (!features.lifecycle_automation) delete nextProgram.lifecycle;

      const business = await BusinessRepo.updateProgram(req.tenantId, {
        program_type: v.data.program_type,
        program_json: nextProgram
      });
      return res.json({ ok: true, business });
    })
  );

  router.get(
    "/admin/automations",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("lifecycle_automation"),
    asyncRoute(async (req, res) => {
      const business = await getBusinessOr404(res, req.tenantId);
      if (!business) return;
      return res.json({
        ok: true,
        lifecycle: business.program_json?.lifecycle ?? {},
        templates: AUTOMATION_TEMPLATES
      });
    })
  );

  router.put(
    "/admin/automations/template",
    requireStaff,
    requireOwner,
    tenantContext,
    requirePlanFeature("lifecycle_automation"),
    csrfProtect,
    asyncRoute(async (req, res) => {
      const v = validate(AutomationTemplateSchema, req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const business = await getBusinessOr404(res, req.tenantId);
      if (!business) return;

      const nextLifecycle = {
        ...(business.program_json?.lifecycle ?? {}),
        ...automationTemplateMap[v.data.template]
      };
      const updated = await BusinessRepo.updateProgram(req.tenantId, {
        program_type: business.program_type,
        program_json: {
          ...(business.program_json ?? {}),
          lifecycle: nextLifecycle
        }
      });
      await AuditRepo.log({
        id: makeId(),
        business_id: req.tenantId,
        actor_type: "STAFF",
        actor_id: req.staff.id,
        action: "automation.template.apply",
        ip: null,
        ua: null,
        meta: withImpersonationMeta({ template: v.data.template }, req.staff)
      }).catch(() => {});
      return res.json({ ok: true, lifecycle: updated?.program_json?.lifecycle ?? {}, template: v.data.template });
    })
  );
}
