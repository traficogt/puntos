import { z } from 'zod';
import { dateTimeSchema } from '../../utils/date-time-schema.js';
import { targetedOfferCriteriaSchema } from './transaction-rule-evidence.js';
const uuid = z.guid();
const finite = z.number().finite();
const numberOrNull = finite.nullable();
const date = dateTimeSchema();
const rule = z.object({
  index: z.number().int().nonnegative(), present: z.boolean(), active: z.boolean(), program_type: z.enum(['SPEND','VISIT','ITEM','OTHER']).nullable(),
  kind: z.enum(['bonus_points','multiplier']), value: finite, max_points: numberOrNull,
  condition: z.object({ weekdays: z.array(z.number().int().min(0).max(6)).nullable(), min_amount_q: numberOrNull, min_visits: numberOrNull, min_items: numberOrNull, start_hour: numberOrNull, end_hour: numberOrNull }),
  outcome: z.enum(['applied','inactive','program_type','weekday','min_amount_q','min_visits','min_items','hours']), points_before: finite, points_after: finite
});
// Parse every level to an allowlist; neither configuration nor arbitrary meta is returned.
export const awardSchema = z.object({
  schema_version: z.literal(1), algorithm: z.literal('pf-points-v1'), rule_version: z.string().regex(/^[a-f0-9]{64}$/),
  // Older snapshots did not store currency; absence must remain unknown.
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  evaluated_at: date, clock: z.literal('server'), time_zone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; } }), local_weekday: z.number().int().min(0).max(6), local_hour: z.number().int().min(0).max(24),
  inputs: z.object({ amount_q: finite, visits: finite, items: finite }),
  program: z.object({ type: z.enum(['SPEND','VISIT','ITEM']), rate: finite, round: z.enum(['ceil','floor','round']), quantity: finite }),
  base_points: finite, rules: z.array(rule).max(1000), program_points: z.number().int().nonnegative(),
  targeted_offer: z.object({ bonus_points: z.number().int().nonnegative(), campaign_id: uuid.nullable(), criteria: z.union([z.literal('not_snapshotted'), targetedOfferCriteriaSchema]) }),
  awarded_points: z.number().int().nonnegative(), hold_days: z.number().int().nonnegative(), initial_status: z.enum(['POSTED','PENDING']), available_at: date.nullable(),
  offline_capture: z.object({ recorded_at: date, clock: z.literal('client_reported') }).nullable()
});
