import { z } from "zod";
import { BusinessRepo } from "../../repositories/business-repository.js";
import { maskSecret } from "./_util.js";

export const ProgramSchema = z.object({
  program_type: z.enum(["SPEND", "VISIT", "ITEM"]),
  program_json: z.record(z.any())
});

export const AUTOMATION_TEMPLATES = [
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

export const AutomationTemplateSchema = z.object({
  template: z.enum(["cafeteria_basico", "reactivacion_fuerte", "solo_alertas"])
});

export const automationTemplateMap = Object.fromEntries(AUTOMATION_TEMPLATES.map((template) => [template.key, template.config]));

export const CampaignRulesSchema = z.object({
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

export const ExternalAwardsSchema = z.object({
  enabled: z.boolean(),
  api_key: z.string().min(8).max(120).optional()
});

export async function getBusinessOr404(res, tenantId) {
  const business = await BusinessRepo.getById(tenantId);
  if (!business) {
    res.status(404).json({ error: "Business not found" });
    return null;
  }
  return business;
}

export function formatExternalAwards(programJson = {}) {
  const externalAwards = programJson.external_awards ?? { enabled: false, api_key: "" };
  return {
    enabled: Boolean(externalAwards.enabled),
    has_api_key: Boolean(externalAwards.api_key),
    api_key_masked: maskSecret(externalAwards.api_key)
  };
}
