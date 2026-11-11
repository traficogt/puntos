import { createHash, randomUUID } from 'node:crypto';
import { withTransaction } from '../database.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/http-error.js';
import { withImpersonationMeta } from '../../utils/impersonation.js';

const defaults={transaction:withTransaction};
const roles=new Set(['OWNER','MANAGER','CASHIER']);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date=value=>{const parsed=new Date(value);if(!value||!Number.isFinite(parsed.getTime()))throw badRequest('Revisa las fechas.');return parsed;};
function points(value,max=100000){if(!Number.isSafeInteger(value)||value<1||value>max)throw badRequest('Ingresa un límite de puntos entero y positivo.');}
async function liveMember(client,businessId,staff,{owner=false}={}){
 if(!uuid(businessId)||!uuid(staff?.id)||staff.business_id!==businessId)throw forbidden('Tu sesión no pertenece a este negocio.');
 const {rows}=await client.query('SELECT id,business_id,branch_id,role,active FROM staff_users WHERE business_id=$1 AND id=$2 FOR SHARE',[businessId,staff.id]);
 const member=rows[0];
 if(!member?.active||!roles.has(member.role)||(owner&&member.role!=='OWNER'))throw forbidden('Tu cuenta no tiene autorización vigente.');
 // A session scoped to a prior branch cannot use authority at its new branch.
 if((staff.branch_id??null)!==(member.branch_id??null))throw forbidden('Tu sucursal cambió. Vuelve a iniciar sesión.');
 if(member.branch_id){const branch=await client.query('SELECT id FROM branches WHERE business_id=$1 AND id=$2',[businessId,member.branch_id]);if(!branch.rowCount)throw forbidden('La sucursal ya no está disponible.');}
 return member;
}
// Branches have no update/delete API; stored scopes also have tenant foreign keys.
// SELECT-only branch access is intentional: row locks would require UPDATE grants.
async function branchExists(client,businessId,branchId){
 if(branchId===null||branchId===undefined)return;
 if(!uuid(branchId))throw badRequest('Selecciona una sucursal válida.');
 if(!(await client.query('SELECT id FROM branches WHERE business_id=$1 AND id=$2',[businessId,branchId])).rowCount)throw badRequest('La sucursal no pertenece a este negocio.');
}
async function audit(client,businessId,staff,action,meta){
 await client.query('INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,meta) VALUES($1,$2,\'STAFF\',$3,$4,$5::jsonb)',[randomUUID(),businessId,staff.id,action,JSON.stringify(withImpersonationMeta(meta,staff))]);
}
function serializedGrant(row){return {...row,remaining_points:row.total_points-row.used_points};}
function usageResult(row,replay){return {grantId:row.grant_id,remainingPoints:row.remaining_points,usageId:row.id,owner:row.owner_bypass,replay};}

