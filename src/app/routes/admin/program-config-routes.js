import { asyncRoute } from "../../../middleware/common.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff, requireStaffPermission } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { validate } from "../../../utils/validation.js";
import { planFeaturesWithOverrides } from "../../../utils/plan.js";
import { Permission, hasPermission } from "../../../utils/permissions.js";
import { withImpersonationMeta } from "../../../utils/impersonation.js";
import { sanitizeProgramForClient } from "../../../utils/program-secrets.js";
import { withTransaction } from "../../database.js";
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

// Dedicated services validate and own these settings. The generic program
// form never submits them, so a stale or crafted save cannot replace them.
const SERVICE_MANAGED_PROGRAM_KEYS = [
  "pos_integration", "external_awards", "weekly_owner_brief", "region", "currency_confirmation",
  "data_health", "merchant_operating_mode", "second_visit", "targeted_offers_enabled",
  "pos_inventory_checks", "pos_checkout_enabled"
];

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
        program_json: sanitizeProgramForClient(business.program_json)
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
      for (const key of SERVICE_MANAGED_PROGRAM_KEYS) delete nextProgram[key];
      if (!hasAdvanced) {
        delete nextProgram.campaign_rules;
        delete nextProgram.tier_policy;
        delete nextProgram.lifecycle;
      }

      if (!features.campaign_rules) delete nextProgram.campaign_rules;
      if (!features.tiers) delete nextProgram.tier_policy;
      if (!features.lifecycle_automation) delete nextProgram.lifecycle;

      const previous = currentBusiness.program_json ?? {};
      const changedKeys = Object.keys(nextProgram)
        .filter((key) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(nextProgram[key] ?? null)).sort();
      // The saved rules and their audit entry commit together.
      const business = await withTransaction(async () => {
        const saved = await BusinessRepo.updateProgram(req.tenantId, {
          program_type: v.data.program_type,
          program_json: nextProgram,
          preserveIntegrations: true
        });
        await AuditRepo.log({
          id: makeId(),
          business_id: req.tenantId,
          actor_type: "STAFF",
          actor_id: req.staff.id,
          action: "program.update",
          ip: req.ip ?? null,
          ua: req.get?.("user-agent") ?? null,
          meta: withImpersonationMeta({
            program_type: { from: currentBusiness.program_type ?? null, to: v.data.program_type },
            changed_keys: changedKeys,
            changes: Object.fromEntries(changedKeys.map((key) => [key, { from: previous[key] ?? null, to: nextProgram[key] ?? null }]))
          }, req.staff)
        });
        return saved;
      });
      return res.json({ ok: true, business: { ...business, program_json: sanitizeProgramForClient(business?.program_json) } });
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

      const updated = await BusinessRepo.updateLifecycle(req.tenantId, automationTemplateMap[v.data.template]);
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
