import { randomUUID } from 'node:crypto';
import { businessRegion, assertRegionAmount } from './regional-settings.js';
import { dbQuery, withTransaction } from '../database.js';
import { PlanConfigService } from './plan-config-service.js';
import { hasPlanFeature } from '../../utils/plan.js';
import { badRequest, forbidden, notFound } from '../../utils/http-error.js';
import { withImpersonationMeta } from '../../utils/impersonation.js';
import { reportingPurchase } from './reporting-purchase.js';

const defaults = { transaction: withTransaction, getPlanFeatureOverrides: () => PlanConfigService.getPlanFeatureOverrides() };
const numberOrNull = value => value === null || value === undefined ? null : Number(value);
const rounded = value => Math.round((value + Number.EPSILON) * 100) / 100;

function boundedNullable(value, max, precision) {
  if (value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || Math.abs(value * (10 ** precision) - Math.round(value * (10 ** precision))) > 0.000001) {
    throw badRequest('Ingresa un importe válido o deja el campo vacío.');
  }
}
async function entitled(client, businessId, overrides) {
  // Protect the plan from concurrent edits while permitting the key-share
  // locks taken by a redemption's foreign keys (which already holds a reward).
  const { rows } = await client.query("SELECT id,plan,to_jsonb(b)->'program_json' AS program_json FROM businesses b WHERE id=$1 FOR NO KEY UPDATE", [businessId]);
  if (!rows[0]) throw notFound('Negocio no encontrado.');
  if (!hasPlanFeature(rows[0].plan, 'analytics', overrides)) throw forbidden('Tu plan no incluye el informe de costos.');
  return rows[0];
}
async function audit(client, actor, action, meta) {
  await client.query(`INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,ip,ua,meta)
    VALUES($1,$2,'STAFF',$3,$4,$5,$6,$7)`, [randomUUID(),actor.businessId,actor.staffId,action,actor.ip ?? null,actor.ua ?? null,JSON.stringify(withImpersonationMeta(meta,actor))]);
}

export async function updateRewardUnitCost(options, injected = {}) {
  boundedNullable(options.unitCostQ, 1000000, 2);
  const d = { ...defaults, ...injected }, overrides = await d.getPlanFeatureOverrides();
  return d.transaction(async client => {
    const business = await entitled(client, options.businessId, overrides);
    const region=businessRegion(business);
    if(options.unitCostQ!==null)assertRegionAmount(options.unitCostQ,region.currency,business);
    // The completion flow locks the same reward before spending points. This
    // serializes cost edits with completion, even when the cost row is absent.
    const { rows } = await client.query('SELECT id FROM rewards WHERE business_id=$1 AND id=$2 FOR UPDATE', [options.businessId,options.rewardId]);
    if (!rows[0]) throw notFound('Recompensa no encontrada.');
    await client.query(`INSERT INTO reward_unit_costs(business_id,reward_id,unit_cost_q,updated_by_staff_id)
      VALUES($1,$2,$3,$4) ON CONFLICT(business_id,reward_id) DO UPDATE
      SET unit_cost_q=EXCLUDED.unit_cost_q,updated_by_staff_id=EXCLUDED.updated_by_staff_id,updated_at=now()`, [options.businessId,options.rewardId,options.unitCostQ,options.staffId]);
    await audit(client,options,'reward.unit_cost.update',{reward_id:options.rewardId,unit_cost_q:options.unitCostQ,currency:region.currency});
    return {ok:true,reward_id:options.rewardId,unit_cost_q:options.unitCostQ,currency:region.currency};
  });
}
export async function updateRewardEconomicsSettings(options, injected = {}) {
  boundedNullable(options.grossMarginPct, 100, 2);
  boundedNullable(options.costPerPointQ, 1000, 6);
  const d = { ...defaults, ...injected }, overrides = await d.getPlanFeatureOverrides();
  return d.transaction(async client => {
    const region=businessRegion(await entitled(client, options.businessId, overrides));
    await client.query(`INSERT INTO reward_economics_settings(business_id,gross_margin_pct,cost_per_point_q,updated_by_staff_id)
      VALUES($1,$2,$3,$4) ON CONFLICT(business_id) DO UPDATE
      SET gross_margin_pct=EXCLUDED.gross_margin_pct,cost_per_point_q=EXCLUDED.cost_per_point_q,
        updated_by_staff_id=EXCLUDED.updated_by_staff_id,updated_at=now()`, [options.businessId,options.grossMarginPct,options.costPerPointQ,options.staffId]);
    const settings={gross_margin_pct:options.grossMarginPct,cost_per_point_q:options.costPerPointQ};
    await audit(client,options,'reward.economics.settings.update',{...settings,currency:region.currency});
    return {ok:true,settings,currency:region.currency};
  });
}

