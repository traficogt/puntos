import { readinessForBusiness } from "./merchant-data-readiness.js";

/** @typedef {import("./merchant-data-readiness.js").MerchantBusinessLike} MerchantBusinessLike */
/**
 * One allocation arm (treatment or control) as campaign-report-service groups it.
 * `returned_customers` may be null for a baseline period with unknown history.
 * @typedef {{
 *   members: number | null | undefined,
 *   returned_customers: number | null | undefined,
 *   observed_members?: number,
 *   unavailable_members?: number,
 *   [key: string]: unknown,
 * }} MeasurementGroup
 */
/**
 * Campaign fields the measurement reads (publicGrowthCampaign output or a row).
 * @typedef {{
 *   status: string,
 *   offer_kind?: string | null,
 *   starts_at?: string | Date | null,
 *   expires_at?: string | Date | null,
 *   observation_ends_at?: string | Date | null,
 *   reconciliation_ends_at?: string | Date | null,
 *   paused_at?: string | Date | null,
 * }} MeasurementCampaign
 */

// Wilson score interval, without continuity correction (NIST PRC 7.2.4.1).
// Difference: Newcombe (1998), Statistics in Medicine 17:873–890, method 10.
// Fixed-horizon intervals; repeated inspection is not sequential testing.
const Z95 = 1.959963984540054;
/**
 * @param {unknown} [successes] returned customers (any non-integer yields null)
 * @param {unknown} [total] assigned members
 */
export function wilsonInterval(successes, total) {
  if (
    typeof total !== "number" ||
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    typeof successes !== "number" ||
    !Number.isSafeInteger(successes) ||
    successes < 0 ||
    successes > total
  )
    return null;
  const p = successes / total,
    z2 = Z95 * Z95,
    divisor = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / divisor;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / divisor;
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}
/**
 * @param {MeasurementGroup} treatment
 * @param {MeasurementGroup} control
 */
export function returnDifference(treatment, control) {
  const a = wilsonInterval(treatment.returned_customers, treatment.members),
    b = wilsonInterval(control.returned_customers, control.members);
  if (!a || !b) return null;
  // wilsonInterval accepted both counts, so they are safe integers here.
  const p = Number(treatment.returned_customers) / Number(treatment.members),
    q = Number(control.returned_customers) / Number(control.members),
    difference = p - q;
  return {
    estimate_pp: difference * 100,
    lower_pp: Math.max(-1, difference - Math.hypot(p - a.lower, b.upper - q)) * 100,
    upper_pp: Math.min(1, difference + Math.hypot(a.upper - p, q - b.lower)) * 100,
    confidence_level: 0.95,
  };
}
/** @param {string | Date | null | undefined} value */
function stamp(value) {
  const ms = value == null ? NaN : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}
/** @param {MeasurementGroup} group */
function validGroup(group) {
  return (
    typeof group.members === "number" &&
    Number.isSafeInteger(group.members) &&
    group.members >= 0 &&
    typeof group.returned_customers === "number" &&
    Number.isSafeInteger(group.returned_customers) &&
    group.returned_customers >= 0 &&
    group.returned_customers <= group.members &&
    group.observed_members === group.members &&
    group.unavailable_members === 0
  );
}
/**
 * @param {{
 *   campaign: MeasurementCampaign,
 *   treatment: MeasurementGroup,
 *   control: MeasurementGroup,
 *   asOf: string | Date | null,
 *   business?: MerchantBusinessLike,
 *   messageCounts?: Record<string, unknown>,
 *   planning?: { required_treatment: number, required_control: number } | null,
 *   diagnostics?: {
 *     capture_state?: string,
 *     pending_refunds?: number,
 *     untrusted_time_purchases?: number,
 *     missing_purchase_dates?: number,
 *     [key: string]: unknown,
 *   },
 * }} input
 */
export function campaignMeasurement({
  campaign,
  treatment,
  control,
  asOf,
  business = {},
  messageCounts = {},
  planning = null,
  diagnostics = {},
}) {
  const now = stamp(asOf),
    start = stamp(campaign.starts_at),
    end = stamp(campaign.observation_ends_at ?? campaign.expires_at);
  const reconciliationEnd = stamp(campaign.reconciliation_ends_at) ?? end;
  const validWindow = now != null && start != null && end != null && end > start && now >= start;
  const complete = validWindow && now >= end;
  const quiet = campaign.offer_kind === "quiet";
  const readiness = readinessForBusiness(business, new Date(now ?? 0));
  const difference = quiet ? null : returnDifference(treatment, control);
  const missing = !validGroup(treatment) || !validGroup(control);
  let state;
  if (campaign.status === "draft" && start == null) state = "not_started";
  else if (
    !validWindow ||
    missing ||
    readiness.state === "blocked" ||
    diagnostics.capture_state === "incomplete" ||
    (diagnostics.pending_refunds ?? 0) > 0 ||
    (diagnostics.untrusted_time_purchases ?? 0) > 0 ||
    (diagnostics.missing_purchase_dates ?? 0) > 0 ||
    (!quiet && !difference)
  )
    state = "incomplete_data";
  else if (quiet) state = "descriptive";
  else if (campaign.paused_at || campaign.status === "paused") state = "interrupted";
  else if (!complete) state = "in_progress";
  else if (reconciliationEnd != null && now < reconciliationEnd) state = "reconciling";
  else if (
    planning &&
    (Number(treatment.members) < planning.required_treatment ||
      Number(control.members) < planning.required_control)
  )
    state = "insufficient_sample";
  // This is a conservative display guard, not a power calculation or a promise
  // that 30 participants is sufficient. The interval is retained either way.
  else if (!planning && (Number(treatment.members) < 30 || Number(control.members) < 30))
    state = "insufficient_sample";
  // Unreachable: a missing interval already resolved to "incomplete_data" above.
  else if (!difference) state = "incomplete_data";
  else if (difference.lower_pp > 0) state = "positive_difference";
  else if (difference.upper_pp < 0) state = "negative_difference";
  else state = "inconclusive";
  /** @param {string} key */
  const count = (key) => Math.max(0, Number(messageCounts[key]) || 0);
  const messages = {
    queued: count("queued"),
    processing: count("processing"),
    accepted: count("accepted"),
    failed: count("failed"),
    uncertain: count("uncertain"),
    suppressed: count("suppressed"),
  };
  return {
    state,
    as_of: now == null ? null : new Date(now).toISOString(),
    denominator: "all_assigned",
    method: quiet ? null : "newcombe_wilson_95",
    return_difference: difference,
    sample_counts: { treatment: treatment.members, control: control.members },
    window: {
      starts_at: campaign.starts_at,
      ends_at: campaign.observation_ends_at ?? campaign.expires_at,
      offer_ends_at: campaign.expires_at,
      reconciliation_ends_at: campaign.reconciliation_ends_at ?? campaign.expires_at,
      observed_until: validWindow ? new Date(Math.min(now, end)).toISOString() : null,
      complete,
      time_basis: "purchase_occurred_at_with_recorded_fallback",
    },
    data_readiness: readiness,
    unavailable_members:
      Number(treatment.unavailable_members || 0) + Number(control.unavailable_members || 0),
    assignment_counts_match:
      treatment.observed_members === treatment.members &&
      control.observed_members === control.members,
    messages: { ...messages, delivered: null, read: null },
  };
}
