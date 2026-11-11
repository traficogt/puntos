import {DateTime,IANAZone} from 'luxon';
import {regionalLocalDate,regionTimezone} from './regional-settings.js';
import {readinessForBusiness,promotionDelay} from './merchant-data-readiness.js';
import crypto from 'node:crypto';
import {logger} from '../../utils/logger.js';
import {z} from 'zod';
import {dbQuery,withTransaction,withDbClientContext} from '../database.js';
import {hasPlanFeature} from '../../utils/plan.js';
import {badRequest,forbidden,notFound} from '../../utils/http-error.js';
import {PlanConfigService} from './plan-config-service.js';
import {marketingProviderReady} from './messaging-service.js';
import {AuditRepo} from '../repositories/audit-repository.js';

export const AUTOMATION_RULES=['birthday','winback'];
export const AutomationSettings=z.object({
  birthday_enabled:z.boolean(),birthday_points:z.number().int().min(0).max(10000),birthday_monthly_points_cap:z.number().int().min(0).max(2000000),
  winback_enabled:z.boolean(),winback_days:z.number().int().min(7).max(365),winback_points:z.number().int().min(0).max(10000),winback_monthly_points_cap:z.number().int().min(0).max(2000000),
  minimum_contact_days:z.number().int().min(7).max(90),scheduler_hour_local:z.number().int().min(9).max(17),scheduler_tz:z.string().max(100).refine(value=>value.includes('/')&&IANAZone.isValidZone(value))
}).strict().refine(cfg=>AUTOMATION_RULES.every(rule=>!cfg[`${rule}_enabled`]||cfg[`${rule}_monthly_points_cap`]>=cfg[`${rule}_points`]),{message:'El presupuesto debe cubrir al menos un incentivo activo.'});
const bounded=(value,min,max,fallback)=>Number.isInteger(value)&&value>=min&&value<=max?value:fallback;
export function automationSettings(raw={},business={}) {
  raw=raw && typeof raw==='object' && !Array.isArray(raw)?raw:{};
  return {birthday_enabled:raw.birthday_enabled===true,birthday_points:bounded(raw.birthday_points,0,10000,0),birthday_monthly_points_cap:bounded(raw.birthday_monthly_points_cap,0,2000000,0),winback_enabled:raw.winback_enabled===true,winback_days:bounded(raw.winback_days,7,365,30),winback_points:bounded(raw.winback_points,0,10000,0),winback_monthly_points_cap:bounded(raw.winback_monthly_points_cap,0,2000000,0),minimum_contact_days:bounded(raw.minimum_contact_days,7,90,7),scheduler_hour_local:bounded(raw.scheduler_hour_local,9,17,9),scheduler_tz:regionTimezone(business)};
}
export const automationLocalDate=(now,business={})=>regionalLocalDate(now,business);
export const automationMonth=(now,business={})=>`${automationLocalDate(now,business).slice(0,7)}-01`;
async function businessRow(businessId,client={query:dbQuery},lock=false) {
  const {rows}=await client.query(`SELECT id,name,plan,program_json FROM businesses WHERE id=$1 ${lock?'FOR NO KEY UPDATE':''}`,[businessId]);
  if(!rows[0]) throw notFound('Negocio no encontrado.');return rows[0];
}
const eligibleSql=`c.business_id=$1 AND c.deleted_at IS NULL AND
  (($2='birthday' AND to_char(c.birthday,'MM-DD')=to_char($3::date,'MM-DD')) OR
   ($2='winback' AND (c.last_visit_at AT TIME ZONE $5)::date=$3::date-$4::int))`;
const inactivityAnchorSql=`to_char(c.last_visit_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US')`;
const notProcessedSql=`NOT EXISTS(SELECT 1 FROM lifecycle_events e WHERE e.business_id=c.business_id AND e.customer_id=c.id AND e.event_type=$2
  AND (e.event_date=$3::date OR ($2='winback' AND
    (e.meta->>'inactivity_anchor'=${inactivityAnchorSql} OR
      (NOT (e.meta ? 'inactivity_anchor') AND e.event_date>=(c.last_visit_at AT TIME ZONE $5)::date)))))`;
