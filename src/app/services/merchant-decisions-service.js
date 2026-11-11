import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {dbQuery,withTransaction} from '../database.js';
import {getOperationsHealth} from './merchant-operations-service.js';
import {readinessForBusiness} from './merchant-data-readiness.js';
import {buildDecisions,operatingMode} from './merchant-decisions-model.js';
import {PlanConfigService} from './plan-config-service.js';
import {hasPlanFeature} from '../../utils/plan.js';
import {badRequest,conflict,notFound} from '../../utils/http-error.js';
import {withImpersonationMeta} from '../../utils/impersonation.js';
import {getOwnerOutcomeEvidence} from './owner-outcome-service.js';
import {ownerOutcomeFindings} from './owner-outcome-model.js';
const dfl={query:dbQuery,transaction:withTransaction,getOperationsHealth,getOwnerOutcomeEvidence,getPlanFeatureOverrides:()=>PlanConfigService.getPlanFeatureOverrides(),now:()=>new Date()};
export const ReviewDecisionInput=z.object({decision_key:z.string().regex(/^[a-z_-]{1,80}$/),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),version:z.number().int().min(0).max(2147483646),status:z.enum(['reviewed','snoozed','open']),snooze_hours:z.union([z.literal(1),z.literal(4),z.literal(24)]).optional()}).strict().refine(value=>value.status==='snoozed'?value.snooze_hours!==undefined:value.snooze_hours===undefined);
export const OperatingModeInput=z.object({mode:z.enum(['busy','normal']),minutes:z.union([z.literal(30),z.literal(60),z.literal(120),z.literal(240)]).optional(),version:z.string().regex(/^[a-f0-9]{64}$/)}).strict().refine(value=>value.mode==='busy'?value.minutes!==undefined:value.minutes===undefined);
const COLLISIONS=`WITH active AS (
 SELECT id,name,bonus_points FROM growth_campaigns WHERE business_id=$1 AND status='active' AND starts_at<=$2 AND expires_at>$2 ORDER BY expires_at,id LIMIT 20
), eligible AS (
 SELECT m.campaign_id,m.customer_id FROM growth_campaign_members m JOIN active a ON a.id=m.campaign_id
 JOIN customers c ON c.id=m.customer_id AND c.business_id=$1 AND c.deleted_at IS NULL
 WHERE m.business_id=$1 AND m.allocation='treatment' AND m.claimed_at IS NULL
), pairs AS (
 SELECT a.campaign_id AS first_id,b.campaign_id AS second_id,count(*)::int AS shared_customers
 FROM eligible a JOIN eligible b ON a.customer_id=b.customer_id AND a.campaign_id<b.campaign_id GROUP BY a.campaign_id,b.campaign_id
), contact AS (
 SELECT customer_id FROM growth_message_outbox WHERE business_id=$1 AND status IN ('processing','accepted','uncertain') AND last_attempt_at>$2::timestamptz-($3::int*interval '1 day')
 UNION SELECT customer_id FROM lifecycle_message_outbox WHERE business_id=$1 AND status IN ('processing','accepted','uncertain') AND last_attempt_at>$2::timestamptz-($3::int*interval '1 day')
)
SELECT (SELECT count(*)::int FROM pairs) AS overlapping_pairs,
 (SELECT count(DISTINCT e.customer_id)::int FROM eligible e JOIN contact c ON c.customer_id=e.customer_id) AS recently_contacted,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('first_name',a.name,'second_name',b.name,'shared_customers',p.shared_customers) ORDER BY p.shared_customers DESC,p.first_id,p.second_id) FROM pairs p JOIN active a ON a.id=p.first_id JOIN active b ON b.id=p.second_id),'[]'::jsonb) AS pairs,
 (SELECT count(*)::int FROM active) AS reviewed_campaigns,
 (SELECT count(*)::int FROM growth_campaigns WHERE business_id=$1 AND status='active' AND starts_at<=$2 AND expires_at>$2) AS total_active_campaigns`;
