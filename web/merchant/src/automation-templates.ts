// The three lifecycle templates (formerly applied by the retired vanilla dashboard through a dedicated
// endpoint that skipped budget validation; that endpoint was removed on 2026-11-25). Mirrors
// AUTOMATION_TEMPLATES in src/app/routes/admin/program-support.js; tests/unit/merchant-automation-
// templates.test.js keeps both lists identical. A template only prefills the Automations editor, so the
// owner still reviews the monthly budgets and saves through PUT /api/admin/automations.
export interface AutomationTemplateConfig {birthday_enabled: boolean; birthday_points: number; winback_enabled: boolean; winback_days: number; winback_points: number; suspicious_digest_enabled: boolean; suspicious_digest_min_count: number; scheduler_hour_local: number; scheduler_tz: string}
export interface AutomationTemplate {key: 'cafeteria_basico' | 'reactivacion_fuerte' | 'solo_alertas'; name: string; description: string; config: AutomationTemplateConfig}
export const automationTemplates: AutomationTemplate[] = [
  {key: 'cafeteria_basico', name: 'Cafetería básico', description: 'Cumpleaños + win-back suave + alerta diaria de sospechosas.', config: {birthday_enabled: true, birthday_points: 50, winback_enabled: true, winback_days: 30, winback_points: 20, suspicious_digest_enabled: true, suspicious_digest_min_count: 2, scheduler_hour_local: 9, scheduler_tz: 'America/Guatemala'}},
  {key: 'reactivacion_fuerte', name: 'Reactivación fuerte', description: 'Más agresivo para recuperar clientes inactivos.', config: {birthday_enabled: true, birthday_points: 75, winback_enabled: true, winback_days: 21, winback_points: 35, suspicious_digest_enabled: true, suspicious_digest_min_count: 1, scheduler_hour_local: 10, scheduler_tz: 'America/Guatemala'}},
  {key: 'solo_alertas', name: 'Solo alertas', description: 'Sin bonos automáticos, solo reporte de riesgo diario.', config: {birthday_enabled: false, birthday_points: 0, winback_enabled: false, winback_days: 30, winback_points: 0, suspicious_digest_enabled: true, suspicious_digest_min_count: 1, scheduler_hour_local: 9, scheduler_tz: 'America/Guatemala'}},
];
/** The settings object PUT /api/admin/automations accepts (AutomationSettings, strict); the digest keys are optional there. */
export interface AutomationFormValues {birthday_enabled: boolean; birthday_points: number; birthday_monthly_points_cap: number; winback_enabled: boolean; winback_days: number; winback_points: number; winback_monthly_points_cap: number; minimum_contact_days: number; scheduler_hour_local: number; scheduler_tz: string; suspicious_digest_enabled: boolean; suspicious_digest_min_count: number}
/**
 * Loads a template into the editor's current values. Monthly budgets, contact spacing and the business
 * timezone stay as saved: the editor validates that each active rule's budget covers one incentive before
 * anything is sent. The suspicious-purchase digest is part of each template and is loaded too.
 */
export function templateFormValues(current: AutomationFormValues, template: AutomationTemplate): AutomationFormValues {
  const {birthday_enabled, birthday_points, winback_enabled, winback_days, winback_points, scheduler_hour_local, suspicious_digest_enabled, suspicious_digest_min_count} = template.config;
  return {...current, birthday_enabled, birthday_points, winback_enabled, winback_days, winback_points, scheduler_hour_local: Math.min(17, Math.max(9, scheduler_hour_local)), suspicious_digest_enabled, suspicious_digest_min_count: Math.min(1000, Math.max(1, suspicious_digest_min_count))};
}
/** Budget warnings the editor will raise on save, so the owner sees them when the template loads. */
export function templateBudgetNotes(values: AutomationFormValues): string[] {
  const notes: string[] = [];
  if (values.birthday_enabled && values.birthday_monthly_points_cap < values.birthday_points) notes.push(`El presupuesto mensual de cumpleaños (${values.birthday_monthly_points_cap.toLocaleString('es-GT')} puntos) no cubre un incentivo de ${values.birthday_points.toLocaleString('es-GT')} puntos.`);
  if (values.winback_enabled && values.winback_monthly_points_cap < values.winback_points) notes.push(`El presupuesto mensual de recuperación (${values.winback_monthly_points_cap.toLocaleString('es-GT')} puntos) no cubre una invitación de ${values.winback_points.toLocaleString('es-GT')} puntos.`);
  return notes;
}
export function templateSummary(template: AutomationTemplate): string {
  const {config} = template;
  const birthday = config.birthday_enabled ? `Cumpleaños: ${config.birthday_points} puntos` : 'Cumpleaños: pausado';
  const winback = config.winback_enabled ? `Recuperación: a los ${config.winback_days} días, ${config.winback_points} puntos` : 'Recuperación: pausada';
  return `${birthday} · ${winback} · Preparar a las ${String(config.scheduler_hour_local).padStart(2, '0')}:00`;
}
