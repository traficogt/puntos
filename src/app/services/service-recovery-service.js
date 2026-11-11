import {assertCheckoutCorrectionAllowed} from './pos-checkout-guard.js';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { withTransaction } from '../database.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/http-error.js';
import { withImpersonationMeta } from '../../utils/impersonation.js';

const defaults={transaction:withTransaction,consumeAllowance:async(client,args)=>(await import('./staff-delegation-service.js')).consumeServiceAllowance(client,args)};
const uuid=z.guid();
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const kinds=new Set(['redemption_failed','unavailable','unfulfilled']);
const CASE_SELECT=`SELECT sc.*,
 (SELECT c.name FROM customers c WHERE c.business_id=sc.business_id AND c.id=sc.customer_id AND c.deleted_at IS NULL) AS customer_display_name,
 (SELECT b.name FROM branches b WHERE b.business_id=sc.business_id AND b.id=sc.branch_id) AS branch_display_name,
 (SELECT s.name FROM staff_users s WHERE s.business_id=sc.business_id AND s.id=sc.reported_by_staff_id) AS reporting_staff_display_name
 FROM service_cases sc`;
const resolutions=new Set(['original_fulfilled','alternative_accepted','closed_with_reason','points_restored']);
function identity(value){if(!uuid.safeParse(value).success)throw badRequest('Identificador inválido.');return value;}
function reasonText(value){const result=typeof value==='string'?value.trim():'';if(result.length<3||result.length>500)throw badRequest('Describe el motivo en 3 a 500 caracteres.');return result;}
async function actor(client,businessId,staff){
 identity(businessId);identity(staff?.id);
 const {rows}=await client.query('SELECT id,business_id,role,branch_id,active FROM staff_users WHERE business_id=$1 AND id=$2',[businessId,staff.id]);
 const row=rows[0];if(!row?.active||!['OWNER','MANAGER','CASHIER'].includes(row.role)||staff.business_id!==businessId||(staff.branch_id??null)!==(row.branch_id??null))throw forbidden('La sesión no tiene acceso a este negocio.');
 return {...row,...(staff.impersonated_by?{impersonated_by:staff.impersonated_by}:{})};
}
const canSee=(staff,row)=>staff.role==='OWNER'||(staff.branch_id??null)===(row.branch_id??null);
function visible(row){if(!row)return null;const {request_fingerprint:_fingerprint,request_id:_requestId,...out}=row;return out;}
async function lockRequest(client,businessId,requestId){await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[businessId,`service:${requestId}`]);}
async function audit(client,staff,action,meta){await client.query(`INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,meta) VALUES($1,$2,'STAFF',$3,$4,$5)`,[randomUUID(),staff.business_id,staff.id,action,JSON.stringify(withImpersonationMeta(meta,staff))]);}
async function appendEvent(client,{staff,row,requestId,hash,type,details}){
 await client.query(`INSERT INTO service_case_events(id,business_id,case_id,actor_staff_id,request_id,request_fingerprint,event_type,version,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[randomUUID(),row.business_id,row.id,staff.id,requestId,hash,type,row.version,JSON.stringify(details)]);
}
async function selectedCase(client,businessId,staff,caseId,lock=false){
 const {rows}=await client.query(`${CASE_SELECT} WHERE business_id=$1 AND id=$2${lock?' FOR UPDATE':''}`,[businessId,identity(caseId)]);
 if(!rows[0]||!canSee(staff,rows[0]))throw notFound('Caso no encontrado.');return rows[0];
}
export async function createServiceCase(options,injected={}){
 const d={...defaults,...injected};const {businessId,customerId,requestId}=options;identity(customerId);identity(requestId);
 const kind=options.kind,reason=reasonText(options.reason);if(!kinds.has(kind))throw badRequest('Selecciona el motivo del caso.');
 const rewardId=options.rewardId?identity(options.rewardId):null,redemptionId=options.redemptionId?identity(options.redemptionId):null;
 if(kind==='redemption_failed'&&redemptionId)throw badRequest('Un intento rechazado no es un canje completado.');
 const hash=fingerprint({staffId:options.staff?.id,customerId,rewardId,redemptionId,kind,reason});
 return d.transaction(async client=>{
  const staff=await actor(client,businessId,options.staff);await lockRequest(client,businessId,requestId);
  const replay=await client.query('SELECT * FROM service_cases WHERE business_id=$1 AND request_id=$2',[businessId,requestId]);
  if(replay.rows[0]){const row=replay.rows[0];if(row.request_fingerprint!==hash)throw conflict('La solicitud ya pertenece a otro caso.');if(!canSee(staff,row))throw notFound('Caso no encontrado.');return {ok:true,case:visible(row),replay:true};}
  const customer=await client.query('SELECT id FROM customers WHERE business_id=$1 AND id=$2 AND deleted_at IS NULL',[businessId,customerId]);if(!customer.rowCount)throw notFound('Cliente no encontrado.');
  let branchId=staff.branch_id??null,redemption=null,reward=null;
  if(redemptionId){
   const found=await client.query('SELECT id,branch_id,customer_id,reward_id,points_cost,status,redeemed_at FROM redemptions WHERE business_id=$1 AND id=$2',[businessId,redemptionId]);redemption=found.rows[0];
   if(!redemption||redemption.customer_id!==customerId||!canSee(staff,redemption)||(rewardId&&redemption.reward_id!==rewardId))throw notFound('Canje no encontrado en esta sucursal.');branchId=redemption.branch_id;
  }
  const effectiveRewardId=rewardId??redemption?.reward_id??null;
  if(effectiveRewardId){const found=await client.query('SELECT id,name FROM rewards WHERE business_id=$1 AND id=$2',[businessId,effectiveRewardId]);reward=found.rows[0];if(!reward)throw notFound('Recompensa no encontrada.');}
  const evidence={source:kind==='redemption_failed'?'rejected_attempt':'staff_report',promise_terms:null,reward_name_at_report:reward?.name??null,redemption: redemption?{id:redemption.id,status:redemption.status,points_cost:redemption.points_cost,redeemed_at:redemption.redeemed_at}:null,physical_fulfillment:'unverified',points_deducted:kind==='redemption_failed'?false:null};
  const {rows}=await client.query(`INSERT INTO service_cases(id,business_id,branch_id,customer_id,reward_id,redemption_id,kind,request_id,request_fingerprint,reported_by_staff_id,reason,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[randomUUID(),businessId,branchId,customerId,effectiveRewardId,redemptionId,kind,requestId,hash,staff.id,reason,JSON.stringify(evidence)]);
  const row=rows[0];await appendEvent(client,{staff,row,requestId,hash,type:'reported',details:{kind,reason,evidence}});await audit(client,staff,'service.case.report',{case_id:row.id,kind,redemption_id:redemptionId});return {ok:true,case:visible(row),replay:false};
 });
}
export async function listServiceCases({businessId,staff:session,status='open',offset=0,customerId=null},injected={}){
 if(!['open','resolved','all'].includes(status)||!Number.isInteger(offset)||offset<0||offset>100000)throw badRequest('Filtro de casos inválido.');if(customerId)identity(customerId);
 return {...defaults,...injected}.transaction(async client=>{const staff=await actor(client,businessId,session);
  const values=[businessId,staff.role==='OWNER',staff.branch_id??null,status,offset,customerId];
  const {rows}=await client.query(`${CASE_SELECT} WHERE business_id=$1 AND ($2 OR branch_id IS NOT DISTINCT FROM $3::uuid) AND ($4='all' OR status=$4) AND ($6::uuid IS NULL OR customer_id=$6) ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET $5`,values);
  return {ok:true,cases:rows.slice(0,50).map(visible),pagination:{offset,limit:50,has_more:rows.length>50}};
 });
}
export async function getServiceCase({businessId,staff:session,caseId},injected={}){
 return {...defaults,...injected}.transaction(async client=>{const staff=await actor(client,businessId,session),row=await selectedCase(client,businessId,staff,caseId);
  const {rows}=await client.query('SELECT id,actor_staff_id,event_type,version,details,created_at FROM service_case_events WHERE business_id=$1 AND case_id=$2 ORDER BY version',[businessId,caseId]);
  const restoration=await client.query('SELECT id,points_restored,created_at FROM service_redemption_restorations WHERE business_id=$1 AND redemption_id=$2',[businessId,row.redemption_id]);
  return {ok:true,case:visible(row),events:rows,restoration:restoration.rows[0]??null};
 });
}
export async function resolveServiceCase(options,injected={}){
 const d={...defaults,...injected},{businessId,caseId,requestId,resolution,version}=options;identity(caseId);identity(requestId);const reason=reasonText(options.reason);
 if(!resolutions.has(resolution)||!Number.isInteger(version)||version<1)throw badRequest('Selecciona una resolución válida.');
 if(['original_fulfilled','alternative_accepted'].includes(resolution)&&options.attested!==true)throw badRequest('Confirma la entrega o la alternativa acordada con el cliente.');
 const hash=fingerprint({staffId:options.staff?.id,caseId,version,resolution,reason,attested:options.attested===true});
 return d.transaction(async client=>{
  const staff=await actor(client,businessId,options.staff);await lockRequest(client,businessId,requestId);
  const row=await selectedCase(client,businessId,staff,caseId,true);
  const replay=await client.query('SELECT request_fingerprint FROM service_case_events WHERE business_id=$1 AND request_id=$2',[businessId,requestId]);
  if(replay.rows[0]){if(replay.rows[0].request_fingerprint!==hash)throw conflict('La solicitud ya se usó para otra resolución.');return {ok:true,case:visible(row),replay:true};}
  if(row.version!==version||row.status!=='open')throw conflict('El caso cambió. Actualiza antes de resolverlo.');
  let restoration=null;
  if(resolution==='points_restored'){
   if(!row.redemption_id)throw conflict('Este caso no tiene un canje completado del que restituir puntos.');
   // The original debit below
   // is the shared serialization point for restitution and legacy refunds.
   const redeemed=await client.query('SELECT * FROM redemptions WHERE business_id=$1 AND id=$2',[businessId,row.redemption_id]);const redemption=redeemed.rows[0];
   if(!redemption||redemption.customer_id!==row.customer_id||!canSee(staff,redemption)||redemption.status!=='REDEEMED'||!Number.isSafeInteger(redemption.points_cost)||redemption.points_cost<=0)throw conflict('No existe un canje válido para restituir puntos.');
   // A successful status alone is insufficient: prove the original posted debit.
   // Keep this lock through commit: the legacy refund path checks restoration
   // evidence while holding the same debit lock, preventing a second credit.
   const debit=await client.query(`SELECT id,points,status,reversed_transaction_id FROM transactions WHERE business_id=$1 AND customer_id=$2 AND source='redeem' AND meta->>'redemption_id'=$3 FOR UPDATE`,[businessId,row.customer_id,redemption.id]);
   if(debit.rows.length!==1||debit.rows[0].status!=='POSTED'||debit.rows[0].points!==-redemption.points_cost||debit.rows[0].reversed_transaction_id)throw conflict('El débito original requiere revisión; no se restituyeron puntos.');
   await assertCheckoutCorrectionAllowed(client,{businessId,redemptionId:redemption.id});
   // Recheck after the debit lock: another case may have committed while waiting.
   const previous=await client.query('SELECT id FROM service_redemption_restorations WHERE business_id=$1 AND redemption_id=$2',[businessId,redemption.id]);if(previous.rowCount)throw conflict('Los puntos de este canje ya fueron restituidos.');
   // Match existing ledger writers: balance before customer. SHARE protects the
   // active check without blocking customer foreign-key reads by other debits.
   const balance=await client.query('SELECT customer_id FROM customer_balances WHERE customer_id=$1 FOR UPDATE',[row.customer_id]);if(!balance.rowCount)throw conflict('El saldo requiere revisión.');
   const customer=await client.query('SELECT id FROM customers WHERE business_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE',[businessId,row.customer_id]);if(!customer.rowCount)throw conflict('El cliente ya no está activo.');
   const allowance=await d.consumeAllowance(client,{businessId,staff,action:'restore_redemption',points:redemption.points_cost,requestId});
   const adjustmentId=randomUUID();
   await client.query(`INSERT INTO ledger_balance_adjustments(id,business_id,customer_id,created_by_staff_id,reason,delta_points,delta_pending_points,delta_lifetime_points) VALUES($1,$2,$3,$4,$5,$6,0,0)`,[adjustmentId,businessId,row.customer_id,staff.id,`Restitución por caso ${row.id}: ${reason}`,redemption.points_cost]);
   // Existing native_wallet_balance_changed trigger schedules refresh atomically.
   const updated=await client.query('UPDATE customer_balances SET points=points+$2,updated_at=now() WHERE customer_id=$1 AND points<=2147483647-$2 RETURNING points',[row.customer_id,redemption.points_cost]);if(updated.rowCount!==1)throw conflict('El saldo requiere revisión.');
   const restored=await client.query(`INSERT INTO service_redemption_restorations(id,business_id,redemption_id,case_id,customer_id,adjustment_id,points_restored,restored_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,points_restored,created_at`,[randomUUID(),businessId,redemption.id,row.id,row.customer_id,adjustmentId,redemption.points_cost,staff.id]);
   restoration={...restored.rows[0],adjustment_id:adjustmentId,grant_id:allowance.grantId??null};
  }
  const {rows}=await client.query(`UPDATE service_cases SET status='resolved',resolution=$3,version=version+1,resolved_at=now(),updated_at=now() WHERE business_id=$1 AND id=$2 RETURNING *`,[businessId,caseId,resolution]);
  const details={resolution,reason,attested:options.attested===true,restoration};await appendEvent(client,{staff,row:rows[0],requestId,hash,type:'resolved',details});await audit(client,staff,'service.case.resolve',{case_id:caseId,...details});return {ok:true,case:visible(rows[0]),restoration,replay:false};
 });
}

