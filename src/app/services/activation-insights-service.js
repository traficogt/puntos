import { z } from 'zod';
import { dbQuery, getDbTenantId } from '../database.js';
import { badRequest, notFound } from '../../utils/http-error.js';
import { businessRegion } from './regional-settings.js';
import { activityAttributionSql } from './activity-attribution.js';

const uuid = z.guid();
async function scope(businessId, branchId, now) {
  if (!uuid.safeParse(businessId).success || getDbTenantId() !== businessId) throw notFound('Negocio no disponible.');
  if (branchId !== null && !uuid.safeParse(branchId).success) throw badRequest('Sucursal no válida.');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw badRequest('Fecha no válida.');
  const { rows } = await dbQuery('SELECT program_json FROM businesses WHERE id=$1', [businessId]);
  if (!rows[0]) throw notFound('Negocio no disponible.');
  if (branchId && !(await dbQuery('SELECT id FROM branches WHERE business_id=$1 AND id=$2', [businessId, branchId])).rowCount) throw notFound('Sucursal no disponible.');
  return businessRegion(rows[0]);
}

const exposureSql = `WITH issued AS (
 SELECT e.approved_cost,c.unit_cost_q
 FROM hospitality_entitlements e
 JOIN customers customer ON customer.id=e.customer_id AND customer.business_id=e.business_id AND customer.deleted_at IS NULL
 LEFT JOIN reward_unit_costs c ON c.business_id=e.business_id AND c.reward_id=e.reward_id
 WHERE e.business_id=$1 AND ($2::uuid IS NULL OR e.branch_id=$2)
 AND e.issued_at<=$3::timestamptz AND e.expires_at>$3::timestamptz
 AND NOT EXISTS(SELECT 1 FROM reward_entitlement_fulfillments f WHERE f.business_id=e.business_id AND f.hospitality_id=e.id)
), choices AS (
 SELECT cycle.id,COUNT(*) AS alternatives,BOOL_OR(cost.unit_cost_q IS NULL) AS missing_cost
 FROM reward_promise_cycles cycle
 JOIN customers customer ON customer.id=cycle.customer_id AND customer.business_id=cycle.business_id AND customer.deleted_at IS NULL
 JOIN customer_reward_promises p ON p.cycle_id=cycle.id AND p.business_id=cycle.business_id
 LEFT JOIN reward_unit_costs cost ON cost.business_id=p.business_id AND cost.reward_id=p.reward_id
 WHERE cycle.business_id=$1 AND cycle.completed_at IS NULL AND cycle.observed_at<=$3::timestamptz
 AND (p.valid_until IS NULL OR p.valid_until>$3::timestamptz)
 GROUP BY cycle.id
), balances AS (
 SELECT COALESCE(SUM(GREATEST(cb.points,0)),0) AS outstanding,
 COALESCE(SUM(cb.pending_points),0) AS pending,COALESCE(SUM(LEAST(cb.points,0)),0) AS negative
 FROM customer_balances cb JOIN customers c ON c.id=cb.customer_id
 WHERE c.business_id=$1 AND c.deleted_at IS NULL
), bounds AS (
 SELECT ((($3::timestamptz AT TIME ZONE $4)::date-29)::timestamp AT TIME ZONE $4) AS start_at
), completed AS (
 SELECT s.unit_cost_q FROM redemptions r
 JOIN customers c ON c.id=r.customer_id AND c.business_id=r.business_id
 LEFT JOIN redemption_cost_snapshots s ON s.business_id=r.business_id AND s.redemption_id=r.id
 CROSS JOIN bounds b
 WHERE r.business_id=$1 AND r.status='REDEEMED' AND ($2::uuid IS NULL OR r.branch_id=$2)
 AND COALESCE(s.redeemed_at,r.redeemed_at,r.created_at)>=b.start_at
 AND COALESCE(s.redeemed_at,r.redeemed_at,r.created_at)<$3::timestamptz
)
SELECT
 (SELECT jsonb_build_object('outstanding',COUNT(*),'costed',COUNT(unit_cost_q),'missing_cost',COUNT(*)-COUNT(unit_cost_q),
 'known_estimated_cost_q',CASE WHEN COUNT(*)=0 THEN 0 ELSE SUM(unit_cost_q) END,
 'cost_coverage_pct',ROUND(100.0*COUNT(unit_cost_q)/NULLIF(COUNT(*),0),2),
 'approved_at_issue_cost_q',COALESCE(SUM(approved_cost),0)) FROM issued) AS issued,
 (SELECT jsonb_build_object('open_cycles',COUNT(*),'alternatives',COALESCE(SUM(alternatives),0),
 'cycles_missing_cost',COUNT(*) FILTER(WHERE missing_cost),'scope','business') FROM choices) AS protected_choices,
 (SELECT to_jsonb(balances) FROM balances) AS points,
 (SELECT cost_per_point_q FROM reward_economics_settings WHERE business_id=$1) AS cost_per_point_q,
 (SELECT jsonb_build_object('count',COUNT(*),'costed',COUNT(unit_cost_q),'missing_cost',COUNT(*)-COUNT(unit_cost_q),
 'known_snapshot_cost_q',CASE WHEN COUNT(*)=0 THEN 0 ELSE SUM(unit_cost_q) END) FROM completed) AS completed,
 (SELECT start_at FROM bounds) AS history_start`;

