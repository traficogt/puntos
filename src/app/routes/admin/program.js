import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../middleware/common.js";
import { validate } from "../../../utils/validation.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import { requireOwner, requireStaff, requireStaffPermission } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { PlanConfigService } from "../../services/plan-config-service.js";
import { planFeaturesWithOverrides } from "../../../utils/plan.js";
import { Permission, hasPermission } from "../../../utils/permissions.js";
import { withImpersonationMeta } from "../../../utils/impersonation.js";
import { AuditRepo } from "../../repositories/audit-repository.js";
import { makeId, maskSecret } from "./_util.js";

/** @typedef {import("zod").infer<typeof ProgramSchema>} ProgramInput */
/** @typedef {import("../../../types/http-dto.js").AdminProgramResponse} AdminProgramResponse */

export const adminProgramRoutes = Router();

const ProgramSchema = z.object({
  program_type: z.enum(["SPEND", "VISIT", "ITEM"]),
  program_json: z.record(z.any())
});

const AUTOMATION_TEMPLATES = [
  {
    key: "cafeteria_basico",
    name: "Cafetería básico",
    description: "Cumpleaños + win-back suave + alerta diaria de sospechosas.",
    config: {
      birthday_enabled: true,
      birthday_points: 50,
      winback_enabled: true,
      winback_days: 30,
      winback_points: 20,
      suspicious_digest_enabled: true,
      suspicious_digest_min_count: 2,
      scheduler_hour_local: 9,
      scheduler_tz: "America/Guatemala"
    }
  },
  {
    key: "reactivacion_fuerte",
    name: "Reactivación fuerte",
    description: "Más agresivo para recuperar clientes inactivos.",
    config: {
      birthday_enabled: true,
      birthday_points: 75,
      winback_enabled: true,
      winback_days: 21,
      winback_points: 35,
      suspicious_digest_enabled: true,
      suspicious_digest_min_count: 1,
      scheduler_hour_local: 10,
      scheduler_tz: "America/Guatemala"
    }
  },
  {
    key: "solo_alertas",
    name: "Solo alertas",
    description: "Sin bonos automáticos, solo reporte de riesgo diario.",
    config: {
      birthday_enabled: false,
      birthday_points: 0,
      winback_enabled: false,
      winback_days: 30,
      winback_points: 0,
      suspicious_digest_enabled: true,
      suspicious_digest_min_count: 1,
      scheduler_hour_local: 9,
      scheduler_tz: "America/Guatemala"
    }
  }
];

const AutomationTemplateSchema = z.object({
  template: z.enum(["cafeteria_basico", "reactivacion_fuerte", "solo_alertas"])
});

const automationTemplateMap = Object.fromEntries(AUTOMATION_TEMPLATES.map((t) => [t.key, t.config]));

adminProgramRoutes.get(
  "/admin/program",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("program_rules"),
  asyncRoute(async (req, res) => {
    const business = await BusinessRepo.getById(req.tenantId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    /** @type {AdminProgramResponse} */
    const response = {
      ok: true,
      program_type: business.program_type,
      program_json: business.program_json
    };
    return res.json(response);
  })
);

adminProgramRoutes.post(
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
    /** @type {ProgramInput} */
    const payload = v.data;

    const overrides = await PlanConfigService.getPlanFeatureOverrides().catch(() => ({}));
    const currentBusiness = await BusinessRepo.getById(req.tenantId);
    if (!currentBusiness) return res.status(404).json({ error: "Business not found" });
    const features = planFeaturesWithOverrides(currentBusiness.plan, overrides);
    const hasAdvanced = hasPermission(req.staff.role, Permission.ADMIN_PROGRAM_UPDATE_ADVANCED);

    const nextProgram = { ...(payload.program_json || {}) };
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
      program_type: payload.program_type,
      program_json: nextProgram
    });
    return res.json({ ok: true, business });
  })
);

