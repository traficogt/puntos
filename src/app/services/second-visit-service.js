import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { dbQuery, withTransaction, withDbClientContext } from '../database.js';
import { AuditRepo } from '../repositories/audit-repository.js';
import { PlanConfigService } from './plan-config-service.js';
import { hasPlanFeature } from '../../utils/plan.js';
import { badRequest, forbidden, notFound } from '../../utils/http-error.js';
import { withImpersonationMeta } from '../../utils/impersonation.js';
import { readinessForBusiness } from './merchant-data-readiness.js';
import { businessRegion, regionalLocalDate, assertRegionAmount } from './regional-settings.js';
import { genuinePurchase } from './second-visit-eligibility.js';
import { reportingPurchase } from './reporting-purchase.js';
import { logger } from '../../utils/logger.js';

export const SecondVisitSettings = z.object({enabled:z.boolean(),bonus_points:z.number().int().min(1).max(10000),minimum_purchase_q:z.number().finite().min(0).max(999999.99),duration_days:z.number().int().min(1).max(14),monthly_points_cap:z.number().int().min(0).max(2000000),monthly_offer_cap:z.number().int().min(0).max(5000)}).strict().refine(s=>!s.enabled||(s.monthly_offer_cap>0&&s.monthly_points_cap>=s.bonus_points));
const defaults={enabled:false,bonus_points:50,minimum_purchase_q:0,duration_days:7,monthly_points_cap:0,monthly_offer_cap:0};
export function secondVisitSettings(raw={}) { const parsed=SecondVisitSettings.safeParse(raw);return parsed.success?parsed.data:{...defaults}; }
// SPEND has no fixed purchase unit; preserve its existing bonus-only activation bound.
const minimumUnitPoints=business=>business.program_type==='VISIT'?Math.max(0,Number(business.program_json?.points_per_visit??10)):business.program_type==='ITEM'?Math.max(0,Number(business.program_json?.points_per_item??1)):0;
const entitled=(b,overrides)=>['lifecycle_automation','campaign_rules','analytics'].every(feature=>hasPlanFeature(b.plan,feature,overrides));
const dependencies={query:dbQuery,transaction:withTransaction,audit:AuditRepo.log,getPlanFeatureOverrides:()=>PlanConfigService.getPlanFeatureOverrides(),runInTenant:(id,fn)=>withDbClientContext({tenantId:id,platformAdmin:false},fn)};
async function businessRow(client,businessId,lock=false){const row=(await client.query(`SELECT * FROM businesses WHERE id=$1 ${lock?'FOR NO KEY UPDATE':''}`,[businessId])).rows[0];if(!row)throw notFound('No se encontró el negocio.');return row;}
export async function saveSecondVisitSettings(options,injected={}){
 const {transaction,audit,getPlanFeatureOverrides}={...dependencies,...injected},parsed=SecondVisitSettings.safeParse(options.settings);
 if(!parsed.success)throw badRequest('Revisa la vigencia, el bono y los límites mensuales de la segunda visita.');
 const overrides=await getPlanFeatureOverrides();
 return transaction(async client=>{
  const business=await businessRow(client,options.businessId,true);if(!entitled(business,overrides))throw forbidden('Tu plan no incluye esta automatización.');
  assertRegionAmount(parsed.data.minimum_purchase_q,businessRegion(business).currency,business);
  const guard=Number(business.program_json?.award_guard?.max_points_per_tx??0);
  if(parsed.data.enabled&&guard>0&&parsed.data.bonus_points+minimumUnitPoints(business)>guard)throw badRequest(`El bono y los puntos base mínimos superan el límite total de ${guard} puntos por compra. Ajusta el bono antes de activar.`);
  const old=business.program_json?.second_visit??{}, at=options.now??new Date((await client.query('SELECT clock_timestamp() AS at')).rows[0].at);
  const enabledAt=parsed.data.enabled&&old.settings?.enabled!==true?at.toISOString():old.enabled_at??null;
  const program={...business.program_json,second_visit:{settings:parsed.data,enabled_at:enabledAt},...(parsed.data.enabled?{targeted_offers_enabled:true}:{})};
  await client.query('UPDATE businesses SET program_json=$2 WHERE id=$1',[options.businessId,program]);
  if(!parsed.data.enabled)await client.query(`UPDATE growth_message_outbox o SET status='suppressed',reason='automation_paused',updated_at=clock_timestamp()
    WHERE business_id=$1 AND status IN ('queued','failed') AND EXISTS(SELECT 1 FROM second_visit_enrollments e WHERE e.business_id=o.business_id AND e.campaign_id=o.campaign_id)`,[options.businessId]);
  await audit({id:randomUUID(),business_id:options.businessId,actor_type:'STAFF',actor_id:options.staffId,action:'automation.second_visit.updated',ip:options.ip??null,ua:options.ua??null,meta:withImpersonationMeta(parsed.data,options)});
  return{ok:true,settings:parsed.data};
 });
}
export function recommendSecondVisit(business,rewards=[],costPerPoint=null){
 const type=business.program_type,config=business.program_json??{},key={SPEND:'points_per_q',VISIT:'points_per_visit',ITEM:'points_per_item'}[type];
 const rate=Number(key?config[key]:NaN),reward=rewards.filter(r=>Number(r.points_cost)>0).sort((a,b)=>Number(a.points_cost)-Number(b.points_cost))[0];
 const cost=costPerPoint==null?null:Number(costPerPoint),known=cost!==null&&Number.isFinite(cost)&&cost>=0,guard=Number(config.award_guard?.max_points_per_tx??0);
 const empty={purchase_point_cap:guard>0?guard:null,settings:null,source:null,cost_per_point:known?cost:null,cost_state:known?'configured_estimate':'unknown',estimated_cost:null,maximum_points_commitment:null,missing:[]};
 if(!Number.isFinite(rate)||rate<=0)empty.missing.push('earning_rule');if(!reward)empty.missing.push('active_reward');if(empty.missing.length)return empty;
 const base=type==='VISIT'||type==='ITEM'?rate:1;
 const bonus=Math.min(10000,Math.max(1,Math.floor(Number(reward.points_cost)*0.1)),guard>0?Math.max(0,Math.floor(guard-base)):10000);
 if(bonus<1)return{...empty,missing:['purchase_guard']};
 const maximum=bonus*20;
 return{purchase_point_cap:guard>0?guard:null,settings:{enabled:false,bonus_points:bonus,minimum_purchase_q:null,duration_days:7,monthly_points_cap:maximum,monthly_offer_cap:20},source:{reward_id:reward.id,reward_name:reward.name,reward_points:Number(reward.points_cost),program_type:type,earning_rate:rate,award_guard:guard>0?guard:null},missing:['minimum_purchase'],cost_per_point:known?cost:null,cost_state:known?'configured_estimate':'unknown',maximum_points_commitment:maximum,estimated_cost:known?Math.round(maximum*cost*100)/100:null};
}
export async function getSecondVisitControls({businessId,now=new Date()},injected={}){
 const {query,getPlanFeatureOverrides}={...dependencies,...injected},business=await businessRow({query},businessId),settings=secondVisitSettings(business.program_json?.second_visit?.settings);
 if(!entitled(business,await getPlanFeatureOverrides()))throw forbidden('Tu plan no incluye esta automatización.');
 const month=`${regionalLocalDate(now,business).slice(0,7)}-01`;
 const budget=(await query('SELECT points_committed,offers_created FROM second_visit_budgets WHERE business_id=$1 AND month=$2',[businessId,month])).rows[0]??{points_committed:0,offers_created:0};
 const results=(await query(`SELECT count(*)::int AS offers_created,count(*) FILTER(WHERE m.claimed_at IS NOT NULL)::int AS bonuses_claimed,
  count(*) FILTER(WHERE EXISTS(SELECT 1 FROM transactions t WHERE t.business_id=e.business_id AND t.customer_id=e.customer_id AND t.id IS DISTINCT FROM e.first_transaction_id AND t.created_at>=g.starts_at AND t.created_at<g.expires_at AND ${reportingPurchase('t')}))::int AS returned_customers,
  count(*) FILTER(WHERE g.expires_at<=$2)::int AS completed_windows,
  count(*) FILTER(WHERE g.expires_at>$2)::int AS open_windows
  FROM second_visit_enrollments e JOIN growth_campaigns g ON g.business_id=e.business_id AND g.id=e.campaign_id
  LEFT JOIN growth_campaign_members m ON m.business_id=e.business_id AND m.campaign_id=e.campaign_id WHERE e.business_id=$1`,[businessId,now])).rows[0];
 const rewards=(await query('SELECT id,name,points_cost FROM rewards WHERE business_id=$1 AND active=true AND points_cost>0 AND (stock IS NULL OR stock>0) AND (valid_until IS NULL OR valid_until>$2) ORDER BY points_cost,id LIMIT 1',[businessId,now])).rows;
 const economics=(await query('SELECT cost_per_point_q FROM reward_economics_settings WHERE business_id=$1',[businessId])).rows[0];
 return{ok:true,settings,is_configured:!!business.program_json?.second_visit?.settings,recommendation:recommendSecondVisit(business,rewards,economics?.cost_per_point_q??null),month,timezone:businessRegion(business).timezone,currency:businessRegion(business).currency,budget:{...budget,points_remaining:Math.max(0,settings.monthly_points_cap-budget.points_committed),offers_remaining:Math.max(0,settings.monthly_offer_cap-budget.offers_created)},results:{...results,return_rate_pct:results.offers_created?results.returned_customers/results.offers_created*100:null},data_readiness:readinessForBusiness(business,now),note:'Primera compra registrada y contabilizada desde la activación. Los saldos importados no son visitas. El retorno incluye compras registradas pendientes; no demuestra ventas adicionales y las ventanas abiertas aún pueden cambiar.'};
}
export async function runSecondVisitBusiness({businessId,now=new Date(),limit=200},injected={}){
 const {transaction,getPlanFeatureOverrides}={...dependencies,...injected},overrides=await getPlanFeatureOverrides();
 return transaction(async client=>{
  const business=await businessRow(client,businessId,true),cfg=secondVisitSettings(business.program_json?.second_visit?.settings),empty={offers:0,queued:0,points_reserved:0};
  if(!cfg.enabled||!entitled(business,overrides))return{...empty,reason:'inactive'};
  const readiness=readinessForBusiness(business,now);if(!readiness.inactivity_allowed)return{...empty,reason:readiness.reason};
  const enabledAt=business.program_json.second_visit.enabled_at;if(!enabledAt)return{...empty,reason:'activation_date_missing'};
  const guard=Number(business.program_json?.award_guard?.max_points_per_tx??0);if(guard>0&&cfg.bonus_points+minimumUnitPoints(business)>guard)return{...empty,reason:'bonus_exceeds_purchase_guard'};
  const candidates=await client.query(`SELECT c.id,t.id AS first_transaction_id FROM customers c JOIN LATERAL(
    SELECT t.id,t.created_at,t.status FROM transactions t WHERE t.business_id=c.business_id AND t.customer_id=c.id AND ${genuinePurchase('t')} ORDER BY t.created_at,t.id LIMIT 1
   ) t ON t.status='POSTED' AND t.created_at>=$2 AND t.created_at<=$3
   WHERE c.business_id=$1 AND c.deleted_at IS NULL
   AND NOT EXISTS(SELECT 1 FROM second_visit_enrollments e WHERE e.business_id=c.business_id AND e.customer_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM transactions later WHERE later.business_id=c.business_id AND later.customer_id=c.id AND later.id<>t.id AND ${genuinePurchase('later')})
   ORDER BY c.id LIMIT $4 FOR UPDATE OF c`,[businessId,enabledAt,now,Math.max(1,Math.min(200,Number(limit)||200))]);
  if(!candidates.rowCount)return empty;
  const month=`${regionalLocalDate(now,business).slice(0,7)}-01`;
  await client.query('INSERT INTO second_visit_budgets(business_id,month) VALUES($1,$2) ON CONFLICT DO NOTHING',[businessId,month]);
  const budget=(await client.query('SELECT * FROM second_visit_budgets WHERE business_id=$1 AND month=$2 FOR UPDATE',[businessId,month])).rows[0];
  let offers=0,queued=0;
  for(const customer of candidates.rows){
   if(budget.points_committed+(offers+1)*cfg.bonus_points>cfg.monthly_points_cap||budget.offers_created+offers>=cfg.monthly_offer_cap)break;
   // Recheck the ledger after obtaining the customer lock, including receipts
   // that committed while the discovery query was waiting.
   const eligible=(await client.query(`SELECT id,status FROM transactions t WHERE business_id=$1 AND customer_id=$2 AND ${genuinePurchase('t')} ORDER BY created_at,id`,[businessId,customer.id])).rows;
   if(eligible.length!==1||eligible[0].id!==customer.first_transaction_id||eligible[0].status!=='POSTED')continue;
   const campaignId=randomUUID(),expires=new Date(now.getTime()+cfg.duration_days*86400000);
   await client.query(`INSERT INTO growth_campaigns(id,business_id,request_id,name,status,offer_kind,bonus_points,points_budget,minimum_purchase_q,duration_days,holdout_percent,member_count,treatment_count,control_count,starts_at,expires_at,audience_snapshot)
    VALUES($1,$2,$3,'Tu segunda visita','active','second_visit',$4,$4,$5,$6,0,1,1,0,$7,$8,$9)`,[campaignId,businessId,randomUUID(),cfg.bonus_points,cfg.minimum_purchase_q,cfg.duration_days,now,expires,{automation:'second_visit',first_transaction_id:customer.first_transaction_id,generated_at:now.toISOString(),selection:'first_recorded_posted_purchase'}]);
   await client.query("INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation) VALUES($1,$2,$3,$4,'treatment')",[randomUUID(),businessId,campaignId,customer.id]);
   await client.query('INSERT INTO second_visit_enrollments(id,business_id,customer_id,first_transaction_id,campaign_id,budget_month,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),businessId,customer.id,customer.first_transaction_id,campaignId,month,now]);
   const pref=(await client.query('SELECT marketing_opt_in FROM customer_marketing_preferences WHERE business_id=$1 AND customer_id=$2 FOR SHARE',[businessId,customer.id])).rows[0];
   if(pref?.marketing_opt_in){await client.query('INSERT INTO growth_message_outbox(id,business_id,campaign_id,customer_id,next_attempt_at) VALUES($1,$2,$3,$4,$5)',[randomUUID(),businessId,campaignId,customer.id,now]);queued++;}
   offers++;
  }
  await client.query('UPDATE second_visit_budgets SET points_committed=points_committed+$3,offers_created=offers_created+$4,updated_at=$5 WHERE business_id=$1 AND month=$2',[businessId,month,offers*cfg.bonus_points,offers,now]);
  return{offers,queued,points_reserved:offers*cfg.bonus_points};
 });
}
export async function runSecondVisitAutomationsOnce({businessId=null,now=new Date()}={},injected={}){
 const deps={...dependencies,...injected};
 const ids=businessId?[businessId]:await withDbClientContext({platformAdmin:true,tenantId:null},async()=>(await deps.query("SELECT id FROM businesses WHERE program_json->'second_visit'->'settings'->>'enabled'='true'")).rows.map(b=>b.id));
 const results=[];for(const bid of ids)try{results.push({business_id:bid,...await deps.runInTenant(bid,()=>runSecondVisitBusiness({businessId:bid,now},deps))});}catch{logger.warn({businessId:bid,stage:'second_visit'},'Second-visit preparation failed');results.push({business_id:bid,error:'preparation_failed'});}return results;
}
