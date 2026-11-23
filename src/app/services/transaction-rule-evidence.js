import { badRequest } from "../../utils/http-error.js";
import { dateTimeSchema } from "../../utils/date-time-schema.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { businessRegion } from "./regional-settings.js";

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const types = ["SPEND", "VISIT", "ITEM", "STAMP"];
function localTime(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(date);
    return {
      hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
      weekday:
        { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[
          parts.find((part) => part.type === "weekday")?.value
        ] ?? date.getDay(),
      timeZone,
    };
  } catch {
    // Preserve the incumbent evaluator's system-clock fallback, and disclose it.
    return {
      hour: date.getHours(),
      weekday: date.getDay(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
}
function ruleContent(rule, index) {
  const c = rule?.condition || {};
  return {
    index,
    present: !!rule,
    active: !!rule && rule.active !== false,
    program_type: rule?.program_type
      ? types.includes(String(rule.program_type))
        ? String(rule.program_type)
        : "OTHER"
      : null,
    kind: rule?.kind === "bonus_points" ? "bonus_points" : "multiplier",
    value: Number(rule?.kind === "bonus_points" ? rule?.value || 0 : rule?.value || 1),
    max_points: (finite(rule?.max_points) ?? 0) > 0 ? finite(rule?.max_points) : null,
    condition: {
      weekdays:
        Array.isArray(c.weekdays) && c.weekdays.length
          ? c.weekdays.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
          : null,
      min_amount_q: finite(c.min_amount_q),
      min_visits: finite(c.min_visits),
      min_items: finite(c.min_items),
      start_hour: finite(c.start_hour),
      end_hour: finite(c.end_hour),
    },
  };
}

/** Pure evaluator. Its safe evidence and award are produced by the same pass.
 * The supplied clock belongs to the server wrapper, never an offline capture.
 */
export function evaluatePointRules(
  business,
  { amount_q = 0, visits = 0, items = 0 },
  { now, timeZone, requireRule = false },
) {
  const type = business.program_type ?? "SPEND",
    cfg = business.program_json ?? {};
  if (type === "DISCOUNT" || type === "CASHBACK" || type === "GIFT_CARD") {
    // A discount program accrues no points; the benefit is applied as a counter
    // discount (see discount-model.js). Evidence is emitted with zero points for a
    // consistent audit trail so downstream award storage validates unchanged.
    const clock = localTime(now, timeZone);
    const program = { type, rate: 0, round: "floor", quantity: Number(amount_q) };
    return {
      points: 0,
      evidence: {
        schema_version: 1,
        algorithm: "pf-points-v1",
        rule_version: createHash("sha256")
          .update(JSON.stringify({ type, rate: 0, round: "floor", rules: [] }))
          .digest("hex"),
        evaluated_at: now.toISOString(),
        clock: "server",
        time_zone: clock.timeZone,
        currency: businessRegion(business).currency,
        local_weekday: clock.weekday,
        local_hour: clock.hour,
        inputs: { amount_q: Number(amount_q), visits: Number(visits), items: Number(items) },
        program,
        base_points: 0,
        rules: [],
        program_points: 0,
      },
    };
  }
  const programType = type === "VISIT" || type === "ITEM" || type === "STAMP" ? type : "SPEND";
  // No implicit rate: a points program without an explicit, positive rule is not configured and
  // must neither award (silently 0) nor assume a default. The owner picks a preset or sets it manually.
  // Live computations (requireRule) refuse to award on a points program whose rule was never set:
  // never an assumed default ratio. A rule that IS set keeps its existing semantics (including the
  // legacy handling of malformed values); evidence/replay callers keep the legacy defaults so
  // historical records still reconstruct.
  const rawRate =
    programType === "STAMP"
      ? 1
      : programType === "VISIT"
        ? cfg.points_per_visit
        : programType === "ITEM"
          ? cfg.points_per_item
          : cfg.points_per_q;
  if (requireRule && rawRate == null) {
    const err = /** @type {Error & { code?: string }} */ (
      badRequest("Configura la regla de puntos de tu programa antes de registrar compras.")
    );
    err.code = "PROGRAM_NOT_CONFIGURED";
    throw err;
  }
  const rate =
    programType === "STAMP"
      ? 1
      : Number(rawRate ?? (programType === "VISIT" ? 10 : programType === "ITEM" ? 1 : 0.1));
  const round =
    programType === "SPEND"
      ? ["floor", "round"].includes(String(cfg.round))
        ? String(cfg.round)
        : "ceil"
      : "floor";
  const quantity =
    programType === "STAMP"
      ? Math.floor((cfg.stamp_unit === "item" ? items : visits) || 1)
      : programType === "VISIT"
        ? Math.floor(visits || 1)
        : programType === "ITEM"
          ? Math.floor(items || 1)
          : Number(amount_q);
  const raw = quantity * rate;
  const base = Math.max(
    0,
    programType === "SPEND"
      ? round === "floor"
        ? Math.floor(raw)
        : round === "round"
          ? Math.round(raw)
          : Math.ceil(raw)
      : raw,
  );
  const clock = localTime(now, timeZone),
    definitions = Array.isArray(cfg.campaign_rules) ? cfg.campaign_rules : [];
  const safeRules = definitions.map(ruleContent);
  let total = definitions.length ? Math.max(0, Number(base || 0)) : base;
  const rules = definitions.map((rule, index) => {
    const safe = safeRules[index],
      c = safe.condition;
    let outcome = "applied";
    if (!safe.active) outcome = "inactive";
    else if (rule.program_type && String(rule.program_type) !== programType)
      outcome = "program_type";
    else if (c.weekdays !== null && !c.weekdays.includes(clock.weekday)) outcome = "weekday";
    else if (c.min_amount_q !== null && Number(amount_q || 0) < c.min_amount_q)
      outcome = "min_amount_q";
    else if (c.min_visits !== null && Number(visits || 0) < c.min_visits) outcome = "min_visits";
    else if (c.min_items !== null && Number(items || 0) < c.min_items) outcome = "min_items";
    else if (
      (c.start_hour !== null && clock.hour < c.start_hour) ||
      (c.end_hour !== null && clock.hour > c.end_hour)
    )
      outcome = "hours";
    const before = total;
    if (outcome === "applied") {
      total = safe.kind === "bonus_points" ? total + safe.value : total * safe.value;
      if (safe.max_points !== null) total = Math.min(total, safe.max_points);
    }
    return { ...safe, outcome, points_before: before, points_after: total };
  });
  const points = Math.max(0, Math.floor(total));
  const program = { type: programType, rate, round, quantity };
  return {
    points,
    evidence: {
      schema_version: 1,
      algorithm: "pf-points-v1",
      rule_version: createHash("sha256")
        .update(JSON.stringify({ type: programType, rate, round, rules: safeRules }))
        .digest("hex"),
      evaluated_at: now.toISOString(),
      clock: "server",
      time_zone: clock.timeZone,
      currency: businessRegion(business).currency,
      local_weekday: clock.weekday,
      local_hour: clock.hour,
      inputs: { amount_q: Number(amount_q), visits: Number(visits), items: Number(items) },
      program,
      base_points: base,
      rules,
      program_points: points,
    },
  };
}

// Both the writer and reader strip unrecognized fields, including nested data.
export const targetedOfferCriteriaSchema = z.object({
  schema_version: z.literal(1),
  clock: z.literal("database"),
  evaluated_at: dateTimeSchema(),
  minimum_purchase_q: z.number().finite().nonnegative(),
  starts_at: dateTimeSchema(),
  expires_at: dateTimeSchema(),
  points_budget: z.number().int().nonnegative().nullable(),
  points_committed_before: z.number().int().nonnegative(),
  points_committed_after: z.number().int().nonnegative(),
  eligibility: z.object({
    campaign_active: z.literal(true),
    saved_membership: z.literal("treatment"),
    unclaimed_before_award: z.literal(true),
    customer_not_deleted: z.literal(true),
    program_enabled_at_request: z.literal(true),
    plan_features_allowed: z.literal(true),
  }),
  purchase: z.object({
    amount_q: z.number().finite().nonnegative(),
    visits: z.number().int().nonnegative(),
    items: z.number().int().nonnegative(),
    source: z.enum(["online", "offline", "external", "order"]),
  }),
});
function safeTargetedCriteria(value) {
  const parsed = targetedOfferCriteriaSchema.safeParse(value);
  return parsed.success ? parsed.data : "not_snapshotted";
}

/**
 * @param evidence the evaluator's evidence object (returned enriched, so its shape is preserved)
 * @param {{
 *   bonus: { bonusPoints?: number, campaignId?: string | null, criteria?: unknown } | null | undefined,
 *   holdDays: number,
 *   status: string,
 *   availableAt: Date | null,
 *   source?: string | null,
 *   capturedAt?: string | null
 * }} outcome
 */
export function completeAwardEvidence(
  evidence,
  { bonus, holdDays, status, availableAt, source = null, capturedAt = null },
) {
  if (!evidence) return null; // An injected/custom evaluator cannot claim evidence it did not compute.
  const captured =
    source === "offline" &&
    typeof capturedAt === "string" &&
    Number.isFinite(Date.parse(capturedAt))
      ? new Date(capturedAt).toISOString()
      : null;
  return {
    ...evidence,
    targeted_offer: {
      bonus_points: Number(bonus?.bonusPoints || 0),
      campaign_id: bonus?.campaignId ?? null,
      criteria: safeTargetedCriteria(bonus?.criteria),
    },
    awarded_points: evidence.program_points + Number(bonus?.bonusPoints || 0),
    hold_days: holdDays,
    initial_status: status,
    available_at: availableAt?.toISOString() ?? null,
    offline_capture: captured ? { recorded_at: captured, clock: "client_reported" } : null,
  };
}
