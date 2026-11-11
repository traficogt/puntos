import {checkoutForRedemption,completeCheckout} from './pos-checkout-store.js';
import {randomUUID} from 'node:crypto';
import {withTransaction} from '../database.js';
import {badRequest,conflict,forbidden,notFound} from '../../utils/http-error.js';
import {normalizeManualFulfillment,fulfillmentFingerprint} from './redemption-pos-model.js';
import {fulfillmentActor,canSeeFulfillment,redemptionEvidence,ensureFulfillmentRecord,lockFulfillmentRequest,fulfillmentAudit,publicFulfillment} from './redemption-pos-store.js';
const statuses=['all','pending','recorded','not_required','review','reviewed','unknown'];
export async function listRedemptionPosRecords({businessId,staff,status='pending',code='',offset=0},injected={}){
 if(!statuses.includes(status)||!Number.isInteger(offset)||offset<0||offset>100000||typeof code!=='string'||!(/^[A-Fa-f0-9]{0,16}$/).test(code))throw badRequest('Filtro de canjes inválido.');
 return (injected.transaction??withTransaction)(async client=>{
  const actor=await fulfillmentActor(client,businessId,staff),args=[businessId,actor.role==='OWNER',actor.branch_id??null,status,code.toUpperCase(),offset];
  const rows=(await client.query(`SELECT r.id,r.customer_id,r.reward_id,r.branch_id,r.code,r.points_cost,r.created_at,
   COALESCE(p.reward_name,w.name) AS reward_name,b.name AS branch_name,COALESCE(p.status,'unknown') AS pos_status,
   COALESCE(p.version,0) AS version,p.method,p.source,p.order_id,p.line_id,p.stock_status,p.receipt_ref,p.recorded_at,p.returned_quantity,
   EXISTS(SELECT 1 FROM service_redemption_restorations s WHERE s.business_id=r.business_id AND s.redemption_id=r.id) AS points_restored
   FROM redemptions r JOIN rewards w ON w.id=r.reward_id AND w.business_id=r.business_id LEFT JOIN branches b ON b.id=r.branch_id AND b.business_id=r.business_id
   LEFT JOIN redemption_pos_records p ON p.redemption_id=r.id AND p.business_id=r.business_id
   WHERE r.business_id=$1 AND r.status='REDEEMED' AND ($2 OR r.branch_id IS NOT DISTINCT FROM $3::uuid)
   AND ($4='all' OR COALESCE(p.status,'unknown')=$4) AND ($5='' OR r.code LIKE $5||'%')
   ORDER BY r.created_at DESC,r.id DESC LIMIT 51 OFFSET $6`,args)).rows;
  const summary=(await client.query(`SELECT COALESCE(p.status,'unknown') AS status,count(*)::int AS count
   FROM redemptions r LEFT JOIN redemption_pos_records p ON p.redemption_id=r.id AND p.business_id=r.business_id
   WHERE r.business_id=$1 AND r.status='REDEEMED' AND ($2 OR r.branch_id IS NOT DISTINCT FROM $3::uuid) GROUP BY COALESCE(p.status,'unknown')`,args.slice(0,3))).rows;
  return{ok:true,records:rows.slice(0,50).map(r=>({...r,returned_quantity:Number(r.returned_quantity??0)})),summary:Object.fromEntries(summary.map(r=>[r.status,r.count])),pagination:{offset,limit:50,has_more:rows.length>50}};
 });
}
export async function getRedemptionPosRecord({businessId,staff,redemptionId},injected={}){
 redemptionId=String(redemptionId).toLowerCase();
 return (injected.transaction??withTransaction)(async client=>{
  const actor=await fulfillmentActor(client,businessId,staff),redemption=await redemptionEvidence(client,businessId,redemptionId);
  if(!canSeeFulfillment(actor,redemption))throw notFound('Canje no encontrado en esta sucursal.');
  const record=(await client.query('SELECT * FROM redemption_pos_records WHERE business_id=$1 AND redemption_id=$2',[businessId,redemptionId])).rows[0];
  const events=(await client.query('SELECT event_id,source,kind,actor_staff_id,details,created_at FROM redemption_pos_events WHERE business_id=$1 AND redemption_id=$2 ORDER BY created_at,id',[businessId,redemptionId])).rows;
  return{ok:true,redemption:{id:redemption.id,code:redemption.code,reward_name:record?.reward_name??redemption.reward_name,customer_id:redemption.customer_id,points_restored:redemption.points_restored,branch_id:redemption.branch_id},fulfillment:publicFulfillment(record),events};
 });
}
export async function recordManualFulfillment({businessId,staff,redemptionId,input},injected={}){
 redemptionId=String(redemptionId).toLowerCase();
 const value=normalizeManualFulfillment(input),hash=fulfillmentFingerprint({redemptionId,staffId:staff.id,...value});
 return (injected.transaction??withTransaction)(async client=>{
  const actor=await fulfillmentActor(client,businessId,staff);
  if(['not_required','reviewed'].includes(value.action)&&actor.role==='CASHIER')throw forbidden('Un gerente o propietario debe confirmar que no corresponde un registro POS.');
  await lockFulfillmentRequest(client,businessId,'manual',value.requestId);
  const prior=(await client.query("SELECT fingerprint FROM redemption_pos_events WHERE business_id=$1 AND source='manual' AND event_id=$2",[businessId,value.requestId])).rows[0];
  const checkout=await checkoutForRedemption(client,businessId,redemptionId);
  if(!prior&&checkout?.status==='authorized'&&value.action!=='recorded')throw conflict('Confirma el recibo real o cancela el carrito desde la caja. Un canje autorizado no se puede omitir.');
  const redemption=await redemptionEvidence(client,businessId,redemptionId,{lock:true,requireUnrestored:!prior&&value.action==='recorded'});
  if(!canSeeFulfillment(actor,redemption))throw notFound('Canje no encontrado en esta sucursal.');
  const record=await ensureFulfillmentRecord(client,redemption);
  if(prior){if(prior.fingerprint!==hash)throw conflict('La solicitud ya corresponde a otro registro.');return{ok:true,fulfillment:publicFulfillment(record),replay:true};}
  if(record.version!==value.version)throw conflict('El canje cambió. Actualiza antes de registrar evidencia.');
  if(value.action==='reviewed'&&record.status!=='review')throw conflict('Solo se puede cerrar una revisión pendiente.');
  if(!['review','reviewed'].includes(value.action)&&(record.method||record.status!=='pending'))throw conflict('El canje ya tiene evidencia o requiere revisión. No se sobrescribe su historial.');
  const row=(await client.query(`UPDATE redemption_pos_records SET status=$3,method=COALESCE(method,'manual'),receipt_ref=COALESCE(receipt_ref,$4),recorded_at=CASE WHEN $3='recorded' THEN now() ELSE recorded_at END,version=version+1,updated_at=now() WHERE business_id=$1 AND redemption_id=$2 RETURNING *`,[businessId,redemptionId,value.action,value.receiptRef??null])).rows[0];
  await client.query("INSERT INTO redemption_pos_events(id,business_id,redemption_id,source,event_id,fingerprint,kind,actor_staff_id,details) VALUES($1,$2,$3,'manual',$4,$5,$6,$7,$8)",[randomUUID(),businessId,redemptionId,value.requestId,hash,value.action,actor.id,JSON.stringify({reason:value.reason,receiptRef:value.receiptRef??null,attested:true,evidence:'staff_reported'})]);
  if(checkout?.status==='authorized'&&value.action==='recorded')await completeCheckout(client,checkout);
  await fulfillmentAudit(client,actor,'redemption.pos.manual',{redemption_id:redemptionId,action:value.action,receipt_ref:value.receiptRef??null});return{ok:true,fulfillment:publicFulfillment(row),replay:false};
 });
}