export function redemptionFailureKind(error){
 const message=String(error?.message??'');
 if(![400,403,404,409].includes(error?.statusCode))return null;
 if(message==='Reward not available'||message==='Reward expired'||message==='Reward out of stock'||message==='Reward not available at this branch')return 'unavailable';
 if(message==='Insufficient points'||/^Daily (redemption limit|limit reached for this reward)/.test(message)||/^Reward cooldown active\./.test(message))return 'redemption_failed';
 return null;
}
function redemptionFailureReason(error){
 const known={
  'Reward not available':'La recompensa no estaba disponible al intentar el canje.',
  'Reward expired':'La recompensa estaba vencida al intentar el canje.',
  'Reward out of stock':'La recompensa no tenía existencias al intentar el canje.',
  'Reward not available at this branch':'La recompensa no estaba disponible en esta sucursal.',
  'Insufficient points':'El saldo no alcanzaba para completar el canje.'
 };
 return Object.hasOwn(known,error.message)?known[error.message]:String(error.message).startsWith('Reward cooldown')?'El intervalo entre canjes impedía completar este intento.':'El límite de canjes impedía completar este intento.';
}
/** Only call after redeemReward rejected and its transaction has rolled back. */
export async function recordFailedRedemption({staff,customerId,rewardId,requestId,error},injected={}){
 if(!redemptionFailureKind(error)||!uuid.safeParse(requestId).success)return null;
 try{const result=await (injected.createCase??createServiceCase)({businessId:staff.business_id,staff,customerId,rewardId,requestId,kind:'redemption_failed',reason:redemptionFailureReason(error)},injected);return result.case.id;}catch{return null;}
}

export async function listServiceRedemptions({businessId,staff:session,customerId},injected={}){
 identity(customerId);
 return {...defaults,...injected}.transaction(async client=>{
  const staff=await actor(client,businessId,session);
  const {rows}=await client.query(`SELECT r.id,r.reward_id,r.points_cost,r.created_at,r.code,r.status,w.name AS reward_name,
   EXISTS(SELECT 1 FROM service_redemption_restorations s WHERE s.business_id=$1 AND s.redemption_id=r.id) AS points_restored
   FROM redemptions r JOIN rewards w ON w.business_id=r.business_id AND w.id=r.reward_id
   JOIN customers c ON c.id=r.customer_id AND c.business_id=r.business_id AND c.deleted_at IS NULL
   WHERE r.business_id=$1 AND r.customer_id=$2 AND ($3 OR r.branch_id IS NOT DISTINCT FROM $4::uuid)
   ORDER BY r.created_at DESC,r.id DESC LIMIT 30`,[businessId,customerId,staff.role==='OWNER',staff.branch_id??null]);
  return {ok:true,redemptions:rows};
 });
}
