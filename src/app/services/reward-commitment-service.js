import { businessRegion } from './regional-settings.js';
import { dbQuery } from '../database.js';
import { badRequest } from '../../utils/http-error.js';

// Restoring points records a customer remedy. It does not prove that the
// original fulfillment cost was recovered, so historical costs stay intact.
export async function getServiceRestorationCosts({ businessId, days = 30, now = new Date(), timezone = undefined }, query = dbQuery) {
  if (![30, 90].includes(days)) throw badRequest('Elige un período de 30 o 90 días.');
  const business=(await query("SELECT to_jsonb(b)->'program_json' AS program_json FROM businesses b WHERE id=$1",[businessId])).rows[0];
  const region=businessRegion(business);timezone??=region.timezone;
  const { rows } = await query(`WITH bounds AS (
    SELECT (($3::timestamptz AT TIME ZONE $4)::date - ($2::int - 1))::timestamp AT TIME ZONE $4 AS start_at,
      $3::timestamptz AS end_at
  ) SELECT COUNT(*)::int AS restored_redemptions,
    COALESCE(SUM(r.points_restored),0) AS restored_points,
    CASE WHEN COUNT(*)=0 THEN 0 ELSE SUM(s.unit_cost_q) END AS known_original_cost_q,
    COUNT(*) FILTER (WHERE s.unit_cost_q IS NULL)::int AS unknown_original_costs
  FROM service_redemption_restorations r
  LEFT JOIN redemption_cost_snapshots s ON s.business_id=r.business_id AND s.redemption_id=r.redemption_id
  CROSS JOIN bounds b
  WHERE r.business_id=$1 AND r.created_at>=b.start_at AND r.created_at<b.end_at`, [businessId, days, now.toISOString(), timezone]);
  const row = rows[0];
  return { ok: true, currency: region.currency, region, timezone, generated_at: now.toISOString(),
    restored_redemptions: Number(row.restored_redemptions), restored_points: Number(row.restored_points),
    known_original_cost_q: row.known_original_cost_q === null ? null : Number(row.known_original_cost_q),
    unknown_original_costs: Number(row.unknown_original_costs) };
}
