import {initialRehearsal,applyRehearsalAction} from '../../../public/staff/rehearsal-model.js';
export {initialRehearsal,applyRehearsalAction};
import {createHash,randomUUID} from 'node:crypto';
import {withTransaction} from '../database.js';
import {conflict,notFound} from '../../utils/http-error.js';
import {livePromiseMember,promiseAudit,requestIdentity} from './reward-promise-service.js';
import {programBasics} from './merchant-launch-service.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const transaction=(deps,fn)=>(deps.transaction??withTransaction)(fn);
export async function readPracticeConfiguration(client,businessId,branchId=null){
 const business=(await client.query('SELECT program_type,program_json FROM businesses WHERE id=$1',[businessId])).rows[0];if(!business)throw notFound('Negocio no encontrado.');
 const rewards=(await client.query(`SELECT r.id,r.name,r.description,r.points_cost,r.active,r.stock,r.valid_until,COALESCE(a.available,true) available,
 ARRAY(SELECT branch_id FROM reward_branches WHERE reward_id=r.id ORDER BY branch_id) branch_ids,
 COALESCE(a.alternative_reward_ids,'{}'::uuid[]) alternative_reward_ids FROM rewards r LEFT JOIN reward_availability a ON a.business_id=r.business_id AND a.reward_id=r.id WHERE r.business_id=$1 ORDER BY r.id LIMIT 500`,[businessId])).rows;
 return {...business,rewards,branch_id:branchId};
}
export async function getAutomaticBriefing({businessId,staff},deps={}){
 return transaction(deps,async client=>{
  const member=await livePromiseMember(client,{businessId,staff});
  const scopeKey=member.role==='OWNER'?'all':member.branch_id??'unassigned';
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[businessId,`automatic-briefing:${scopeKey}`]);
  const config=await readPracticeConfiguration(client,businessId,member.branch_id??null);
  const offers=(await client.query("SELECT id,name,status,bonus_points,minimum_purchase_q,starts_at,expires_at FROM growth_campaigns WHERE business_id=$1 AND status='active' AND starts_at<=clock_timestamp() AND expires_at>clock_timestamp() ORDER BY id",[businessId])).rows;
  const cases=(await client.query(`SELECT kind,count(*)::int AS count,count(*) FILTER(WHERE escalated_at IS NOT NULL)::int AS escalated FROM service_cases WHERE business_id=$1 AND status='open' AND ($3 OR branch_id IS NOT DISTINCT FROM $2::uuid) GROUP BY kind ORDER BY kind`,[businessId,member.branch_id??null,member.role==='OWNER'])).rows;
  const rules=programBasics(config),payload={offers,unavailable_rewards:config.rewards.filter(r=>(member.role==='OWNER'||!r.branch_ids.length||r.branch_ids.includes(member.branch_id))&&(r.available===false||r.stock===0)).map(r=>({id:r.id,name:r.name,alternative_reward_ids:r.alternative_reward_ids,alternatives:config.rewards.filter(a=>r.alternative_reward_ids.includes(a.id)).map(a=>({id:a.id,name:a.name,available:a.active&&a.available&&a.stock!==0}))})),cases,rules,rule_version:hash({program_type:config.program_type,program_json:config.program_json})};
  const fingerprint=hash(payload);let briefing=(await client.query('SELECT * FROM staff_auto_briefings WHERE business_id=$1 AND scope_key=$2 ORDER BY version DESC LIMIT 1',[businessId,scopeKey])).rows[0];
  if(!briefing||briefing.payload_fingerprint!==fingerprint){briefing=(await client.query('INSERT INTO staff_auto_briefings(id,business_id,branch_id,version,payload_fingerprint,payload,scope_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[randomUUID(),businessId,member.branch_id??null,(briefing?.version??0)+1,fingerprint,payload,scopeKey])).rows[0];}
  const acknowledged=(await client.query('SELECT 1 FROM staff_auto_briefing_acknowledgements WHERE business_id=$1 AND briefing_id=$2 AND staff_id=$3',[businessId,briefing.id,staff.id])).rowCount>0;
  return {ok:true,briefing:{...briefing,acknowledged}};
 });
}
export async function acknowledgeAutomaticBriefing({businessId,staff,briefingId,version},deps={}){
 requestIdentity(briefingId);return transaction(deps,async client=>{
  const member=await livePromiseMember(client,{businessId,staff});
  await getAutomaticBriefing({businessId,staff},{transaction:fn=>fn(client)});
  const briefing=(await client.query('SELECT * FROM staff_auto_briefings WHERE business_id=$1 AND scope_key=$2 ORDER BY version DESC LIMIT 1',[businessId,member.role==='OWNER'?'all':member.branch_id??'unassigned'])).rows[0];
  if(!briefing||briefing.id!==briefingId||briefing.version!==version)throw conflict('El resumen cambió. Consulta la nueva versión.');
  const result=await client.query('INSERT INTO staff_auto_briefing_acknowledgements(business_id,briefing_id,staff_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING briefing_id',[businessId,briefingId,staff.id]);
  if(result.rowCount)await promiseAudit(client,{businessId,staff},'staff.automatic_briefing.acknowledge',{briefing_id:briefingId,version});return {ok:true};
 });
}
export async function getRehearsal({businessId,staff},deps={}){
 return transaction(deps,async client=>{const member=await livePromiseMember(client,{businessId,staff});const config=await readPracticeConfiguration(client,businessId,member.branch_id??null),fingerprint=hash(config);
 const session=(await client.query('SELECT * FROM staff_rehearsals WHERE business_id=$1 AND staff_id=$2 ORDER BY created_at DESC,id LIMIT 1',[businessId,staff.id])).rows[0]??null;
 const team=(await client.query("SELECT role,count(*)::int AS count FROM staff_users WHERE business_id=$1 AND active GROUP BY role",[businessId])).rows;
 const ready=config.rewards.filter(r=>r.active&&r.available&&r.stock!==0&&(!r.valid_until||new Date(r.valid_until)>new Date())&&(!r.branch_ids.length||r.branch_ids.includes(member.branch_id)));
 const blockers=[];if(!programBasics(config).rate||programBasics(config).rate<=0)blockers.push('Guarda una regla de puntos positiva.');
 if(!ready.length)blockers.push('Prepara una recompensa disponible para esta sucursal.');
 if(ready.some(r=>!r.description?.trim()))blockers.push('Describe qué recibe el cliente en cada recompensa disponible.');
 if(!team.some(r=>['OWNER','MANAGER','CASHIER'].includes(r.role)&&r.count>0))blockers.push('Activa una persona con permiso para registrar compras y canjes.');
 if(!team.some(r=>['OWNER','MANAGER'].includes(r.role)&&r.count>0))blockers.push('Activa un dueño o gerente con permiso para devoluciones.');
 return {ok:true,session,config,config_fingerprint:fingerprint,current:session?.config_fingerprint===fingerprint,readiness:{blockers,staff:team,description_complete:ready.every(r=>!!r.description?.trim())},limitations:['Simula la regla base, disponibilidad, sucursal y saldo. Promociones personalizadas, POS, Wallet y mensajería requieren una prueba física aparte.']};});
}
export async function startRehearsal({businessId,staff,requestId},deps={}){
 requestIdentity(requestId);return transaction(deps,async client=>{
  const member=await livePromiseMember(client,{businessId,staff});await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[businessId,requestId]);
  const prior=(await client.query('SELECT * FROM staff_rehearsals WHERE business_id=$1 AND id=$2 AND staff_id=$3',[businessId,requestId,staff.id])).rows[0];if(prior)return {ok:true,session:prior,replay:true};
  const config=await readPracticeConfiguration(client,businessId,member.branch_id??null),fingerprint=hash(config);config.observed_at=new Date().toISOString();
  const session=(await client.query('INSERT INTO staff_rehearsals(id,business_id,staff_id,config_fingerprint,state) VALUES($1,$2,$3,$4,$5) RETURNING *',[requestId,businessId,staff.id,fingerprint,initialRehearsal(config)])).rows[0];
  await promiseAudit(client,{businessId,staff},'staff.rehearsal.start',{rehearsal_id:session.id,config_fingerprint:fingerprint,fictional:true});return {ok:true,session,replay:false};
 });
}
export async function advanceRehearsal({businessId,staff,rehearsalId,version,requestId,...input},deps={}){
 requestIdentity(rehearsalId);requestIdentity(requestId);const fingerprint=hash({staffId:staff.id,rehearsalId,version,...input});
 return transaction(deps,async client=>{await livePromiseMember(client,{businessId,staff});await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[businessId,requestId]);
 const prior=(await client.query('SELECT * FROM staff_rehearsal_events WHERE business_id=$1 AND request_id=$2',[businessId,requestId])).rows[0];if(prior){if(prior.payload_fingerprint!==fingerprint)throw conflict('La referencia ya se usó para otro paso.');return {ok:true,session:prior.result,replay:true};}
 const current=(await client.query('SELECT * FROM staff_rehearsals WHERE business_id=$1 AND id=$2 AND staff_id=$3 FOR UPDATE',[businessId,rehearsalId,staff.id])).rows[0];if(!current)throw notFound('Práctica no encontrada.');if(current.version!==version)throw conflict('La práctica cambió. Recarga antes de continuar.');if(current.state.history.length>=100)throw conflict('Inicia una nueva práctica.');
 const state=applyRehearsalAction(current.state,input),session=(await client.query('UPDATE staff_rehearsals SET state=$3,version=version+1,updated_at=clock_timestamp(),completed_at=CASE WHEN $4 THEN COALESCE(completed_at,clock_timestamp()) ELSE completed_at END WHERE business_id=$1 AND id=$2 RETURNING *',[businessId,rehearsalId,state,state.complete])).rows[0];
 await client.query('INSERT INTO staff_rehearsal_events(id,business_id,rehearsal_id,request_id,payload_fingerprint,result) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),businessId,rehearsalId,requestId,fingerprint,session]);
 await promiseAudit(client,{businessId,staff},'staff.rehearsal.step',{rehearsal_id:rehearsalId,action:input.action,completed:state.complete,fictional:true});return {ok:true,session,replay:false};});
}
