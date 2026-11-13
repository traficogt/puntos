import {livePromiseMember,fingerprint} from './reward-promise-service.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {dbQuery,withTransaction} from '../database.js';
import {getOperationsHealth} from './merchant-operations-service.js';
import {readinessForBusiness} from './merchant-data-readiness.js';
import {buildDecisions,operatingMode} from './merchant-decisions-model.js';
import {PlanConfigService} from './plan-config-service.js';
import {hasPlanFeature} from '../../utils/plan.js';
import {badRequest,conflict,forbidden,notFound} from '../../utils/http-error.js';
import {withImpersonationMeta} from '../../utils/impersonation.js';
import {getOwnerOutcomeEvidence} from './owner-outcome-service.js';
import {ownerOutcomeFindings} from './owner-outcome-model.js';
const dfl={query:dbQuery,transaction:withTransaction,getOperationsHealth,getOwnerOutcomeEvidence,getPlanFeatureOverrides:()=>PlanConfigService.getPlanFeatureOverrides(),now:()=>new Date()};
export const ReviewDecisionInput=z.object({decision_key:z.string().regex(/^[a-z_-]{1,80}$/),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),version:z.number().int().min(0).max(2147483646),status:z.enum(['reviewed','snoozed','open','dismissed']),assigned_staff_id:z.guid().nullable().optional(),dismiss_reason:z.string().trim().min(3).max(500).optional(),snooze_hours:z.union([z.literal(1),z.literal(4),z.literal(24)]).optional()}).strict().refine(value=>value.status==='snoozed'?value.snooze_hours!==undefined:value.snooze_hours===undefined).refine(value=>value.status==='dismissed'?!!value.dismiss_reason:value.dismiss_reason===undefined);
export const OperatingModeInput=z.object({mode:z.enum(['busy','normal','quiet']),capacity:z.number().int().min(0).max(200).optional(),request_id:z.guid().optional(),minutes:z.union([z.literal(30),z.literal(60),z.literal(120),z.literal(240)]).optional(),version:z.string().regex(/^[a-f0-9]{64}$/)}).strict().refine(value=>value.mode!=='normal'?value.minutes!==undefined:value.minutes===undefined);
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
 const reviews=(await d.query('SELECT r.*,s.name AS assigned_staff_name FROM merchant_decision_reviews r LEFT JOIN staff_users s ON s.business_id=r.business_id AND s.id=r.assigned_staff_id WHERE r.business_id=$1',[businessId])).rows;
 const contactDays=Math.max(7,Math.min(90,Number(business.program_json?.lifecycle?.minimum_contact_days)||7));
 const enabled=hasPlanFeature(business.plan,'analytics',overrides)&&hasPlanFeature(business.plan,'campaign_rules',overrides);
 const collisions=enabled?(await d.query(COLLISIONS,[businessId,now,contactDays])).rows[0]:null;
 const readiness=readinessForBusiness(business,now);
 const outcomes=hasPlanFeature(business.plan,'analytics',overrides)?ownerOutcomeFindings(await d.getOwnerOutcomeEvidence({businessId,business,now,includeReturns:readiness.inactivity_allowed},d.query)):[];
 const decisions=buildDecisions({operations,readiness,cases,collisions:collisions??{},outcomes,reviews,now});
 return{ok:true,generated_at:now.toISOString(),data_readiness:readiness,operating_mode:operatingMode(business,now),decisions,
  staff:(await d.query("SELECT id,name,role FROM staff_users WHERE business_id=$1 AND active AND role IN ('OWNER','MANAGER','CASHIER') ORDER BY name",[businessId])).rows,
  summary:{dismissed:decisions.filter(x=>x.review_state==='dismissed').length,open:decisions.filter(x=>x.review_state==='open').length,snoozed:decisions.filter(x=>x.review_state==='snoozed').length,reviewed:decisions.filter(x=>x.review_state==='reviewed').length},
  collisions:collisions?{...collisions,contact_days:contactDays,limited:collisions.total_active_campaigns>collisions.reviewed_campaigns,note:'Se revisan hasta 20 campañas activas. Compartir participantes no demuestra que sus bonos se puedan combinar. Los límites de contacto siguen aplicándose al enviar.'}:null};
}
async function audit(client,options,action,details){await client.query("INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,ip,ua,meta) VALUES($1,$2,'STAFF',$3,$4,$5,$6,$7)",[randomUUID(),options.businessId,options.staffId,action,options.ip??null,options.ua??null,JSON.stringify(withImpersonationMeta(details,options))]);}
export async function getDelegatedDecisionInbox(options,injected={}){
 const d={...dfl,...injected};
 await d.transaction(client=>livePromiseMember(client,options));
 const inbox=await getDecisionInbox({businessId:options.businessId},d);
 const decisions=inbox.decisions.filter(item=>item.assigned_staff_id===options.staff.id).map(item=>({...item,action:{label:'Registrar seguimiento',href:'#pendientes'}}));
 return {ok:true,decisions,generated_at:inbox.generated_at};
}
export async function getDecisionHistory(options,injected={}){
 const d={...dfl,...injected};return d.transaction(async client=>{
  if(options.staff)await livePromiseMember(client,options,!options.delegated);
  if(options.delegated&&!(await client.query('SELECT 1 FROM merchant_decision_reviews WHERE business_id=$1 AND decision_key=$2 AND assigned_staff_id=$3',[options.businessId,options.decisionKey,options.staff.id])).rowCount)throw forbidden('Este pendiente no te está asignado.');
  const events=(await client.query('SELECT e.*,s.name AS actor_name FROM merchant_decision_events e JOIN staff_users s ON s.business_id=e.business_id AND s.id=e.actor_staff_id WHERE e.business_id=$1 AND e.decision_key=$2 ORDER BY e.version DESC LIMIT 100',[options.businessId,options.decisionKey])).rows;
  return {ok:true,events};
 });
}
export async function reviewDecision(options,injected={}){
 const parsed=ReviewDecisionInput.safeParse(options.input);if(!parsed.success)throw badRequest('Revisa el estado, el motivo y el plazo de este pendiente.');
 const d={...dfl,...injected},input=parsed.data;
 return d.transaction(async client=>{
  if(options.staff)await livePromiseMember(client,options,!options.delegated);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[options.businessId,`decision:${input.decision_key}`]);
  const now=d.now();
  const inbox=await getDecisionInbox({businessId:options.businessId},{...d,query:client.query.bind(client)}),decision=inbox.decisions.find(x=>x.key===input.decision_key);
  if(!decision)throw conflict('Este pendiente ya no aparece. Actualiza la bandeja.');
  if(decision.fingerprint!==input.fingerprint||decision.review_version!==input.version)throw conflict('La evidencia o la revisión cambió. Actualiza antes de continuar.');
  if(options.delegated&&(decision.assigned_staff_id!==options.staff.id||input.assigned_staff_id!==undefined))throw forbidden('Solo puedes revisar los pendientes que te asignó el dueño.');
  const assignee=input.assigned_staff_id===undefined?decision.assigned_staff_id:input.assigned_staff_id;
  if(assignee&&!(await client.query("SELECT id FROM staff_users WHERE business_id=$1 AND id=$2 AND active AND role IN ('OWNER','MANAGER','CASHIER') FOR SHARE",[options.businessId,assignee])).rowCount)throw badRequest('Selecciona una persona activa de este negocio.');
  const until=input.status==='snoozed'?new Date(now.getTime()+input.snooze_hours*3600000):null,reason=input.dismiss_reason??null;
  const values=[options.businessId,input.decision_key,input.fingerprint,input.status,until,options.staffId,now,assignee,reason];
  const result=input.version===0?await client.query(`INSERT INTO merchant_decision_reviews(business_id,decision_key,evidence_fingerprint,status,snoozed_until,updated_by_staff_id,updated_at,assigned_staff_id,dismiss_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING version`,values):await client.query(`UPDATE merchant_decision_reviews SET evidence_fingerprint=$3,status=$4,snoozed_until=$5,updated_by_staff_id=$6,updated_at=$7,assigned_staff_id=$8,dismiss_reason=$9,version=version+1 WHERE business_id=$1 AND decision_key=$2 AND version=$10 RETURNING version`,[...values,input.version]);
  if(!result.rowCount)throw conflict('Otra sesión revisó este pendiente. Actualiza la bandeja.');
  const version=result.rows[0].version;
  await client.query('INSERT INTO merchant_decision_events(id,business_id,decision_key,version,actor_staff_id,evidence_fingerprint,status,assigned_staff_id,dismiss_reason,snoozed_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),options.businessId,input.decision_key,version,options.staffId,input.fingerprint,input.status,assignee,reason,until]);
  await audit(client,options,'merchant.decision.reviewed',{decision_key:input.decision_key,fingerprint:input.fingerprint,status:input.status,assigned_staff_id:assignee,dismiss_reason:reason,snoozed_until:until,version});
  return{ok:true,version};
 });
}
export async function setOperatingMode(options,injected={}){
 const parsed=OperatingModeInput.safeParse(options.input);if(!parsed.success)throw badRequest('Elige una pausa de 30 minutos a 4 horas.');
 const d={...dfl,...injected},input=parsed.data,now=d.now();
 return d.transaction(async client=>{
  const business=(await client.query('SELECT id,program_json FROM businesses WHERE id=$1 FOR NO KEY UPDATE',[options.businessId])).rows[0];if(!business)throw notFound('Negocio no encontrado.');
  if(options.staff)await livePromiseMember(client,options,!options.delegated);
  const requestId=input.request_id??randomUUID(),hash=fingerprint([options.staffId,input]);
  const previous=(await client.query('SELECT * FROM operating_mode_changes WHERE business_id=$1 AND request_id=$2',[options.businessId,requestId])).rows[0];
  if(previous){if(previous.payload_fingerprint!==hash)throw conflict('La referencia ya tiene otros términos.');return {...previous.result,replay:true};}
  if(options.delegated&&input.capacity!==undefined)throw forbidden('Solo el dueño puede cambiar la capacidad.');
  if(operatingMode(business,now).version!==input.version)throw conflict('El estado cambió en otra sesión. Actualiza antes de guardar.');
  if(options.delegated){if(!input.request_id)throw badRequest('La acción necesita una referencia.');const {consumeStaffAuthority}=await import('./staff-delegation-service.js');await consumeStaffAuthority(client,{merchantId:options.businessId,staffId:options.staff.id,action:'operating_mode',staff:options.staff,locationId:null,points:0,costAmount:0,referenceType:'operating_mode',referenceId:input.request_id});}
  const value={mode:input.mode,until:input.mode!=='normal'?new Date(now.getTime()+input.minutes*60000).toISOString():null,capacity:input.capacity??operatingMode(business,now).capacity};
  const next=(await client.query("UPDATE businesses SET program_json=COALESCE(program_json,'{}'::jsonb)||jsonb_build_object('merchant_operating_mode',$2::jsonb) WHERE id=$1 RETURNING program_json",[options.businessId,JSON.stringify(value)])).rows[0];
  await audit(client,options,'merchant.operating_mode.changed',value);
  const result={ok:true,operating_mode:operatingMode(next,now)};
  await client.query('INSERT INTO operating_mode_changes(id,business_id,request_id,staff_id,payload_fingerprint,result) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),options.businessId,requestId,options.staffId,hash,result]);
  return {...result,replay:false};
 });
}
