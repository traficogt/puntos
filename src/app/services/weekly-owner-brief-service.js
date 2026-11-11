import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {ownerBriefEmailReady,sendOwnerBriefEmail} from './owner-brief-email-service.js';
import {DateTime} from 'luxon';
import {z} from 'zod';
import {dbQuery,withTransaction,withDbClientContext,getDbClient} from '../database.js';
import {AuditRepo} from '../repositories/audit-repository.js';
import {PlanConfigService} from './plan-config-service.js';
import {sendMessage,marketingProviderReady} from './messaging-service.js';
import {classifyCampaignSend} from './campaign-message-service.js';
import {businessRegion} from './regional-settings.js';
import {readinessForBusiness} from './merchant-data-readiness.js';
import {reportingPurchase} from './reporting-purchase.js';
import {getOwnerOutcomeEvidence} from './owner-outcome-service.js';
import {ownerOutcomeFindings,selectWeeklyFindings} from './owner-outcome-model.js';
import {hasPlanFeature} from '../../utils/plan.js';
import {badRequest,conflict,forbidden,notFound} from '../../utils/http-error.js';
import {withImpersonationMeta} from '../../utils/impersonation.js';
import {config} from '../../config/index.js';
import {logger} from '../../utils/logger.js';

export const WeeklyBriefSettings=z.object({enabled:z.boolean(),weekday:z.number().int().min(1).max(7),hour:z.number().int().min(9).max(17),channel:z.enum(['email','phone']).optional()}).strict();
const defaults={enabled:false,weekday:1,hour:9};
const depsDefault={getOwnerOutcomeEvidence,query:dbQuery,transaction:withTransaction,audit:AuditRepo.log,getPlanFeatureOverrides:()=>PlanConfigService.getPlanFeatureOverrides(),providerReady:marketingProviderReady,emailProviderReady:ownerBriefEmailReady,sendEmail:sendOwnerBriefEmail,runInTenant:(id,fn)=>withDbClientContext({tenantId:id,platformAdmin:false},fn)};
const phone=value=>/^\+?[0-9 () .-]+$/.test(String(value??''))&&/^[0-9]{8,15}$/.test(String(value??'').replace(/\D/g,''))?String(value).replace(/\D/g,''):null;
export const weeklyBriefChannel=b=>b.program_json?.weekly_owner_brief?.channel??(b.program_json?.weekly_owner_brief?.owner_id?'phone':'email');
const email=value=>{const parsed=z.string().trim().toLowerCase().email().max(254).safeParse(value);return parsed.success?parsed.data:null;};
const verifiedEmail=owner=>owner?.email_verified_at&&email(owner.email)===owner.verified_email?owner.verified_email:null;
const destinationFor=(owner,channel)=>channel==='email'?verifiedEmail(owner):phone(owner?.phone);
const entitled=(b,o)=>hasPlanFeature(b.plan,'analytics',o)&&hasPlanFeature(b.plan,'lifecycle_automation',o);
const settingsFor=b=>WeeklyBriefSettings.safeParse(b.program_json?.weekly_owner_brief?.settings).success?b.program_json.weekly_owner_brief.settings:{...defaults};
async function ownerAndBusiness(client,businessId,staffId,lock=false){
 const business=(await client.query(`SELECT * FROM businesses WHERE id=$1 ${lock?'FOR NO KEY UPDATE':''}`,[businessId])).rows[0];if(!business)throw notFound('No se encontró el negocio.');
 const owner=(await client.query(`SELECT id,phone,email,verified_email,email_verified_at,role,active FROM staff_users WHERE business_id=$1 AND id=$2 ${lock?'FOR SHARE':''}`,[businessId,staffId])).rows[0];
 if(!owner||owner.role!=='OWNER'||!owner.active)throw forbidden('El resumen se configura desde una cuenta de propietario activa.');return{business,owner};
}
export function weeklyBriefPeriod(now,business,settings){
 const local=DateTime.fromJSDate(new Date(now),{zone:businessRegion(business).timezone}),start=local.startOf('week'),scheduled=start.plus({days:settings.weekday-1}).set({hour:settings.hour});
 return{period_start:start.toISODate(),scheduled_at:scheduled.toUTC().toISO(),expires_at:start.plus({weeks:1}).toUTC().toISO(),due:settings.enabled===true&&local>=scheduled};
}
export async function saveWeeklyBriefSettings(options,injected={}){
 const deps={...depsDefault,...injected},parsed=WeeklyBriefSettings.safeParse(options.settings);if(!parsed.success)throw badRequest('Revisa el día y la hora del resumen semanal. El destinatario es tu cuenta de propietario.');
 const overrides=await deps.getPlanFeatureOverrides();
 return deps.transaction(async client=>{
  const {business,owner}=await ownerAndBusiness(client,options.businessId,options.staffId,true);if(!entitled(business,overrides))throw forbidden('Tu plan no incluye el resumen semanal.');
  const channel=parsed.data.channel??weeklyBriefChannel(business);
  if(channel==='phone'&&weeklyBriefChannel(business)!=='phone')throw badRequest('Las nuevas suscripciones usan el correo verificado de tu cuenta.');
  const destination=destinationFor(owner,channel);if(parsed.data.enabled&&!destination)throw badRequest(channel==='email'?'Verifica el correo de tu cuenta antes de activar el resumen.':'Configura un teléfono internacional válido en tu cuenta antes de activar el resumen.');
  const saved={settings:parsed.data,channel,owner_id:owner.id,destination,enabled_at:(options.now??new Date()).toISOString()};
  await client.query('UPDATE businesses SET program_json=jsonb_set(COALESCE(program_json,\'{}\'::jsonb),\'{weekly_owner_brief}\',$2,true) WHERE id=$1',[options.businessId,saved]);
  await client.query(`UPDATE weekly_owner_briefs SET status='suppressed',reason='settings_changed',updated_at=clock_timestamp()
   WHERE business_id=$1 AND kind='weekly' AND status IN ('queued','failed') AND ($2=false OR owner_id IS DISTINCT FROM $3::uuid OR destination IS DISTINCT FROM $4)`,[options.businessId,parsed.data.enabled,owner.id,destination]);
  await deps.audit({id:randomUUID(),business_id:options.businessId,actor_type:'STAFF',actor_id:owner.id,action:'owner_brief.settings.updated',ip:options.ip??null,ua:options.ua??null,meta:withImpersonationMeta(parsed.data,options)});
  return{ok:true,settings:parsed.data};
 });
}
async function buildBrief(client,business,now,deps){
 const since=new Date(now.getTime()-7*86400000),businessId=business.id;
 // Weekly activity is read in one statement; each outcome carries its own window.
 const values=(await client.query(`SELECT
  (SELECT count(*)::int FROM transactions t WHERE t.business_id=$1 AND t.created_at>=$2 AND t.created_at<$3 AND ${reportingPurchase('t')} AND t.status IN ('POSTED','EXPIRED')) AS posted_purchases,
  (SELECT count(*)::int FROM transactions t WHERE t.business_id=$1 AND t.created_at>=$2 AND t.created_at<$3 AND ${reportingPurchase('t')} AND t.status='PENDING') AS pending_purchases,
  (SELECT count(*)::int FROM second_visit_enrollments WHERE business_id=$1 AND created_at>=$2 AND created_at<$3) AS second_visit_offers,
  (SELECT count(*)::int FROM second_visit_enrollments e JOIN growth_campaign_members m ON m.business_id=e.business_id AND m.campaign_id=e.campaign_id WHERE e.business_id=$1 AND e.created_at>=$2 AND e.created_at<$3 AND m.claimed_at IS NOT NULL) AS second_visit_claims,
  (SELECT count(*)::int FROM growth_message_outbox WHERE business_id=$1 AND created_at>=$2 AND created_at<$3 AND status IN ('failed','uncertain'))+
   (SELECT count(*)::int FROM lifecycle_message_outbox WHERE business_id=$1 AND created_at>=$2 AND created_at<$3 AND status IN ('failed','uncertain')) AS messages_needing_review`,[businessId,since,now])).rows[0];
 const readiness=readinessForBusiness(business,now),href=fragment=>new URL(`/negocio/#${fragment}`,config.APP_ORIGIN).toString();
 const outcomes=await deps.getOwnerOutcomeEvidence({businessId,business,now,includeReturns:readiness.inactivity_allowed},client.query.bind(client));
 /** @type {Array<{key:string,priority:number,title:string,text:string,evidence:object,action:string,href:string,observed_at?:string,period?:object,fallback?:boolean}>} */
 const candidates=ownerOutcomeFindings(outcomes).map(item=>({key:item.key,priority:item.priority,title:item.title,text:item.explanation,evidence:item.evidence,observed_at:item.observed_at,period:item.period,action:item.action.label,href:new URL(`/negocio/${item.action.href}`,config.APP_ORIGIN).toString()}));
 if(!readiness.inactivity_allowed)candidates.push({key:'data_quality',priority:1,title:'Completa los datos antes de invitar por inactividad',text:readiness.summary,evidence:{state:readiness.state,reason:readiness.reason,last_completed_at:readiness.last_completed_at},action:'Revisar conexión de caja',href:href('conectar-caja')});
 if(values.messages_needing_review)candidates.push({key:'delivery_quality',priority:10,title:'Revisa los mensajes sin confirmación',text:`${values.messages_needing_review} mensajes fallidos o sin confirmación en los últimos 7 días. Los envíos inciertos no se reintentan automáticamente.`,evidence:{messages_needing_review:values.messages_needing_review,since:since.toISOString(),until:now.toISOString()},action:'Revisar ofertas y presupuestos',href:href('ofertas')});
 candidates.push(
  {key:'recorded_activity',priority:90,fallback:true,title:values.posted_purchases?'Revisa la actividad registrada':'Comprueba la cobertura de tus ventas',text:`${values.posted_purchases} compras con puntos contabilizados o vencidos y ${values.pending_purchases} compras con puntos pendientes en los últimos 7 días. Son registros de PF; no acreditan todas las ventas del negocio.`,evidence:{posted_purchases:values.posted_purchases,pending_purchases:values.pending_purchases,since:since.toISOString(),until:now.toISOString()},action:'Revisar movimientos',href:href('movimientos')},
  {key:'second_visit',priority:60,fallback:true,title:values.second_visit_offers?'Observa las invitaciones a una segunda visita':'Prepara una razón para la segunda visita',text:values.second_visit_offers?`${values.second_visit_claims} bonos usados entre ${values.second_visit_offers} ofertas creadas en los últimos 7 días. Algunas ventanas siguen abiertas; no es una medida de ventas adicionales.`:'No se crearon ofertas de segunda visita en los últimos 7 días. Revisa sus términos y límites antes de activarla.',evidence:{offers:values.second_visit_offers,claimed:values.second_visit_claims,denominator:'offers_created_in_last_7_days'},action:'Revisar automatizaciones',href:href('automatizaciones')},
  {key:'budget_review',priority:100,fallback:true,title:'Comprueba tus próximos compromisos',text:'Revisa los compromisos y costos conocidos antes de preparar la siguiente oferta. Los costos sin registrar no equivalen a cero.',evidence:{data_state:readiness.state},action:'Revisar costos',href:href('costos')}
 );
 const selected=selectWeeklyFindings(candidates);
 return{business_name:business.name,generated_at:now.toISOString(),period:{since:since.toISOString(),until:now.toISOString()},timezone:businessRegion(business).timezone,...selected,inbox_href:href('decisiones'),note:'Cada hallazgo indica su propio período. Los enlaces requieren iniciar sesión como propietario. Preparar una muestra no envía mensajes.'};
}
export async function previewWeeklyOwnerBrief({businessId,staffId,now=new Date()},injected={}){
 const deps={...depsDefault,...injected},{business}=await ownerAndBusiness({query:deps.query},businessId,staffId);if(!entitled(business,await deps.getPlanFeatureOverrides()))throw forbidden('Tu plan no incluye el resumen semanal.');
 return buildBrief({query:deps.query},business,now,deps);
}
export async function getWeeklyBriefControls({businessId,staffId,now=new Date()},injected={}){
 const deps={...depsDefault,...injected},{business,owner}=await ownerAndBusiness({query:deps.query},businessId,staffId);if(!entitled(business,await deps.getPlanFeatureOverrides()))throw forbidden('Tu plan no incluye el resumen semanal.');
 const settings=settingsFor(business),stored=business.program_json?.weekly_owner_brief,channel=weeklyBriefChannel(business),destination=destinationFor(owner,channel);
 const verification=(await deps.query('SELECT id,status,expires_at,attempts FROM owner_brief_email_verifications WHERE business_id=$1 AND owner_id=$2 AND consumed_at IS NULL AND expires_at>$3 ORDER BY created_at DESC,id DESC LIMIT 1',[businessId,staffId,now])).rows[0]??null;
 const history=(await deps.query('SELECT id,period_start,kind,channel,status,attempts,reason,created_at,accepted_at FROM weekly_owner_briefs WHERE business_id=$1 ORDER BY created_at DESC LIMIT 20',[businessId])).rows;
 return{ok:true,settings:{...settings,channel},channel,verification,timezone:businessRegion(business).timezone,destination:channel==='email'?email(owner.email):destination?`•••• ${destination.slice(-4)}`:null,destination_ready:!!destination,email_destination:email(owner.email),email_verified:!!verifiedEmail(owner),email_provider_ready:deps.emailProviderReady(),recipient_is_current_owner:!stored?.owner_id||stored.owner_id===owner.id,subscription_binding_current:!stored?.owner_id||(stored.owner_id===owner.id&&stored.destination===destination&&!!destination),provider_ready:channel==='email'?deps.emailProviderReady():deps.providerReady(),schedule:weeklyBriefPeriod(now,business,settings),history};
}
async function queueBrief(businessId,now,deps){
 const overrides=await deps.getPlanFeatureOverrides();
 return deps.transaction(async client=>{
  const business=(await client.query('SELECT * FROM businesses WHERE id=$1 FOR NO KEY UPDATE',[businessId])).rows[0];if(!business)return;
  const settings=settingsFor(business),stored=business.program_json?.weekly_owner_brief,channel=weeklyBriefChannel(business);
  if(!settings.enabled||!entitled(business,overrides)||!stored?.owner_id||!stored.destination)return;
  const period=weeklyBriefPeriod(now,business,settings);if(!period.due||!stored.enabled_at||Date.parse(period.scheduled_at)<Date.parse(stored.enabled_at))return;
  if((await client.query("SELECT id FROM weekly_owner_briefs WHERE business_id=$1 AND period_start=$2 AND kind='weekly'",[businessId,period.period_start])).rowCount)return;
  const owner=(await client.query('SELECT role,active,phone,email,verified_email,email_verified_at FROM staff_users WHERE business_id=$1 AND id=$2 FOR SHARE',[businessId,stored.owner_id])).rows[0];
  if(owner?.role!=='OWNER'||!owner.active||destinationFor(owner,channel)!==stored.destination)return;
  const snapshot=await buildBrief(client,business,now,deps);
  await client.query('INSERT INTO weekly_owner_briefs(id,business_id,owner_id,destination,period_start,snapshot,next_attempt_at,expires_at,created_at,channel) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7,$9) ON CONFLICT DO NOTHING',[randomUUID(),businessId,stored.owner_id,stored.destination,period.period_start,snapshot,now,period.expires_at,channel]);
 });
}
async function claimBrief(businessId,now,deps){
 return deps.transaction(async client=>{
  await client.query("UPDATE weekly_owner_briefs SET status='uncertain',reason='processing_lease_expired',claim_token=NULL,lease_until=NULL,updated_at=$2 WHERE business_id=$1 AND status='processing' AND lease_until<=$2",[businessId,now]);
  await client.query("UPDATE weekly_owner_briefs SET status='suppressed',reason='expired',updated_at=$2 WHERE business_id=$1 AND status IN ('queued','failed') AND expires_at<=$2",[businessId,now]);
  if(!deps.providerReady()&&!deps.emailProviderReady())return null;
  const row=(await client.query("SELECT * FROM weekly_owner_briefs WHERE business_id=$1 AND status IN ('queued','failed') AND attempts<3 AND ((channel='phone' AND $3) OR (channel='email' AND $4)) AND next_attempt_at<=$2 AND expires_at>$2 ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",[businessId,now,deps.providerReady(),deps.emailProviderReady()])).rows[0];if(!row)return null;
  const token=randomUUID();await client.query("UPDATE weekly_owner_briefs SET status='processing',attempts=attempts+1,claim_token=$2,lease_until=$3,updated_at=$4 WHERE id=$1",[row.id,token,new Date(now.getTime()+10*60000),now]);
  return{...row,claim_token:token,attempts:row.attempts+1};
 });
}
function bodyFor(snapshot){
 const format=value=>new Intl.DateTimeFormat('es-GT',{dateStyle:'medium',timeStyle:'short',timeZone:snapshot.timezone||'America/Guatemala'}).format(new Date(value));
 const date=snapshot.inbox_href&&snapshot.generated_at?`\nPreparado: ${format(snapshot.generated_at)} · ${snapshot.timezone||'America/Guatemala'}`:'';
 const findings=snapshot.findings.map((f,i)=>{
  const period=f.period?.start&&f.period?.end?`\nPeríodo: ${format(f.period.start)} al ${format(f.period.end)} · Todas las sucursales.`:'';
  return `${i+1}. ${f.title}\n${f.text}${period}\n${f.action}: ${f.href}`;
 }).join('\n\n');
 const more=snapshot.additional_count>0?`\n\nHay ${snapshot.additional_count} ${snapshot.additional_count===1?'observación adicional':'observaciones adicionales'}. Revisa la bandeja de decisiones: ${snapshot.inbox_href}`:'';
 return `${snapshot.business_name}: tu resumen semanal de PuntosFieles${date}\n\n${findings}${more}\n\nLos enlaces requieren iniciar sesión. Puedes pausar este resumen en Automatizaciones.`;
}
async function dispatchTransaction(fn){
 // Keep the transaction pool free for provider entitlement/billing reads.
 const client=getDbClient();await client.query('BEGIN');try{const result=await fn(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}
}
export async function processWeeklyOwnerBriefsOnce({businessId=null,now=()=>new Date(),send=sendMessage}={},injected={}){
 const deps={...depsDefault,...injected},dispatch=injected.transaction??dispatchTransaction;
 const ids=businessId?[businessId]:await withDbClientContext({platformAdmin:true,tenantId:null},async()=>(await deps.query("SELECT id FROM businesses WHERE program_json->'weekly_owner_brief'->'settings'->>'enabled'='true' OR EXISTS(SELECT 1 FROM weekly_owner_briefs w WHERE w.business_id=businesses.id AND w.status IN ('queued','failed','processing'))")).rows.map(row=>row.id));
 const counts={accepted:0,failed:0,uncertain:0,suppressed:0};
 for(const bid of ids)try{await deps.runInTenant(bid,async()=>{
  await queueBrief(bid,now(),deps);const item=await claimBrief(bid,now(),deps);if(!item)return;
  const overrides=await deps.getPlanFeatureOverrides();let result;
  try{result=await dispatch(async client=>{
   const business=(await client.query('SELECT * FROM businesses WHERE id=$1 FOR SHARE',[bid])).rows[0];
   const owner=(await client.query('SELECT role,active,phone,email,verified_email,email_verified_at FROM staff_users WHERE business_id=$1 AND id=$2 FOR SHARE',[bid,item.owner_id])).rows[0];
   const current=(await client.query('SELECT status,claim_token FROM weekly_owner_briefs WHERE business_id=$1 AND id=$2 FOR UPDATE',[bid,item.id])).rows[0];
   const stored=business?.program_json?.weekly_owner_brief;
   const subscriptionValid=item.kind==='test'||(settingsFor(business??{}).enabled&&stored?.owner_id===item.owner_id&&stored?.destination===item.destination&&weeklyBriefChannel(business)===item.channel);
   if(!business||!subscriptionValid||!entitled(business,overrides)||owner?.role!=='OWNER'||!owner.active||destinationFor(owner,item.channel)!==item.destination||new Date(item.expires_at)<=now()||current?.status!=='processing'||current.claim_token!==item.claim_token)return{ok:false,suppressed:true};
   if(item.channel==='email')return deps.sendEmail({to:item.destination,body:bodyFor(item.snapshot),subject:item.kind==='test'?'PuntosFieles · Prueba solicitada de tu resumen':'PuntosFieles · Tu resumen semanal'});
   return send({businessId:bid,customerId:null,channel:'alerts',to:item.destination,destinations:{phone:item.destination,email:null},body:bodyFor(item.snapshot)});
  });}catch{result={ok:false,error:'DELIVERY_UNCERTAIN'};}
  const status=classifyCampaignSend(result),stamp=now(),reason=status==='uncertain'?'delivery_uncertain':status==='failed'?'provider_rejected':status==='suppressed'?'settings_or_destination_changed':null;
  await deps.query(`UPDATE weekly_owner_briefs SET status=$3,reason=$4,provider=$5,provider_reference=$6,claim_token=NULL,lease_until=NULL,
   accepted_at=CASE WHEN $3='accepted' THEN $7::timestamptz ELSE NULL END,next_attempt_at=$8,updated_at=$7 WHERE business_id=$9 AND id=$1 AND claim_token=$2 AND status='processing'`,[item.id,item.claim_token,status,reason,result?.provider??null,result?.providerId??null,stamp,new Date(stamp.getTime()+2**(item.attempts-1)*5*60000),bid]);counts[status]++;
 });}catch{logger.warn({businessId:bid,stage:'weekly_owner_brief'},'Weekly owner brief did not complete');}
 return counts;
}
export async function retryWeeklyOwnerBrief({businessId,staffId,id},injected={}){
 const deps={...depsDefault,...injected};
 const overrides=await deps.getPlanFeatureOverrides();
 return deps.transaction(async client=>{const {business}=await ownerAndBusiness(client,businessId,staffId,true);if(!entitled(business,overrides))throw forbidden('Tu plan no incluye el resumen semanal.');
  const row=(await client.query('SELECT * FROM weekly_owner_briefs WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,id])).rows[0];if(!row)throw notFound('No se encontró este resumen.');
  if(row.status!=='failed'||row.attempts>=3||new Date(row.expires_at)<=new Date())throw conflict('Solo se reintentan fallos confirmados, con intentos disponibles y dentro de su vigencia.');
  await client.query('UPDATE weekly_owner_briefs SET next_attempt_at=clock_timestamp() WHERE id=$1 AND business_id=$2',[id,businessId]);
  await deps.audit({id:randomUUID(),business_id:businessId,actor_type:'STAFF',actor_id:staffId,action:'owner_brief.retry.requested',ip:null,ua:null,meta:{brief_id:id,attempts:row.attempts}});return{ok:true};
 });
}

const tokenHash=value=>createHash('sha256').update(value).digest('hex');
function validRequestId(value){if(!z.guid().safeParse(value).success)throw badRequest('La solicitud necesita un identificador válido.');}
async function briefOwner(client,options,overrides){const found=await ownerAndBusiness(client,options.businessId,options.staffId,true);if(!entitled(found.business,overrides))throw forbidden('Tu plan no incluye el resumen semanal.');return found;}
export async function requestOwnerBriefEmailVerification(options,injected={}){
 const deps={...depsDefault,...injected};validRequestId(options.requestId);const overrides=await deps.getPlanFeatureOverrides(),now=options.now??new Date();
 const prepared=await deps.transaction(async client=>{
  const {owner}=await briefOwner(client,options,overrides);
  const existing=(await client.query('SELECT id,status FROM owner_brief_email_verifications WHERE business_id=$1 AND owner_id=$2 AND id=$3',[options.businessId,owner.id,options.requestId])).rows[0];
  if(existing)return{existing};
  const destination=email(owner.email);if(!destination)throw badRequest('Añade un correo válido a tu cuenta desde Seguridad antes de verificarlo.');
  if(!deps.emailProviderReady())throw conflict('El correo saliente no está configurado. Puedes preparar una muestra sin enviar.');
  const count=(await client.query("SELECT count(*)::int AS daily,count(*) FILTER(WHERE created_at>$3::timestamptz-interval '1 hour')::int AS hourly FROM owner_brief_email_verifications WHERE business_id=$1 AND owner_id=$2 AND created_at>$3::timestamptz-interval '1 day'",[options.businessId,owner.id,now])).rows[0];
  if(count.hourly>=3||count.daily>=10)throw conflict('Ya solicitaste varios correos de verificación. Espera una hora antes de volver a solicitarlo.');
  const token=randomBytes(32).toString('base64url');await client.query('INSERT INTO owner_brief_email_verifications(id,business_id,owner_id,destination,token_hash,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[options.requestId,options.businessId,owner.id,destination,tokenHash(token),new Date(now.getTime()+30*60000),now]);
  return{token,destination};
 });
 if(prepared.existing)return{ok:true,request_id:prepared.existing.id,status:prepared.existing.status};
 let result;
 try{result=await deps.transaction(async client=>{
  const {owner}=await briefOwner(client,options,await deps.getPlanFeatureOverrides());
  if(email(owner.email)!==prepared.destination)return{ok:false,suppressed:true};
  return deps.sendEmail({to:prepared.destination,subject:'PuntosFieles · Verifica tu correo para el resumen',body:`Solicitaste verificar el correo de tu cuenta de propietario para recibir tu resumen.\n\nCódigo: ${prepared.token}\n\nPega este código en Automatizaciones > Tu resumen de la semana. Vence en 30 minutos y solo se puede usar una vez. Verificar no activa el resumen. Si no lo solicitaste, ignora este correo.`});
 });}catch{result={ok:false,error:'DELIVERY_UNCERTAIN'};}
 const status=classifyCampaignSend(result);await deps.query('UPDATE owner_brief_email_verifications SET status=$4 WHERE business_id=$1 AND owner_id=$2 AND id=$3',[options.businessId,options.staffId,options.requestId,status]);
 await deps.audit({id:randomUUID(),business_id:options.businessId,actor_type:'STAFF',actor_id:options.staffId,action:'owner_brief.email_verification.requested',ip:options.ip??null,ua:options.ua??null,meta:{request_id:options.requestId,status}});
 return{ok:true,request_id:options.requestId,status};
}
export async function confirmOwnerBriefEmailVerification(options,injected={}){
 const deps={...depsDefault,...injected};validRequestId(options.requestId);if(!z.string().regex(/^[A-Za-z0-9_-]{43}$/).safeParse(options.token).success)throw badRequest('Pega el código completo del correo.');
 const overrides=await deps.getPlanFeatureOverrides(),now=options.now??new Date();
 const result=await deps.transaction(async client=>{
  const {owner}=await briefOwner(client,options,overrides);
  const challenge=(await client.query('SELECT * FROM owner_brief_email_verifications WHERE business_id=$1 AND owner_id=$2 AND id=$3 FOR UPDATE',[options.businessId,owner.id,options.requestId])).rows[0];
  if(!challenge||challenge.consumed_at||challenge.attempts>=5||new Date(challenge.expires_at)<=now||challenge.destination!==email(owner.email))return false;
  if(!timingSafeEqual(Buffer.from(challenge.token_hash,'hex'),Buffer.from(tokenHash(options.token),'hex'))){await client.query('UPDATE owner_brief_email_verifications SET attempts=attempts+1 WHERE id=$1',[challenge.id]);return false;}
  await client.query('UPDATE staff_users SET verified_email=$3,email_verified_at=$4 WHERE business_id=$1 AND id=$2',[options.businessId,owner.id,challenge.destination,now]);
  await client.query('UPDATE owner_brief_email_verifications SET consumed_at=$3 WHERE business_id=$1 AND owner_id=$2 AND consumed_at IS NULL',[options.businessId,owner.id,now]);
  await deps.audit({id:randomUUID(),business_id:options.businessId,actor_type:'STAFF',actor_id:owner.id,action:'owner_brief.email.verified',ip:options.ip??null,ua:options.ua??null,meta:{request_id:options.requestId}});return true;
 });
 if(!result)throw badRequest('El código no es válido, venció o ya se usó. Revisa el correo o solicita otro código.');return{ok:true,email_verified:true};
}
export async function requestWeeklyOwnerBriefTest(options,injected={}){
 const deps={...depsDefault,...injected};validRequestId(options.requestId);const overrides=await deps.getPlanFeatureOverrides(),now=options.now??new Date();
 return deps.transaction(async client=>{
  const {business,owner}=await briefOwner(client,options,overrides);
  const existing=(await client.query("SELECT id,status FROM weekly_owner_briefs WHERE business_id=$1 AND owner_id=$2 AND kind='test' AND request_id=$3",[options.businessId,owner.id,options.requestId])).rows[0];if(existing)return{ok:true,...existing};
  const destination=verifiedEmail(owner);if(!destination)throw badRequest('Verifica el correo de tu cuenta antes de solicitar una prueba.');
  if(!deps.emailProviderReady())throw conflict('El correo saliente no está configurado. Puedes preparar una muestra sin enviar.');
  const counts=(await client.query("SELECT count(*)::int AS daily,count(*) FILTER(WHERE created_at>$3::timestamptz-interval '1 hour')::int AS hourly FROM weekly_owner_briefs WHERE business_id=$1 AND owner_id=$2 AND kind='test' AND created_at>$3::timestamptz-interval '1 day'",[options.businessId,owner.id,now])).rows[0];
  if(counts.hourly>=2||counts.daily>=5)throw conflict('Alcanzaste el límite de pruebas. Espera una hora para solicitar otra.');
  const snapshot=await buildBrief(client,business,now,deps),id=randomUUID();
  await client.query("INSERT INTO weekly_owner_briefs(id,business_id,owner_id,destination,period_start,snapshot,next_attempt_at,expires_at,created_at,channel,kind,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7,'email','test',$9)",[id,options.businessId,owner.id,destination,null,snapshot,now,new Date(now.getTime()+3600000),options.requestId]);
  await deps.audit({id:randomUUID(),business_id:options.businessId,actor_type:'STAFF',actor_id:owner.id,action:'owner_brief.test.requested',ip:options.ip??null,ua:options.ua??null,meta:{brief_id:id,request_id:options.requestId}});return{ok:true,id,status:'queued'};
 });
}