export async function getRewardExposure({ businessId, branchId = null, now = new Date() }) {
  const region = await scope(businessId, branchId, now);
  const { rows } = await dbQuery(exposureSql, [businessId, branchId, now.toISOString(), region.timezone]);
  const row = rows[0], cost = row.cost_per_point_q === null ? null : Number(row.cost_per_point_q);
  return { ok: true, region, currency: region.currency, timezone: region.timezone, generated_at: now.toISOString(), branch_id: branchId,
    issued: row.issued, protected_choices: row.protected_choices,
    points: { ...row.points, scope: 'business', cost_per_point_q: cost,
      scenario_cost_q: cost === null ? null : Math.round(row.points.outstanding * cost * 100) / 100 },
    completed: { ...row.completed, period: { start: new Date(row.history_start).toISOString(), end: now.toISOString(), days: 30 } },
    assumptions: { issued_cost: 'current_merchant_unit_cost', approved_cost: 'recorded_at_issue', completed_cost: 'recorded_at_completion', add_categories: false }
  };
}

const aggregate = `COUNT(*)::int AS movements,
 COUNT(*) FILTER(WHERE purchase)::int AS purchases,
 COALESCE(SUM(amount_q) FILTER(WHERE purchase),0) AS recorded_purchase_amount_q,
 COUNT(*) FILTER(WHERE award)::int AS awards,
 COALESCE(SUM(points) FILTER(WHERE award),0) AS points_awarded,
 COUNT(*) FILTER(WHERE kind='adjustment')::int AS adjustments,
 COALESCE(SUM(points) FILTER(WHERE kind='adjustment'),0) AS adjustment_points,
 COALESCE(SUM(delta_pending) FILTER(WHERE kind='adjustment'),0) AS adjustment_pending_points,
 COUNT(*) FILTER(WHERE kind='refund')::int AS reversals,
 COALESCE(SUM(points) FILTER(WHERE kind='refund'),0) AS reversal_points`;
const activitySql = `WITH bounds AS (
 SELECT date_trunc('week',$3::timestamptz AT TIME ZONE $4) AT TIME ZONE $4 AS start_at
), activity AS (
 SELECT t.staff_user_id,t.source,t.points,t.amount_q,0 AS delta_pending,
 CASE WHEN t.source='reversal' OR t.type='REFUND' THEN 'refund' ELSE 'transaction' END AS kind,
 (t.source IN('online','offline','external','order') AND (t.type='PURCHASE' OR t.type IS NULL)
 AND t.original_transaction_id IS NULL AND (t.amount_q>0 OR t.visits>0 OR t.items>0)) AS purchase,
 (t.points>0 AND t.source NOT IN('reversal','redeem','migration') AND COALESCE(t.type,'PURCHASE') NOT IN('REFUND','OPENING_BALANCE')) AS award
 FROM transactions t JOIN customers c ON c.id=t.customer_id AND c.business_id=t.business_id CROSS JOIN bounds b
 WHERE t.business_id=$1 AND ($2::uuid IS NULL OR t.branch_id=$2)
 AND t.created_at>=b.start_at AND t.created_at<$3::timestamptz
 AND t.status IN('POSTED','PENDING','REVERSED','EXPIRED') AND t.source<>'redeem'
 AND COALESCE(t.type,'PURCHASE')<>'OPENING_BALANCE'
 UNION ALL
 SELECT a.created_by_staff_id,'ledger_correction',a.delta_points,0,a.delta_pending_points,'adjustment',false,false
 FROM ledger_balance_adjustments a JOIN customers c ON c.id=a.customer_id AND c.business_id=a.business_id CROSS JOIN bounds b
 WHERE a.business_id=$1 AND $2::uuid IS NULL AND a.created_at>=b.start_at AND a.created_at<$3::timestamptz
), attributed AS (
 SELECT a.*,${activityAttributionSql} AS actor_group,s.name,s.active,
 CASE WHEN (${activityAttributionSql})='staff' THEN s.id END AS actor_id
 FROM activity a LEFT JOIN staff_users s ON s.id=a.staff_user_id AND s.business_id=$1
), grouped AS (
 SELECT actor_group,actor_id,name,active,${aggregate} FROM attributed GROUP BY actor_group,actor_id,name,active
), staff_page AS (
 SELECT actor_id AS staff_id,LEFT(name,200) AS name,active,${aggregate} FROM attributed
 WHERE actor_group='staff' GROUP BY actor_id,name,active ORDER BY name,actor_id LIMIT 20
), sources AS (
 SELECT actor_group AS "group",${aggregate} FROM attributed WHERE actor_group<>'staff' GROUP BY actor_group
)
SELECT (SELECT start_at FROM bounds) AS start_at,
 (SELECT to_jsonb(t) FROM (SELECT ${aggregate} FROM attributed) t) AS totals,
 COALESCE((SELECT jsonb_agg(to_jsonb(staff_page)) FROM staff_page),'[]'::jsonb) AS staff,
 COALESCE((SELECT jsonb_agg(to_jsonb(sources) ORDER BY "group") FROM sources),'[]'::jsonb) AS sources,
 (SELECT COUNT(*)::int FROM grouped WHERE actor_group='staff') AS staff_total`;

export async function getStaffActivity({ businessId, branchId = null, now = new Date() }) {
  const region = await scope(businessId, branchId, now);
  const { rows } = await dbQuery(activitySql, [businessId, branchId, now.toISOString(), region.timezone]);
  const row = rows[0];
  return { ok: true, region, currency: region.currency, timezone: region.timezone, generated_at: now.toISOString(), branch_id: branchId,
    period: { start: new Date(row.start_at).toISOString(), end: now.toISOString(), partial: true },
    totals: row.totals, staff: row.staff, staff_total: row.staff_total, staff_limit: 20, sources: row.sources,
    adjustments_scope: branchId ? 'excluded_no_recorded_branch' : 'business',
    interpretation: 'recorded_activity_not_performance_or_fraud'
  };
}
