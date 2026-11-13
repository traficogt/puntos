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

/** Current unfulfilled issue-time promises; never multiply point balances into this total. */
export async function getIssuedCommitments({businessId,now=new Date()},query=dbQuery){
 const business=(await query('SELECT program_json FROM businesses WHERE id=$1',[businessId])).rows[0];
 const region=businessRegion(business);
 const {rows}=await query(`WITH promises AS (
   SELECT p.id AS source_id,'protected_reward'::text AS kind,1::bigint AS units FROM customer_reward_promises p
   JOIN reward_promise_cycles c ON c.business_id=p.business_id AND c.id=p.cycle_id
   WHERE p.business_id=$1 AND c.completed_at IS NULL AND (p.valid_until IS NULL OR GREATEST(p.valid_until,(SELECT max(e.extended_until) FROM reward_promise_extensions e WHERE e.business_id=p.business_id AND e.promise_id=p.id))>$2)
 ), hospitality AS (
   SELECT e.id,'hospitality',1::bigint FROM hospitality_entitlements e
   WHERE e.business_id=$1 AND e.expires_at>$2 AND NOT EXISTS(SELECT 1 FROM reward_entitlement_fulfillments f WHERE f.business_id=$1 AND f.hospitality_id=e.id)
 ), offers AS (
   SELECT g.id,'offer',LEAST(count(m.id),CASE WHEN g.points_budget IS NULL THEN count(m.id) ELSE GREATEST(0,(g.points_budget-g.points_committed)/g.bonus_points) END)::bigint
   FROM growth_campaigns g JOIN growth_campaign_members m ON m.business_id=g.business_id AND m.campaign_id=g.id AND m.allocation='treatment' AND m.claimed_at IS NULL
   WHERE g.business_id=$1 AND g.status='active' AND g.starts_at<=$2 AND g.expires_at>$2 GROUP BY g.id
 ), all_issued AS (SELECT * FROM promises UNION ALL SELECT * FROM hospitality UNION ALL SELECT * FROM offers)
 SELECT i.kind,COALESCE(v.currency,'unknown') AS currency,SUM(i.units)::int AS units,
   COALESCE(SUM(i.units*v.retail_value) FILTER(WHERE v.retail_value IS NOT NULL),0) AS known_retail_value,
   COALESCE(SUM(i.units*v.fulfillment_cost) FILTER(WHERE v.fulfillment_cost IS NOT NULL),0) AS known_fulfillment_cost,
   COALESCE(SUM(i.units) FILTER(WHERE v.retail_value IS NULL),0)::int AS unknown_retail_units,
   COALESCE(SUM(i.units) FILTER(WHERE v.fulfillment_cost IS NULL),0)::int AS unknown_cost_units,
   COALESCE(SUM(i.units) FILTER(WHERE v.source_id IS NULL),0)::int AS historical_unknown_units
 FROM all_issued i LEFT JOIN issued_commitment_values v ON v.business_id=$1 AND v.source_kind=i.kind AND v.source_id=i.source_id
 WHERE i.units>0 GROUP BY i.kind,v.currency ORDER BY i.kind,v.currency`,[businessId,now]);
 return {ok:true,generated_at:now.toISOString(),region,points_separate:true,groups:rows.map(row=>({...row,known_retail_value:Number(row.known_retail_value),known_fulfillment_cost:Number(row.known_fulfillment_cost),cost_basis:row.kind==='offer'?'issue_time_point_cost_estimate':'entered_issue_time_fulfillment_cost'})),notes:[
  'Las opciones de un mismo ciclo protegido son alternativas: sus unidades no significan que se entregarán todos los premios. Se presentan separadas de las cortesías y ofertas.',
  'Los importes se conservan al emitir el beneficio. Los registros históricos sin captura siguen desconocidos; los costos actuales no completan el pasado.',
  'Las ofertas representan bonos pendientes sujetos al presupuesto y a una compra elegible. Su costo usa el supuesto por punto al activar; no es costo de entrega observado.',
  'Los saldos de puntos y sus escenarios permanecen separados. No se suman como recompensas garantizadas ni se descuentan de estos compromisos.',
  'Las monedas distintas y los importes sin moneda histórica se muestran por separado. No se realiza conversión.'
 ]};
}