/** Only called inside the NEW completion transaction, never by reads, replays,
 * settings writes or migration backfills. NULL explicitly records unknown cost.
 * INSERT-only and the redemption primary key make replay unable to rewrite it. */
export async function snapshotCompletedRedemption(client, { businessId, redemptionId }) {
  await client.query(`INSERT INTO redemption_cost_snapshots(redemption_id,business_id,reward_id,points_cost,unit_cost_q,redeemed_at)
    SELECT r.id,r.business_id,r.reward_id,r.points_cost,c.unit_cost_q,COALESCE(r.redeemed_at,r.created_at)
    FROM redemptions r
    JOIN rewards rw ON rw.id=r.reward_id AND rw.business_id=r.business_id
    LEFT JOIN reward_unit_costs c ON c.business_id=r.business_id AND c.reward_id=r.reward_id
    WHERE r.business_id=$1 AND r.id=$2 AND r.status='REDEEMED'
    ON CONFLICT(redemption_id) DO NOTHING`, [businessId,redemptionId]);
}

const REPORT_SQL = `
WITH bounds AS (
 SELECT (($3::timestamptz AT TIME ZONE $4)::date - ($2::int - 1))::timestamp AT TIME ZONE $4 AS start_at,
   $3::timestamptz AS end_at
), completed AS (
 SELECT r.id,COALESCE(s.points_cost,r.points_cost) AS points_cost,s.unit_cost_q
 FROM redemptions r
 JOIN customers c ON c.id=r.customer_id AND c.business_id=$1
 JOIN rewards rw ON rw.id=r.reward_id AND rw.business_id=$1
 LEFT JOIN redemption_cost_snapshots s ON s.redemption_id=r.id AND s.business_id=$1
 CROSS JOIN bounds b
 WHERE r.business_id=$1 AND r.status='REDEEMED'
   AND COALESCE(s.redeemed_at,r.redeemed_at,r.created_at)>=b.start_at
   AND COALESCE(s.redeemed_at,r.redeemed_at,r.created_at)<b.end_at
), sales AS (
 SELECT COALESCE(SUM(t.amount_q),0) AS recorded_sales_q,COUNT(*) AS recorded_purchases
 FROM transactions t JOIN customers c ON c.id=t.customer_id AND c.business_id=$1
 CROSS JOIN bounds b
 WHERE t.business_id=$1 AND t.created_at>=b.start_at AND t.created_at<b.end_at
   AND ${reportingPurchase('t')}
), redemption_totals AS (
 SELECT COUNT(*) AS completed_redemptions,COUNT(unit_cost_q) AS costed_redemptions,
   COUNT(*) FILTER(WHERE unit_cost_q IS NULL) AS unknown_cost_redemptions,
   CASE WHEN COUNT(*)=0 THEN 0 ELSE SUM(unit_cost_q) END AS known_reward_cost_q,
   COALESCE(SUM(points_cost),0) AS points_redeemed,
   ROUND(100.0*COUNT(unit_cost_q)/NULLIF(COUNT(*),0),2) AS cost_coverage_pct
 FROM completed
), balances AS (
 SELECT COALESCE(SUM(GREATEST(cb.points,0)),0) AS outstanding_points,
   COALESCE(SUM(LEAST(cb.points,0)),0) AS negative_balance_points,
   COALESCE(SUM(cb.pending_points),0) AS pending_points
 FROM customer_balances cb JOIN customers c ON c.id=cb.customer_id
 WHERE c.business_id=$1 AND c.deleted_at IS NULL
), reward_page AS (
 SELECT r.id,r.name,r.points_cost,r.active,r.valid_until,c.unit_cost_q
 FROM rewards r LEFT JOIN reward_unit_costs c ON c.business_id=$1 AND c.reward_id=r.id
 WHERE r.business_id=$1 ORDER BY r.active DESC,r.name,r.id LIMIT 50 OFFSET $5
)
SELECT b.start_at,b.end_at,
 (SELECT to_jsonb(sales) FROM sales) || (SELECT to_jsonb(redemption_totals) FROM redemption_totals) || (SELECT to_jsonb(balances) FROM balances) AS observed,
 (SELECT jsonb_build_object('gross_margin_pct',gross_margin_pct,'cost_per_point_q',cost_per_point_q)
   FROM reward_economics_settings WHERE business_id=$1) AS settings,
 COALESCE((SELECT jsonb_agg(to_jsonb(reward_page)) FROM reward_page),'[]'::jsonb) AS rewards,
 (SELECT COUNT(*)::int FROM rewards WHERE business_id=$1) AS reward_count
FROM bounds b`;