export async function getDecisionInbox({businessId},injected={}){
 const d={...dfl,...injected},now=d.now();
 const business=(await d.query('SELECT id,plan,program_json FROM businesses WHERE id=$1',[businessId])).rows[0];if(!business)throw notFound('Negocio no encontrado.');
 const overrides=await d.getPlanFeatureOverrides();
 const operations=await d.getOperationsHealth({businessId,now});
 const cases=(await d.query("SELECT count(*)::int AS open,min(created_at) AS oldest_at,max(updated_at) AS last_changed_at FROM service_cases WHERE business_id=$1 AND status='open'",[businessId])).rows[0];
 const reviews=(await d.query('SELECT decision_key,evidence_fingerprint,status,snoozed_until,version FROM merchant_decision_reviews WHERE business_id=$1',[businessId])).rows;
 const contactDays=Math.max(7,Math.min(90,Number(business.program_json?.lifecycle?.minimum_contact_days)||7));
 const enabled=hasPlanFeature(business.plan,'analytics',overrides)&&hasPlanFeature(business.plan,'campaign_rules',overrides);
 const collisions=enabled?(await d.query(COLLISIONS,[businessId,now,contactDays])).rows[0]:null;
 const readiness=readinessForBusiness(business,now);
 const outcomes=hasPlanFeature(business.plan,'analytics',overrides)?ownerOutcomeFindings(await d.getOwnerOutcomeEvidence({businessId,business,now,includeReturns:readiness.inactivity_allowed},d.query)):[];
 const decisions=buildDecisions({operations,readiness,cases,collisions:collisions??{},outcomes,reviews,now});
 return{ok:true,generated_at:now.toISOString(),data_readiness:readiness,operating_mode:operatingMode(business,now),decisions,
  summary:{open:decisions.filter(x=>x.review_state==='open').length,snoozed:decisions.filter(x=>x.review_state==='snoozed').length,reviewed:decisions.filter(x=>x.review_state==='reviewed').length},
  collisions:collisions?{...collisions,contact_days:contactDays,limited:collisions.total_active_campaigns>collisions.reviewed_campaigns,note:'Se revisan hasta 20 campañas activas. Compartir participantes no demuestra que sus bonos se puedan combinar. Los límites de contacto siguen aplicándose al enviar.'}:null};
}
async function audit(client,options,action,details){await client.query("INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,ip,ua,meta) VALUES($1,$2,'STAFF',$3,$4,$5,$6,$7)",[randomUUID(),options.businessId,options.staffId,action,options.ip??null,options.ua??null,JSON.stringify(withImpersonationMeta(details,options))]);}
export async function reviewDecision(options,injected={}){
 const parsed=ReviewDecisionInput.safeParse(options.input);if(!parsed.success)throw badRequest('Revisa el estado y el plazo de este pendiente.');
 const d={...dfl,...injected},input=parsed.data,now=d.now();
 const inbox=await getDecisionInbox({businessId:options.businessId},d),decision=inbox.decisions.find(x=>x.key===input.decision_key);
 if(!decision)throw conflict('Este pendiente ya no aparece. Actualiza la bandeja.');
 if(decision.fingerprint!==input.fingerprint)throw conflict('La evidencia cambió. Revisa el pendiente antes de continuar.');
 return d.transaction(async client=>{
  const until=input.status==='snoozed'?new Date(now.getTime()+input.snooze_hours*3600000):null;
  const values=[options.businessId,input.decision_key,input.fingerprint,input.status,until,options.staffId,now];
  const result=input.version===0?await client.query(`INSERT INTO merchant_decision_reviews(business_id,decision_key,evidence_fingerprint,status,snoozed_until,updated_by_staff_id,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING version`,values):await client.query(`UPDATE merchant_decision_reviews SET evidence_fingerprint=$3,status=$4,snoozed_until=$5,updated_by_staff_id=$6,updated_at=$7,version=version+1 WHERE business_id=$1 AND decision_key=$2 AND version=$8 RETURNING version`,[...values,input.version]);
  if(!result.rowCount)throw conflict('Otra sesión revisó este pendiente. Actualiza la bandeja.');
  await audit(client,options,'merchant.decision.reviewed',{decision_key:input.decision_key,fingerprint:input.fingerprint,status:input.status,snoozed_until:until,version:result.rows[0].version});
  return{ok:true,version:result.rows[0].version};
 });
}
export async function setOperatingMode(options,injected={}){
 const parsed=OperatingModeInput.safeParse(options.input);if(!parsed.success)throw badRequest('Elige una pausa de 30 minutos a 4 horas.');
 const d={...dfl,...injected},input=parsed.data,now=d.now();
 return d.transaction(async client=>{
  const business=(await client.query('SELECT id,program_json FROM businesses WHERE id=$1 FOR NO KEY UPDATE',[options.businessId])).rows[0];if(!business)throw notFound('Negocio no encontrado.');
  if(operatingMode(business,now).version!==input.version)throw conflict('El estado cambió en otra sesión. Actualiza antes de guardar.');
  const value={mode:input.mode,until:input.mode==='busy'?new Date(now.getTime()+input.minutes*60000).toISOString():null};
  const next=(await client.query("UPDATE businesses SET program_json=COALESCE(program_json,'{}'::jsonb)||jsonb_build_object('merchant_operating_mode',$2::jsonb) WHERE id=$1 RETURNING program_json",[options.businessId,JSON.stringify(value)])).rows[0];
  await audit(client,options,'merchant.operating_mode.changed',value);
  return{ok:true,operating_mode:operatingMode(next,now)};
 });
}