/** Must run inside the caller's transaction before its ledger mutation. */
export async function consumeServiceAllowance(client,{businessId,staff,action,points:amount,requestId}){
 points(amount,2147483647);if(action!=='restore_redemption'||!uuid(requestId))throw badRequest('La acción o la referencia no es válida.');
 requestId=requestId.toLowerCase();
 const member=await liveMember(client,businessId,staff);
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[businessId,`service-authority:${requestId}`]);
 const fingerprint=createHash('sha256').update(JSON.stringify([businessId,member.id,member.branch_id,action,amount])).digest('hex');
 const prior=(await client.query('SELECT * FROM staff_service_usage WHERE business_id=$1 AND request_id=$2',[businessId,requestId])).rows[0];
 if(prior){if(prior.payload_fingerprint!==fingerprint)throw conflict('Esta referencia ya se usó para otra acción.');return usageResult(prior,true);}
 let grant=null,remaining=null;
 if(member.role!=='OWNER'){
  const candidates=await client.query(`SELECT * FROM staff_service_grants WHERE business_id=$1 AND staff_id=$2 AND action=$3 AND revoked_at IS NULL
    AND (branch_id IS NULL OR branch_id=$4) AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp()
    AND per_action_points>=$5 AND total_points-used_points>=$5 ORDER BY ends_at,id FOR UPDATE`,[businessId,member.id,action,member.branch_id,amount]);
  // Re-evaluate after locks: a wait can cross expiration or observe a consumed cap.
  const time=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
  grant=candidates.rows.find(row=>!row.revoked_at&&new Date(row.starts_at)<=time&&new Date(row.ends_at)>time&&row.total_points-row.used_points>=amount);
  if(!grant)throw forbidden('No tienes una autorización vigente con puntos suficientes. Pide ayuda al dueño.');
  remaining=grant.total_points-grant.used_points-amount;
  await client.query('UPDATE staff_service_grants SET used_points=used_points+$3 WHERE business_id=$1 AND id=$2',[businessId,grant.id,amount]);
 }
 const usage=(await client.query(`INSERT INTO staff_service_usage(id,business_id,grant_id,staff_id,branch_id,action,points,request_id,payload_fingerprint,remaining_points,owner_bypass)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[randomUUID(),businessId,grant?.id??null,member.id,member.branch_id,action,amount,requestId,fingerprint,remaining,member.role==='OWNER'])).rows[0];
 await audit(client,businessId,staff,'staff.authority.consume',{usage_id:usage.id,grant_id:grant?.id??null,action,points:amount,request_id:requestId,branch_id:member.branch_id,owner_bypass:member.role==='OWNER'});
 return usageResult(usage,false);
}
export async function createServiceGrant({businessId,staff,staffId,branchId=null,action='restore_redemption',perActionPoints,totalPoints,startsAt,endsAt,requestId},deps=defaults){
 points(perActionPoints);points(totalPoints,1000000);if(totalPoints<perActionPoints||action!=='restore_redemption'||!uuid(staffId))throw badRequest('Revisa los límites y la persona autorizada.');
 if(!uuid(requestId))throw badRequest('La referencia de esta autorización no es válida.');
 requestId=requestId.toLowerCase();staffId=staffId.toLowerCase();
 if(branchId!==null){if(!uuid(branchId))throw badRequest('Selecciona una sucursal válida.');branchId=branchId.toLowerCase();}
 const start=date(startsAt),end=date(endsAt);
 if(end<=start||end.getTime()-start.getTime()>31*86400000)throw badRequest('La autorización puede durar hasta 31 días.');
 const fingerprint=createHash('sha256').update(JSON.stringify([businessId,staff?.id,staffId,branchId,action,perActionPoints,totalPoints,start.toISOString(),end.toISOString()])).digest('hex');
 return deps.transaction(async client=>{
  await liveMember(client,businessId,staff,{owner:true});
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[businessId,`service-authority-create:${requestId}`]);
  const prior=(await client.query('SELECT * FROM staff_service_grants WHERE business_id=$1 AND creation_request_id=$2',[businessId,requestId])).rows[0];
  if(prior){
   if(prior.creation_payload_fingerprint!==fingerprint)throw conflict('Esta referencia ya se usó para una autorización con otros límites o condiciones.');
   return {ok:true,grant:serializedGrant(prior),replay:true};
  }
  await branchExists(client,businessId,branchId);
  const target=(await client.query('SELECT id,active,role,branch_id FROM staff_users WHERE business_id=$1 AND id=$2 FOR SHARE',[businessId,staffId])).rows[0];
  if(!target?.active||!['MANAGER','CASHIER'].includes(target.role))throw badRequest('Selecciona una persona activa del equipo.');
  if(branchId&&target.branch_id!==branchId)throw badRequest('La persona debe pertenecer a la sucursal seleccionada.');
  const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
  if(end<=now||start>new Date(+now+31*86400000))throw badRequest('Revisa el inicio y el vencimiento de la autorización.');
  const grant=(await client.query(`INSERT INTO staff_service_grants(id,business_id,staff_id,branch_id,action,per_action_points,total_points,starts_at,ends_at,created_by_staff_id,creation_request_id,creation_payload_fingerprint)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[randomUUID(),businessId,staffId,branchId,action,perActionPoints,totalPoints,start,end,staff.id,requestId,fingerprint])).rows[0];
  await audit(client,businessId,staff,'staff.authority.create',{grant_id:grant.id,request_id:requestId,staff_id:staffId,branch_id:branchId,action,per_action_points:perActionPoints,total_points:totalPoints,starts_at:start,ends_at:end});
  return {ok:true,grant:serializedGrant(grant),replay:false};
 });
}
export async function revokeServiceGrant({businessId,staff,grantId},deps=defaults){
 if(!uuid(grantId))throw badRequest('Autorización no válida.');
 return deps.transaction(async client=>{
  await liveMember(client,businessId,staff,{owner:true});
  const grant=(await client.query('SELECT * FROM staff_service_grants WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,grantId])).rows[0];
  if(!grant)throw notFound('No encontramos la autorización.');
  if(!grant.revoked_at){await client.query('UPDATE staff_service_grants SET revoked_at=clock_timestamp(),revoked_by_staff_id=$3 WHERE business_id=$1 AND id=$2',[businessId,grantId,staff.id]);await audit(client,businessId,staff,'staff.authority.revoke',{grant_id:grantId});}
  return {ok:true,grant_id:grantId};
 });
}
export async function listServiceGrants({businessId,staff,offset=0},deps=defaults){
 if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw badRequest('Página no válida.');
 return deps.transaction(async client=>{
  await liveMember(client,businessId,staff,{owner:true});
  const grants=await client.query(`SELECT g.*,s.name AS staff_name,b.name AS branch_name,clock_timestamp() AS server_now FROM staff_service_grants g
   JOIN staff_users s ON s.business_id=g.business_id AND s.id=g.staff_id LEFT JOIN branches b ON b.business_id=g.business_id AND b.id=g.branch_id
   WHERE g.business_id=$1 ORDER BY g.created_at DESC,g.id LIMIT 51 OFFSET $2`,[businessId,offset]);
  const usage=await client.query(`SELECT u.id,u.grant_id,u.staff_id,s.name AS staff_name,u.action,u.points,u.created_at,u.remaining_points,u.owner_bypass FROM staff_service_usage u
   JOIN staff_users s ON s.business_id=u.business_id AND s.id=u.staff_id WHERE u.business_id=$1 ORDER BY u.created_at DESC,u.id LIMIT 50`,[businessId]);
  const team=await client.query("SELECT id,name,role,branch_id FROM staff_users WHERE business_id=$1 AND active AND role IN ('CASHIER','MANAGER') ORDER BY name,id LIMIT 500",[businessId]);
  const branches=await client.query('SELECT id,name FROM branches WHERE business_id=$1 ORDER BY name,id LIMIT 500',[businessId]);
  return {ok:true,grants:grants.rows.slice(0,50).map(serializedGrant),usage:usage.rows,staff:team.rows,branches:branches.rows,pagination:{offset,has_more:grants.rows.length>50},history_limit:50};
 });
}
export async function getOwnServiceAuthority({businessId,staff},deps=defaults){
 return deps.transaction(async client=>{
  const member=await liveMember(client,businessId,staff);
  const grants=await client.query(`SELECT id,action,branch_id,per_action_points,total_points,used_points,starts_at,ends_at FROM staff_service_grants WHERE business_id=$1 AND staff_id=$2
   AND revoked_at IS NULL AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp() AND total_points>used_points AND (branch_id IS NULL OR branch_id=$3) ORDER BY ends_at,id`,[businessId,member.id,member.branch_id]);
  return {ok:true,owner:member.role==='OWNER',grants:grants.rows.map(serializedGrant)};
 });
}
function noticeText(value,max){
 if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||/\S+@\S+|(?:\d[\s()+.-]*){8,}/.test(value))throw badRequest('Usa texto breve sin datos de clientes, teléfonos, correos ni etiquetas.');
 return value.trim();
}
export async function publishShiftNotice({businessId,staff,noticeId=null,expectedVersion=undefined,title,body,branchId=null,expiresAt},deps=defaults){
 title=noticeText(title,100);body=noticeText(body,600);const expires=date(expiresAt);
 if(noticeId&&(!uuid(noticeId)||!Number.isSafeInteger(expectedVersion)||expectedVersion<1))throw badRequest('Revisa la versión del aviso.');
 return deps.transaction(async client=>{
  await liveMember(client,businessId,staff,{owner:true});await branchExists(client,businessId,branchId);
  // Serialize creates and edits that can revive an expired notice.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[businessId,'staff-shift-notice-publish']);
  const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
  if(expires<=now||expires.getTime()-now.getTime()>31*86400000)throw badRequest('El aviso debe vencer dentro de los próximos 31 días.');
  const count=(await client.query('SELECT count(*)::int count FROM staff_shift_notices WHERE business_id=$1 AND expires_at>clock_timestamp() AND ($2::uuid IS NULL OR id<>$2)',[businessId,noticeId])).rows[0].count;
  if(count>=10)throw badRequest('Ya hay 10 avisos vigentes. Edita uno existente o espera su vencimiento.');
  let notice;
  if(noticeId){
   const current=(await client.query('SELECT * FROM staff_shift_notices WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,noticeId])).rows[0];
   if(!current)throw notFound('No encontramos el aviso.');if(current.version!==expectedVersion)throw conflict('El aviso cambió. Actualiza antes de editarlo.');
   notice=(await client.query('UPDATE staff_shift_notices SET title=$3,body=$4,branch_id=$5,expires_at=$6,version=version+1,updated_at=clock_timestamp(),updated_by_staff_id=$7 WHERE business_id=$1 AND id=$2 RETURNING *',[businessId,noticeId,title,body,branchId,expires,staff.id])).rows[0];
  }else{
   notice=(await client.query(`INSERT INTO staff_shift_notices(id,business_id,branch_id,title,body,expires_at,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *`,[randomUUID(),businessId,branchId,title,body,expires,staff.id])).rows[0];
  }
  await audit(client,businessId,staff,'staff.briefing.publish',{notice_id:notice.id,version:notice.version,branch_id:branchId,expires_at:expires});
  return {ok:true,notice};
 });
}
export async function listShiftNotices({businessId,staff},deps=defaults){
 return deps.transaction(async client=>{
  await liveMember(client,businessId,staff,{owner:true});
  const notices=await client.query(`SELECT n.*,b.name AS branch_name,(SELECT count(*)::int FROM staff_shift_acknowledgements a WHERE a.business_id=n.business_id AND a.notice_id=n.id AND a.version=n.version) AS acknowledgements
   FROM staff_shift_notices n LEFT JOIN branches b ON b.business_id=n.business_id AND b.id=n.branch_id WHERE n.business_id=$1 ORDER BY n.updated_at DESC,n.id LIMIT 50`,[businessId]);
  return {ok:true,notices:notices.rows};
 });
}
export async function getShiftBriefing({businessId,staff},deps=defaults){
 return deps.transaction(async client=>{
  const member=await liveMember(client,businessId,staff);
  const notices=await client.query(`SELECT n.id,n.title,n.body,n.version,n.expires_at,n.updated_at FROM staff_shift_notices n WHERE n.business_id=$1 AND n.expires_at>clock_timestamp()
   AND (n.branch_id IS NULL OR n.branch_id=$3) AND NOT EXISTS(SELECT 1 FROM staff_shift_acknowledgements a WHERE a.business_id=n.business_id AND a.notice_id=n.id AND a.staff_id=$2 AND a.version=n.version) ORDER BY n.updated_at,n.id LIMIT 10`,[businessId,member.id,member.branch_id]);
  return {ok:true,notices:notices.rows};
 });
}
export async function acknowledgeShiftNotice({businessId,staff,noticeId,version},deps=defaults){
 if(!uuid(noticeId)||!Number.isSafeInteger(version)||version<1)throw badRequest('Aviso o versión no válidos.');
 return deps.transaction(async client=>{
  const member=await liveMember(client,businessId,staff);
  const notice=(await client.query('SELECT * FROM staff_shift_notices WHERE business_id=$1 AND id=$2 FOR SHARE',[businessId,noticeId])).rows[0];
  const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
  if(!notice||new Date(notice.expires_at)<=now||(notice.branch_id&&notice.branch_id!==member.branch_id))throw notFound('Este aviso ya no está disponible.');
  if(notice.version!==version)throw conflict('El aviso cambió. Lee la versión actual antes de confirmarla.');
  const result=await client.query('INSERT INTO staff_shift_acknowledgements(business_id,notice_id,staff_id,version) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING version',[businessId,noticeId,member.id,version]);
  if(result.rowCount)await audit(client,businessId,staff,'staff.briefing.acknowledge',{notice_id:noticeId,version});
  return {ok:true,notice_id:noticeId,version};
 });
}