export async function getRewardEconomics({businessId,days=30,offset=0,now=new Date(),timezone=undefined},query=dbQuery) {
  if (![30,90].includes(days) || !Number.isInteger(offset) || offset<0 || offset>100000) throw badRequest('Selecciona un período y una página válidos.');
  const business=(await query("SELECT to_jsonb(b)->'program_json' AS program_json FROM businesses b WHERE id=$1",[businessId])).rows[0];
  const region=businessRegion(business);timezone??=region.timezone;
  const {rows}=await query(REPORT_SQL,[businessId,days,now.toISOString(),timezone,offset]);
  const row=rows[0], observed=row.observed;
  const settings=row.settings ?? {gross_margin_pct:null,cost_per_point_q:null};
  settings.gross_margin_pct=numberOrNull(settings.gross_margin_pct);
  settings.cost_per_point_q=numberOrNull(settings.cost_per_point_q);
  const gross=settings.gross_margin_pct===null ? null : rounded(observed.recorded_sales_q*settings.gross_margin_pct/100);
  const reason=gross===null ? 'missing_gross_margin' : observed.unknown_cost_redemptions>0 ? 'incomplete_reward_costs' : null;
  return {
    ok:true,currency:region.currency,region,timezone,generated_at:now.toISOString(),
    period:{days,start:new Date(row.start_at).toISOString(),end:new Date(row.end_at).toISOString()},
    observed,settings,
    estimates:{
      gross_margin_before_rewards_q:gross,
      margin_after_rewards_q:reason===null ? rounded(gross-observed.known_reward_cost_q) : null,
      margin_unavailable_reason:reason,
      outstanding_points_cost_q:settings.cost_per_point_q===null ? null : rounded(observed.outstanding_points*settings.cost_per_point_q),
      pending_points_cost_q:settings.cost_per_point_q===null ? null : rounded(observed.pending_points*settings.cost_per_point_q)
    },
    rewards:row.rewards,rewards_pagination:{total:row.reward_count,limit:50,offset,has_more:offset+50<row.reward_count},
    notes:[
      'Ventas registradas en el programa, incluidas compras con puntos pendientes. No representan todas las ventas del negocio ni ventas causadas por el programa.',
      'Se excluyen las compras completamente revertidas. Las devoluciones parciales o pendientes de conciliación del POS aún pueden estar incluidas en las ventas registradas.',
      'El costo conocido suma solo canjes completados con costo registrado al completarse. Los costos faltantes y los canjes históricos sin registro permanecen desconocidos; editar un costo no cambia el historial.',
      'La cobertura es la proporción de canjes completados con costo conocido. Un costo confirmado de cero sí tiene cobertura.',
      'Los puntos disponibles suman saldos positivos actuales de clientes activos; los pendientes y saldos negativos se muestran por separado. Estos saldos no se limitan al período del informe.',
      'Las estimaciones usan tus supuestos actuales. No son utilidad neta, obligaciones contables ni una medición del retorno causado por el programa. El margen estimado después de premios requiere cobertura completa de costos.',
      'El historial de clientes eliminados se conserva sin datos personales. Hoy es parcial y los períodos usan el calendario local.'
    ]
  };
}