adminProgramRoutes.get(
  "/admin/automations",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("lifecycle_automation"),
  asyncRoute(async (req, res) => {
    const business = await BusinessRepo.getById(req.tenantId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    const lifecycle = business.program_json?.lifecycle ?? {};
    return res.json({
      ok: true,
      lifecycle,
      templates: AUTOMATION_TEMPLATES
    });
  })
);

adminProgramRoutes.put(
  "/admin/automations/template",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("lifecycle_automation"),
  csrfProtect,
  asyncRoute(async (req, res) => {
    const v = validate(AutomationTemplateSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const business = await BusinessRepo.getById(req.tenantId);
    if (!business) return res.status(404).json({ error: "Business not found" });

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

const CampaignRulesSchema = z.object({
  rules: z.array(z.object({
    id: z.string().optional(),
    name: z.string().min(1).max(120),
    active: z.boolean().optional(),
    kind: z.enum(["multiplier", "bonus_points"]),
    value: z.number(),
    max_points: z.number().optional(),
    program_type: z.enum(["SPEND", "VISIT", "ITEM"]).optional(),
    condition: z.object({
      weekdays: z.array(z.number().int().min(0).max(6)).optional(),
      min_amount_q: z.number().optional(),
      min_visits: z.number().optional(),
      min_items: z.number().optional(),
      start_hour: z.number().int().min(0).max(23).optional(),
      end_hour: z.number().int().min(0).max(23).optional()
    }).optional()
  })).max(100)
});

adminProgramRoutes.get(
  "/admin/campaign-rules",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("campaign_rules"),
  asyncRoute(async (req, res) => {
    const business = await BusinessRepo.getById(req.tenantId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    return res.json({ ok: true, rules: business.program_json?.campaign_rules ?? [] });
  })
);

adminProgramRoutes.put(
  "/admin/campaign-rules",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("campaign_rules"),
  csrfProtect,
  asyncRoute(async (req, res) => {
    const v = validate(CampaignRulesSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const business = await BusinessRepo.getById(req.tenantId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    const nextProgram = {
      ...(business.program_json ?? {}),
      campaign_rules: v.data.rules.map((r) => ({ ...r, active: r.active !== false }))
    };
    const updated = await BusinessRepo.updateProgram(req.tenantId, {
      program_type: business.program_type,
      program_json: nextProgram
    });
    return res.json({ ok: true, rules: updated.program_json?.campaign_rules ?? [] });
  })
);

const ExternalAwardsSchema = z.object({
  enabled: z.boolean(),
  api_key: z.string().min(8).max(120).optional()
});

adminProgramRoutes.get(
  "/admin/external-awards",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("external_awards"),
  asyncRoute(async (req, res) => {
    const business = await BusinessRepo.getById(req.tenantId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    const ext = business.program_json?.external_awards ?? { enabled: false, api_key: "" };
    return res.json({
      ok: true,
      external_awards: {
        enabled: Boolean(ext.enabled),
        has_api_key: Boolean(ext.api_key),
        api_key_masked: maskSecret(ext.api_key)
      }
    });
  })
);

adminProgramRoutes.put(
  "/admin/external-awards",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("external_awards"),
  csrfProtect,
  asyncRoute(async (req, res) => {
    const v = validate(ExternalAwardsSchema, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const business = await BusinessRepo.getById(req.tenantId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    const current = business.program_json?.external_awards ?? {};
    const nextApiKey = v.data.api_key !== undefined ? String(v.data.api_key) : String(current.api_key || "");
    if (v.data.enabled && !nextApiKey) {
      return res.status(400).json({ error: "api_key es requerida cuando la integración está habilitada" });
    }
    const nextProgram = {
      ...(business.program_json ?? {}),
      external_awards: {
        enabled: v.data.enabled,
        api_key: nextApiKey
      }
    };
    const updated = await BusinessRepo.updateProgram(req.tenantId, {
      program_type: business.program_type,
      program_json: nextProgram
    });
    const ext = updated.program_json?.external_awards ?? { enabled: false, api_key: "" };
    return res.json({
      ok: true,
      external_awards: {
        enabled: Boolean(ext.enabled),
        has_api_key: Boolean(ext.api_key),
        api_key_masked: maskSecret(ext.api_key)
      }
    });
  })
);