export async function getAutomationControls({businessId,now=new Date()}) {
  const business=await businessRow(businessId);const settings=automationSettings(business.program_json?.lifecycle,business);
  const entitled=hasPlanFeature(business.plan,'lifecycle_automation',await PlanConfigService.getPlanFeatureOverrides());
  if(!entitled) throw forbidden('Tu plan no incluye automatizaciones.');
  const rules={};
  for(const rule of AUTOMATION_RULES) {
    const {rows}=await dbQuery(`SELECT count(*)::int AS candidates,count(*) FILTER(WHERE p.marketing_opt_in AND c.phone IS NOT NULL AND c.phone<>'')::int AS consented,
      count(*) FILTER(WHERE p.marketing_opt_in AND c.phone IS NOT NULL AND c.phone<>'' AND ${notProcessedSql})::int AS unprocessed
      FROM customers c LEFT JOIN customer_marketing_preferences p ON p.business_id=c.business_id AND p.customer_id=c.id WHERE ${eligibleSql}`,[businessId,rule,automationLocalDate(now,business),settings.winback_days,regionTimezone(business)]);
    const budget=await dbQuery('SELECT points_committed,awards FROM lifecycle_automation_budgets WHERE business_id=$1 AND rule=$2 AND month=$3',[businessId,rule,automationMonth(now,business)]);
    const points_committed=budget.rows[0]?.points_committed??0;const points_remaining=Math.max(0,settings[`${rule}_monthly_points_cap`]-points_committed);
    const dataReadiness=readinessForBusiness(business,now);
    rules[rule]={...rows[0],paused:rule==='winback'&&!dataReadiness.inactivity_allowed,pause_reason:rule==='winback'&&!dataReadiness.inactivity_allowed?`data_quality_${dataReadiness.reason}`:null,points_committed,points_remaining,monthly_awards:budget.rows[0]?.awards??0,available_awards:rule==='winback'&&!dataReadiness.inactivity_allowed?0:Math.min(rows[0].unprocessed,settings[`${rule}_points`]>0?Math.floor(points_remaining/settings[`${rule}_points`]):rows[0].unprocessed)};
  }
  const grouped=await dbQuery(`SELECT status,count(*)::int AS count FROM lifecycle_message_outbox WHERE business_id=$1 AND created_at>=$2::timestamptz-interval '30 days' GROUP BY status`,[businessId,now]);
  const counts=Object.fromEntries(['queued','processing','accepted','failed','uncertain','suppressed'].map(status=>[status,0]));for(const row of grouped.rows)counts[row.status]=row.count;
  const history=await dbQuery(`SELECT rule,status,points,reason,created_at,accepted_at FROM lifecycle_message_outbox WHERE business_id=$1 AND created_at>=$2::timestamptz-interval '30 days' ORDER BY created_at DESC,id DESC LIMIT 30`,[businessId,now]);
  return{ok:true,data_readiness:readinessForBusiness(business,now),promotion_pause:promotionDelay({business,now}),settings,rules,counts,history:history.rows,month:automationMonth(now,business),date:automationLocalDate(now,business),timezone:regionTimezone(business),provider_ready:marketingProviderReady(),delivery_note:'Aceptado por el proveedor no significa entregado ni leído. Los puntos se abonan al preparar el incentivo, aunque el mensaje no se entregue.'};
}
export async function saveAutomationSettings({businessId,settings,staffId=null,ip=null,ua=null}) {
  const parsed=AutomationSettings.safeParse(settings);if(!parsed.success)throw badRequest('Revisa los límites y el presupuesto de cada incentivo.');
  const overrides=await PlanConfigService.getPlanFeatureOverrides();
  await withTransaction(async client=>{
    const business=await businessRow(businessId,client,true);if(!hasPlanFeature(business.plan,'lifecycle_automation',overrides))throw forbidden('Tu plan no incluye automatizaciones.');
    parsed.data.scheduler_tz=regionTimezone(business);
    const program={...(business.program_json??{}),lifecycle:{...(business.program_json?.lifecycle??{}),...parsed.data}};
    await client.query('UPDATE businesses SET program_json=$2 WHERE id=$1',[businessId,program]);
    for(const rule of AUTOMATION_RULES)if(!parsed.data[`${rule}_enabled`])await client.query(`UPDATE lifecycle_message_outbox SET status='suppressed',reason='automation_paused',updated_at=now() WHERE business_id=$1 AND rule=$2 AND status IN ('queued','failed')`,[businessId,rule]);
    await AuditRepo.log({id:crypto.randomUUID(),business_id:businessId,actor_type:staffId?'STAFF':'SYSTEM',actor_id:staffId,action:'automation.settings.updated',ip,ua,meta:parsed.data});
  });
  return {ok:true,settings:parsed.data};
}
export async function runAutomationRule({businessId,rule,now=new Date(),limit=200}) {
  if(!AUTOMATION_RULES.includes(rule))throw badRequest('Automatización no válida.');
  const overrides=await PlanConfigService.getPlanFeatureOverrides();
  return withTransaction(async client=>{
    // Business first: serializes configuration and the two monthly budget reservations.
    const business=await businessRow(businessId,client,true);const cfg=automationSettings(business.program_json?.lifecycle,business);
    const empty={queued:0,awarded:0,points:0,sent:0};
    if(!cfg[`${rule}_enabled`]||!hasPlanFeature(business.plan,'lifecycle_automation',overrides))return {...empty,reason:'inactive'};
    const readiness=readinessForBusiness(business,now);
    if(rule==='winback'&&!readiness.inactivity_allowed)return{...empty,reason:`data_quality_${readiness.reason}`};
    if(DateTime.fromJSDate(now,{zone:regionTimezone(business)}).hour!==cfg.scheduler_hour_local)return{...empty,reason:'outside_scheduled_hour'};
    const points=cfg[`${rule}_points`],cap=cfg[`${rule}_monthly_points_cap`],date=automationLocalDate(now,business),month=automationMonth(now,business);
    if(points>cap)return{...empty,reason:'budget_requires_configuration'};
    const candidates=await client.query(`SELECT c.id,${inactivityAnchorSql} AS inactivity_anchor FROM customers c JOIN customer_marketing_preferences p ON p.business_id=c.business_id AND p.customer_id=c.id AND p.marketing_opt_in=true
      WHERE ${eligibleSql} AND c.phone IS NOT NULL AND c.phone<>''
      AND ${notProcessedSql}
      ORDER BY c.id LIMIT $6 FOR UPDATE OF c`,[businessId,rule,date,cfg.winback_days,regionTimezone(business),Math.max(1,Math.min(Number(limit)||200,200))]);
    if(!candidates.rowCount)return empty;
    await client.query(`INSERT INTO lifecycle_automation_budgets(business_id,rule,month) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[businessId,rule,month]);
    let committed=(await client.query('SELECT points_committed FROM lifecycle_automation_budgets WHERE business_id=$1 AND rule=$2 AND month=$3 FOR UPDATE',[businessId,rule,month])).rows[0].points_committed;
    let queued=0;
    for(const customer of candidates.rows) {
      if(committed+points>cap)break;
      // Recheck after locking the customer, matching preference changes' lock order.
      const pref=await client.query('SELECT marketing_opt_in FROM customer_marketing_preferences WHERE business_id=$1 AND customer_id=$2 FOR SHARE',[businessId,customer.id]);if(!pref.rows[0]?.marketing_opt_in)continue;
      const eventId=crypto.randomUUID();
      const event=await client.query(`INSERT INTO lifecycle_events(id,business_id,customer_id,event_type,event_date,meta) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(business_id,customer_id,event_type,event_date) DO NOTHING RETURNING id`,[eventId,businessId,customer.id,rule,date,{points,managed:true,...(rule==='winback'?{inactivity_anchor:customer.inactivity_anchor}:{})}]);if(!event.rowCount)continue;
      if(points>0) {
        await client.query(`INSERT INTO transactions(id,business_id,customer_id,amount_q,visits,items,points,status,source,meta) VALUES($1,$2,$3,0,0,0,$4,'POSTED','lifecycle',$5)`,[crypto.randomUUID(),businessId,customer.id,points,{event_type:`${rule}_bonus`,lifecycle_event_id:eventId}]);
        const balance=await client.query(`UPDATE customer_balances SET points=points+$2,lifetime_points=lifetime_points+$2,updated_at=$3 WHERE customer_id=$1`,[customer.id,points,now]);
        if(balance.rowCount!==1)throw new Error('Automation customer balance missing');
      }
      await client.query(`INSERT INTO lifecycle_message_outbox(id,business_id,customer_id,event_id,rule,points,next_attempt_at,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7)`,[crypto.randomUUID(),businessId,customer.id,eventId,rule,points,now,new Date(now.getTime()+2*86400000)]);
      committed+=points;queued++;
    }
    await client.query('UPDATE lifecycle_automation_budgets SET points_committed=$4,awards=awards+$5,updated_at=$6 WHERE business_id=$1 AND rule=$2 AND month=$3',[businessId,rule,month,committed,queued,now]);
    return{queued,awarded:points>0?queued:0,points:queued*points,sent:0};
  });
}
export async function runGuidedAutomationsOnce({businessId=null,now=new Date()}={}) {
  const ids=businessId?[businessId]:await withDbClientContext({platformAdmin:true,tenantId:null},async()=>{
    const {rows}=await dbQuery(`SELECT id FROM businesses WHERE program_json->'lifecycle'->>'birthday_enabled'='true' OR program_json->'lifecycle'->>'winback_enabled'='true'`);return rows.map(row=>row.id);
  });
  const results=[];
  for(const bid of ids) {
    for(const rule of AUTOMATION_RULES) {
      try {results.push({business_id:bid,rule,...await withDbClientContext({tenantId:bid,platformAdmin:false},()=>runAutomationRule({businessId:bid,rule,now}))});}
      catch {logger.warn({businessId:bid,rule},'Automation generation did not complete');results.push({business_id:bid,rule,error:'generation_failed'});}
    }
  }
  return results;
}
