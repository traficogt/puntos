import { config } from "../../config/index.js";

export function computePoints(business, { amount_q = 0, visits = 0, items = 0 }) {
  const type = business.program_type ?? "SPEND";
  const cfg = business.program_json ?? {};

  if (type === "VISIT") {
    const p = Number(cfg.points_per_visit ?? 10);
    return applyCampaignRules(Math.max(0, Math.floor(visits || 1) * p), "VISIT", cfg, { amount_q, visits, items });
  }

  if (type === "ITEM") {
    const p = Number(cfg.points_per_item ?? 1);
    return applyCampaignRules(Math.max(0, Math.floor(items || 1) * p), "ITEM", cfg, { amount_q, visits, items });
  }

  // SPEND
  const rate = Number(cfg.points_per_q ?? 0.1); // points per Quetzal
  const raw = Number(amount_q) * rate;
  const round = String(cfg.round ?? "ceil");
  const val =
    round === "floor" ? Math.floor(raw) :
    round === "round" ? Math.round(raw) :
    Math.ceil(raw);

  return applyCampaignRules(Math.max(0, val), "SPEND", cfg, { amount_q, visits, items });
}

function applyCampaignRules(basePoints, programType, cfg, input) {
  const rules = Array.isArray(cfg.campaign_rules) ? cfg.campaign_rules : [];
  if (!rules.length) return Math.max(0, Math.floor(basePoints));

  const { weekday, hour } = getLocalTimeParts(new Date(), config.CRON_TZ || "UTC");
  let points = Math.max(0, Number(basePoints || 0));

  for (const rule of rules) {
    if (!rule || rule.active === false) continue;
    if (rule.program_type && String(rule.program_type) !== String(programType)) continue;

    const c = rule.condition || {};
    if (Array.isArray(c.weekdays) && c.weekdays.length && !c.weekdays.includes(weekday)) continue;
    if (Number.isFinite(Number(c.min_amount_q)) && Number(input.amount_q || 0) < Number(c.min_amount_q)) continue;
    if (Number.isFinite(Number(c.min_visits)) && Number(input.visits || 0) < Number(c.min_visits)) continue;
    if (Number.isFinite(Number(c.min_items)) && Number(input.items || 0) < Number(c.min_items)) continue;
    if (Number.isFinite(Number(c.start_hour)) && hour < Number(c.start_hour)) continue;
    if (Number.isFinite(Number(c.end_hour)) && hour > Number(c.end_hour)) continue;

    const kind = String(rule.kind || "multiplier");
    if (kind === "bonus_points") {
      points += Number(rule.value || 0);
    } else {
      points *= Number(rule.value || 1);
    }
    if (Number.isFinite(Number(rule.max_points)) && Number(rule.max_points) > 0) {
      points = Math.min(points, Number(rule.max_points));
    }
  }

  return Math.max(0, Math.floor(points));
}

function getLocalTimeParts(date, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      hour12: false
    });
    const parts = fmt.formatToParts(date);
    const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
    const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      hour: Number(hourStr),
      weekday: weekdayMap[weekdayStr] ?? date.getDay()
    };
  } catch {
    return { hour: date.getHours(), weekday: date.getDay() };
  }
}
