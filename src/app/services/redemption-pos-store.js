import {randomUUID} from 'node:crypto';
import {forbidden,notFound,conflict} from '../../utils/http-error.js';
import {withImpersonationMeta} from '../../utils/impersonation.js';
export async function fulfillmentActor(client,businessId,staff,ownerOnly=false){
 const row=(await client.query('SELECT id,business_id,role,branch_id,active FROM staff_users WHERE business_id=$1 AND id=$2',[businessId,staff?.id])).rows[0];
 if(!row?.active||staff?.business_id!==businessId||!['OWNER','MANAGER','CASHIER'].includes(row.role)||(row.branch_id??null)!==(staff.branch_id??null)||(ownerOnly&&row.role!=='OWNER'))throw forbidden('La sesión no puede administrar estos registros.');
 return {...row,...(staff.impersonated_by?{impersonated_by:staff.impersonated_by}:{})};
}
export const canSeeFulfillment=(staff,row)=>staff.role==='OWNER'||(staff.branch_id??null)===(row.branch_id??null);
export async function lockFulfillmentRequest(client,businessId,source,eventId){await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[businessId,`fulfillment:${source}:${eventId}`]);}
export async function redemptionEvidence(client,businessId,redemptionId,{lock=false,requireUnrestored=false}={}){
 redemptionId=String(redemptionId).toLowerCase();
 // Use the original debit as the shared serialization point with point restoration.
 const debits=await client.query(`SELECT id,reversed_transaction_id,status FROM transactions WHERE business_id=$1 AND source='redeem' AND meta->>'redemption_id'=$2${lock?' FOR UPDATE':''}`,[businessId,redemptionId]);
 const row=(await client.query(`SELECT r.*,w.name AS reward_name,COALESCE(b.program_json#>>'{region,currency}','GTQ') AS currency,
 EXISTS(SELECT 1 FROM service_redemption_restorations s WHERE s.business_id=r.business_id AND s.redemption_id=r.id) AS points_restored
 FROM redemptions r JOIN rewards w ON w.id=r.reward_id AND w.business_id=r.business_id JOIN businesses b ON b.id=r.business_id
 WHERE r.business_id=$1 AND r.id=$2`,[businessId,redemptionId])).rows[0];
 if(!row||row.status!=='REDEEMED')throw notFound('Canje completado no encontrado.');
 if(requireUnrestored&&(row.points_restored||debits.rows.some(d=>d.reversed_transaction_id||d.status!=='POSTED')))throw conflict('Este canje tiene una restitución o corrección; requiere revisión antes de vincular otra entrega.');
 return {...row,debit_corrected:debits.rows.some(d=>d.reversed_transaction_id||d.status!=='POSTED')};
}
export async function ensureFulfillmentRecord(client,redemption){
 await client.query(`INSERT INTO redemption_pos_records(redemption_id,business_id,branch_id,reward_id,reward_name,currency)
 VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(redemption_id) DO NOTHING`,[redemption.id,redemption.business_id,redemption.branch_id,redemption.reward_id,redemption.reward_name,redemption.currency]);
 return (await client.query('SELECT * FROM redemption_pos_records WHERE business_id=$1 AND redemption_id=$2 FOR UPDATE',[redemption.business_id,redemption.id])).rows[0];
}
export async function fulfillmentAudit(client,staff,action,meta){await client.query('INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,meta) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),staff.business_id,'STAFF',staff.id,action,JSON.stringify(withImpersonationMeta(meta,staff))]);}
export const publicMapping=row=>({...row,quantity:Number(row.quantity)});
export function publicFulfillment(row){if(!row)return null;return{redemptionId:row.redemption_id,eventId:row.original_event_id,source:row.source,orderId:row.order_id,lineId:row.line_id,status:row.status,stockStatus:row.stock_status,method:row.method,version:row.version,receiptRef:row.receipt_ref,returnedQuantity:Number(row.returned_quantity),recordedAt:row.recorded_at,mapping:row.mapping_snapshot};}
