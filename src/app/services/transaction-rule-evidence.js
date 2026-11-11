import { dateTimeSchema } from '../../utils/date-time-schema.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const types = ['SPEND', 'VISIT', 'ITEM'];
function localTime(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(date);
    return { hour: Number(parts.find(part => part.type === 'hour')?.value ?? 0), weekday: ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[parts.find(part => part.type === 'weekday')?.value] ?? date.getDay(), timeZone };
  } catch {
    // Preserve the incumbent evaluator's system-clock fallback, and disclose it.
    return { hour: date.getHours(), weekday: date.getDay(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }
}
function ruleContent(rule, index) {
  const c = rule?.condition || {};
  return { index, present: !!rule, active: !!rule && rule.active !== false,
    program_type: rule?.program_type ? (types.includes(String(rule.program_type)) ? String(rule.program_type) : 'OTHER') : null,
    kind: rule?.kind === 'bonus_points' ? 'bonus_points' : 'multiplier',
    value: Number(rule?.kind === 'bonus_points' ? rule?.value || 0 : rule?.value || 1),
    max_points: finite(rule?.max_points) > 0 ? finite(rule.max_points) : null,
    condition: {
      weekdays: Array.isArray(c.weekdays) && c.weekdays.length ? c.weekdays.filter(value => Number.isInteger(value) && value >= 0 && value <= 6) : null,
      min_amount_q: finite(c.min_amount_q), min_visits: finite(c.min_visits), min_items: finite(c.min_items),
      start_hour: finite(c.start_hour), end_hour: finite(c.end_hour)
    }
  };
}

/** Pure evaluator. Its safe evidence and award are produced by the same pass.
 * The supplied clock belongs to the server wrapper, never an offline capture.
 */
export function evaluatePointRules(business, { amount_q = 0, visits = 0, items = 0 }, { now, timeZone }) {
  const type = business.program_type ?? 'SPEND', cfg = business.program_json ?? {};
  const programType = type === 'VISIT' || type === 'ITEM' ? type : 'SPEND';
  const rate = Number(programType === 'VISIT' ? cfg.points_per_visit ?? 10 : programType === 'ITEM' ? cfg.points_per_item ?? 1 : cfg.points_per_q ?? 0.1);
  const round = programType === 'SPEND' ? (['floor', 'round'].includes(String(cfg.round)) ? String(cfg.round) : 'ceil') : 'floor';
  const quantity = programType === 'VISIT' ? Math.floor(visits || 1) : programType === 'ITEM' ? Math.floor(items || 1) : Number(amount_q);
  const raw = quantity * rate;
  const base = Math.max(0, programType === 'SPEND' ? round === 'floor' ? Math.floor(raw) : round === 'round' ? Math.round(raw) : Math.ceil(raw) : raw);
  const clock = localTime(now, timeZone), definitions = Array.isArray(cfg.campaign_rules) ? cfg.campaign_rules : [];
  const safeRules = definitions.map(ruleContent);
  let total = definitions.length ? Math.max(0, Number(base || 0)) : base;
  const rules = definitions.map((rule, index) => {
    const safe = safeRules[index], c = safe.condition;
    let outcome = 'applied';
    if (!safe.active) outcome = 'inactive';
    else if (rule.program_type && String(rule.program_type) !== programType) outcome = 'program_type';
    else if (c.weekdays !== null && !c.weekdays.includes(clock.weekday)) outcome = 'weekday';
    else if (c.min_amount_q !== null && Number(amount_q || 0) < c.min_amount_q) outcome = 'min_amount_q';
    else if (c.min_visits !== null && Number(visits || 0) < c.min_visits) outcome = 'min_visits';
    else if (c.min_items !== null && Number(items || 0) < c.min_items) outcome = 'min_items';
    else if ((c.start_hour !== null && clock.hour < c.start_hour) || (c.end_hour !== null && clock.hour > c.end_hour)) outcome = 'hours';
    const before = total;
    if (outcome === 'applied') {
      total = safe.kind === 'bonus_points' ? total + safe.value : total * safe.value;
      if (safe.max_points !== null) total = Math.min(total, safe.max_points);
    }
    return { ...safe, outcome, points_before: before, points_after: total };
  });
  const points = Math.max(0, Math.floor(total));
  const program = { type: programType, rate, round, quantity };
  return { points, evidence: { schema_version: 1, algorithm: 'pf-points-v1',
    rule_version: createHash('sha256').update(JSON.stringify({ type: programType, rate, round, rules: safeRules })).digest('hex'),
    evaluated_at: now.toISOString(), clock: 'server', time_zone: clock.timeZone,
    local_weekday: clock.weekday, local_hour: clock.hour,
    inputs: { amount_q: Number(amount_q), visits: Number(visits), items: Number(items) },
    program, base_points: base, rules, program_points: points
  } };
}

// Both the writer and reader strip unrecognized fields, including nested data.
export const targetedOfferCriteriaSchema = z.object({
  schema_version: z.literal(1), clock: z.literal('database'), evaluated_at: dateTimeSchema(),
  minimum_purchase_q: z.number().finite().nonnegative(), starts_at: dateTimeSchema(), expires_at: dateTimeSchema(),
  points_budget: z.number().int().nonnegative().nullable(), points_committed_before: z.number().int().nonnegative(), points_committed_after: z.number().int().nonnegative(),
  eligibility: z.object({ campaign_active: z.literal(true), saved_membership: z.literal('treatment'), unclaimed_before_award: z.literal(true), customer_not_deleted: z.literal(true), program_enabled_at_request: z.literal(true), plan_features_allowed: z.literal(true) }),
  purchase: z.object({ amount_q: z.number().finite().nonnegative(), visits: z.number().int().nonnegative(), items: z.number().int().nonnegative(), source: z.enum(['online','offline','external','order']) })
});
function safeTargetedCriteria(value) {
  const parsed = targetedOfferCriteriaSchema.safeParse(value);
  return parsed.success ? parsed.data : 'not_snapshotted';
}

export function completeAwardEvidence(evidence, { bonus, holdDays, status, availableAt, source = null, capturedAt = null }) {
  if (!evidence) return null; // An injected/custom evaluator cannot claim evidence it did not compute.
  const captured = source === 'offline' && typeof capturedAt === 'string' && Number.isFinite(Date.parse(capturedAt)) ? new Date(capturedAt).toISOString() : null;
  return { ...evidence, targeted_offer: { bonus_points: Number(bonus?.bonusPoints || 0), campaign_id: bonus?.campaignId ?? null,
    criteria: safeTargetedCriteria(bonus?.criteria) }, awarded_points: evidence.program_points + Number(bonus?.bonusPoints || 0),
    hold_days: holdDays, initial_status: status, available_at: availableAt?.toISOString() ?? null,
    offline_capture: captured ? { recorded_at: captured, clock: 'client_reported' } : null };
}
