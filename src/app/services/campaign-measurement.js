import { readinessForBusiness } from './merchant-data-readiness.js';

// Wilson score interval, without continuity correction (NIST PRC 7.2.4.1).
// Difference: Newcombe (1998), Statistics in Medicine 17:873–890, method 10.
// Fixed-horizon intervals; repeated inspection is not sequential testing.
const Z95 = 1.959963984540054;
export function wilsonInterval(successes, total) {
  if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(successes) || successes < 0 || successes > total) return null;
  const p = successes / total, z2 = Z95 * Z95, divisor = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / divisor;
  const half = Z95 * Math.sqrt(p * (1 - p) / total + z2 / (4 * total * total)) / divisor;
  return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
}
export function returnDifference(treatment, control) {
  const a = wilsonInterval(treatment.returned_customers, treatment.members), b = wilsonInterval(control.returned_customers, control.members);
  if (!a || !b) return null;
  const p = treatment.returned_customers / treatment.members, q = control.returned_customers / control.members, difference = p - q;
  return {
    estimate_pp: difference * 100,
    lower_pp: Math.max(-1, difference - Math.hypot(p - a.lower, b.upper - q)) * 100,
    upper_pp: Math.min(1, difference + Math.hypot(a.upper - p, q - b.lower)) * 100,
    confidence_level: 0.95,
  };
}
function stamp(value) { const ms = value == null ? NaN : Date.parse(value); return Number.isFinite(ms) ? ms : null; }
function validGroup(group) {
  return Number.isSafeInteger(group.members) && group.members >= 0 && Number.isSafeInteger(group.returned_customers) && group.returned_customers >= 0 && group.returned_customers <= group.members && group.observed_members === group.members && group.unavailable_members === 0;
}
export function campaignMeasurement({ campaign, treatment, control, asOf, business = {}, messageCounts = {} }) {
  const now = stamp(asOf), start = stamp(campaign.starts_at), end = stamp(campaign.expires_at);
  const validWindow = now != null && start != null && end != null && end > start && now >= start;
  const complete = validWindow && now >= end;
  const quiet = campaign.offer_kind === 'quiet';
  const readiness = readinessForBusiness(business, new Date(now ?? 0));
  const difference = quiet ? null : returnDifference(treatment, control);
  const missing = !validGroup(treatment) || !validGroup(control);
  let state;
  if (campaign.status === 'draft' && start == null) state = 'not_started';
  else if (!validWindow || missing || readiness.state === 'blocked' || !quiet && !difference) state = 'incomplete_data';
  else if (quiet) state = 'descriptive';
  else if (campaign.paused_at || campaign.status === 'paused') state = 'interrupted';
  else if (!complete) state = 'in_progress';
  // This is a conservative display guard, not a power calculation or a promise
  // that 30 participants is sufficient. The interval is retained either way.
  else if (treatment.members < 30 || control.members < 30) state = 'insufficient_sample';
  else if (difference.lower_pp > 0) state = 'positive_difference';
  else if (difference.upper_pp < 0) state = 'negative_difference';
  else state = 'inconclusive';
  const count = key => Math.max(0, Number(messageCounts[key]) || 0);
  const messages = { queued:count('queued'), processing:count('processing'), accepted:count('accepted'), failed:count('failed'), uncertain:count('uncertain'), suppressed:count('suppressed') };
  return {
    state, as_of: now == null ? null : new Date(now).toISOString(), denominator: 'all_assigned',
    method: quiet ? null : 'newcombe_wilson_95', return_difference: difference,
    window: { starts_at: campaign.starts_at, ends_at: campaign.expires_at, observed_until: validWindow ? new Date(Math.min(now, end)).toISOString() : null, complete, time_basis: 'transaction_created_at' },
    data_readiness: readiness,
    unavailable_members: Number(treatment.unavailable_members || 0) + Number(control.unavailable_members || 0),
    assignment_counts_match: treatment.observed_members === treatment.members && control.observed_members === control.members,
    messages: { ...messages, delivered: null, read: null },
  };
}
