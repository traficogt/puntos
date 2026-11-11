import { dbQuery } from '../database.js';
import { forbidden } from '../../utils/http-error.js';
import { businessRegion } from './regional-settings.js';
import { getRedemptionReturns } from './redemption-return-service.js';

const OUTCOMES_SQL = `WITH costs AS (
  SELECT count(*)::int AS active,count(*) FILTER(WHERE c.unit_cost_q IS NULL)::int AS missing
  FROM rewards r LEFT JOIN reward_unit_costs c ON c.business_id=$1 AND c.reward_id=r.id
  WHERE r.business_id=$1 AND r.active=true AND (r.valid_until IS NULL OR r.valid_until>$2::timestamptz)
), hospitality AS (
  SELECT count(*)::int AS total,count(f.id)::int AS fulfilled,
    count(*) FILTER(WHERE f.id IS NULL)::int AS expired_unused,
    COALESCE(sum(e.unit_cost_limit) FILTER(WHERE f.id IS NULL),0) AS reserved_unused
  FROM hospitality_entitlements e
  LEFT JOIN reward_entitlement_fulfillments f ON f.business_id=e.business_id AND f.hospitality_id=e.id
  WHERE e.business_id=$1 AND e.expires_at>=$2::timestamptz-interval '720 hours' AND e.expires_at<$2::timestamptz
)
SELECT c.active,c.missing,h.total,h.fulfilled,h.expired_unused,h.reserved_unused FROM costs c CROSS JOIN hospitality h`;

/** Read-only evidence. No new grants, campaigns, messages or reward issuances. */
export async function getOwnerOutcomeEvidence({ businessId, business, now = new Date(), includeReturns = true }, query = dbQuery) {
  if (business?.id !== businessId) throw forbidden('El negocio no coincide con la consulta.');
  const row = (await query(OUTCOMES_SQL, [businessId, now.toISOString()])).rows[0];
  const returns = includeReturns ? await getRedemptionReturns({ businessId, days: 90, now }, query) : null;
  return {
    as_of: now.toISOString(), region: businessRegion(business),
    period: { days: 30, start: new Date(now.getTime() - 30 * 86400000).toISOString(), end: now.toISOString() },
    costs: { active: Number(row.active), missing: Number(row.missing) },
    hospitality: { total: Number(row.total), fulfilled: Number(row.fulfilled), expired_unused: Number(row.expired_unused), reserved_unused: Number(row.reserved_unused) },
    returns
  };
}
