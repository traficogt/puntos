import {checkoutFeatureBusiness} from './pos-checkout-config.js';
import {checkoutForRedemption,completeCheckout,assertCheckoutCart} from './pos-checkout-store.js';
import {randomUUID} from 'node:crypto';
import {withTransaction} from '../database.js';
import {conflict,notFound,badRequest} from '../../utils/http-error.js';
import {normalizePosLookup,normalizePosFulfillmentEvent,fulfillmentFingerprint} from './redemption-pos-model.js';
import {redemptionEvidence,ensureFulfillmentRecord,lockFulfillmentRequest,publicMapping,publicFulfillment} from './redemption-pos-store.js';
const qty=n=>Math.round(Number(n)*1e6);
const matching=(a,b)=>a.source===b.source&&a.productRef===b.productRef&&a.currency===b.currency&&a.mappingId===b.mappingId&&a.mappingVersion===b.mappingVersion;
function stockAllowed(kind,itemKind,status){return itemKind==='service'?status==='not_applicable':(kind==='reversed'?['unknown','pending','returned']:['unknown','pending','done']).includes(status);}
async function selectMapping(client,businessId,redemption,source){
 const row=(await client.query('SELECT * FROM reward_pos_mappings WHERE business_id=$1 AND reward_id=$2 AND source=$3 AND enabled FOR SHARE',[businessId,redemption.reward_id,source])).rows[0];
 if(!row||(row.branch_id??null)!==(redemption.branch_id??null))throw conflict('Falta un vínculo activo para esta recompensa, caja y sucursal.');return publicMapping(row);
}
export async function lookupPosRedemption(business,input,injected={}){
 const {source,code}=normalizePosLookup(input);
 return (injected.transaction??withTransaction)(async client=>{
  const found=(await client.query('SELECT id FROM redemptions WHERE business_id=$1 AND code=$2',[business.id,code])).rows[0];if(!found)throw notFound('Código de canje no encontrado.');
  const redemption=await redemptionEvidence(client,business.id,found.id);
  const record=(await client.query('SELECT * FROM redemption_pos_records WHERE business_id=$1 AND redemption_id=$2',[business.id,found.id])).rows[0];
  if(!record?.method&&(redemption.points_restored||redemption.debit_corrected||['review','reviewed'].includes(record?.status)))throw conflict('Los puntos de este canje ya fueron restituidos; revisa el caso.');
  const mapping=record?.mapping_snapshot&&record.source===source?record.mapping_snapshot:await selectMapping(client,business.id,redemption,source);
  return{ok:true,redemption:{id:redemption.id,code:redemption.code,reward_id:redemption.reward_id,reward_name:record?.reward_name??redemption.reward_name,branch_id:redemption.branch_id,currency:record?.currency??redemption.currency,status:redemption.status},mapping,fulfillment:record?.method?publicFulfillment(record):null};
 });
}
export async function recordPosFulfillmentEvent(business,input,injected={}){
 const value=normalizePosFulfillmentEvent(input),hash=fulfillmentFingerprint(value),businessId=business.id;
 try{return await (injected.transaction??withTransaction)(async client=>{
  await lockFulfillmentRequest(client,businessId,value.source,value.eventId);
  const prior=(await client.query('SELECT * FROM redemption_pos_events WHERE business_id=$1 AND source=$2 AND event_id=$3',[businessId,value.source,value.eventId])).rows[0];
  if(prior){if(prior.fingerprint!==hash)throw conflict('El evento ya se recibió con otros datos.');const row=(await client.query('SELECT status FROM redemption_pos_records WHERE business_id=$1 AND redemption_id=$2',[businessId,value.redemptionId])).rows[0];return{ok:true,eventId:value.eventId,redemptionId:value.redemptionId,status:row.status==='reviewed'?'review':row.status,replay:true};}
  const checkout=await checkoutForRedemption(client,businessId,value.redemptionId);
  if(!checkout&&injected.enforceConnection)await checkoutFeatureBusiness(client,businessId,await injected.getPlanFeatureOverrides(),{requireConnection:true});
  if(value.kind==='recorded'){
   if(checkout){if(checkout.status!=='authorized'||checkout.request_id!==value.checkoutRequestId||checkout.source!==value.source)throw conflict('La autorización del carrito no coincide o ya no está disponible.');assertCheckoutCart(checkout,{branchId:checkout.branch_id,cartId:value.cartId,cartLineId:value.cartLineId});}
   else if(value.checkoutRequestId)throw conflict('No existe esta autorización de carrito.');
  }
  const redemption=await redemptionEvidence(client,businessId,value.redemptionId,{lock:true,requireUnrestored:value.kind==='recorded'});
  const record=await ensureFulfillmentRecord(client,redemption);
  if(value.currency!==record.currency)throw conflict('La moneda del recibo no coincide con el canje.');
  let mapping=record.mapping_snapshot,status=record.status,stockStatus=record.stock_status;
  if(value.kind==='recorded'){
   if(record.method||record.status!=='pending')throw conflict('Este canje ya tiene un registro o una revisión pendiente. No se puede entregar otra vez.');
   mapping=checkout?.authorization_snapshot?.mapping??await selectMapping(client,businessId,redemption,value.source);
   if(mapping.id!==value.mappingId||mapping.version!==value.mappingVersion||mapping.product_ref!==value.productRef||qty(mapping.quantity)!==qty(value.quantity))throw conflict('El producto, cantidad o versión no coincide con el vínculo vigente.');
   if(!stockAllowed('recorded',mapping.item_kind,value.stockStatus))throw badRequest('Estado de inventario incompatible con el producto o servicio.');
   await client.query(`UPDATE redemption_pos_records SET status='recorded',method='connector',source=$3,order_id=$4,line_id=$5,original_event_id=$6,mapping_snapshot=$7,stock_status=$8,recorded_at=now(),version=version+1,updated_at=now() WHERE business_id=$1 AND redemption_id=$2`,[businessId,value.redemptionId,value.source,value.orderId,value.lineId,value.eventId,JSON.stringify(mapping),value.stockStatus]);status='recorded';
  }else{
   if(record.method!=='connector'||record.source!==value.source||!mapping)throw conflict('No hay un registro POS original de esta caja.');
   const origin=(await client.query('SELECT * FROM redemption_pos_events WHERE business_id=$1 AND source=$2 AND event_id=$3 AND redemption_id=$4',[businessId,value.source,value.originalEventId,value.redemptionId])).rows[0];
   if(!origin||!['recorded','reversed'].includes(origin.kind)||!matching(value,origin.details))throw conflict('La referencia no corresponde a la evidencia original del canje.');
   if(value.kind==='reversed'){
    if(origin.kind!=='recorded'||value.lineId===origin.line_id||qty(record.returned_quantity)+qty(value.quantity)>qty(mapping.quantity))throw conflict('La devolución no corresponde a la cantidad pendiente del recibo original.');
    if(!stockAllowed('reversed',mapping.item_kind,value.stockStatus))throw badRequest('Estado de devolución inválido.');
    await client.query("UPDATE redemption_pos_records SET status='review',returned_quantity=returned_quantity+$3,version=version+1,updated_at=now() WHERE business_id=$1 AND redemption_id=$2",[businessId,value.redemptionId,value.quantity]);status='review';
   }else{
    if(value.orderId!==origin.details.orderId||value.lineId!==origin.details.lineId||qty(value.quantity)!==qty(origin.details.quantity)||!stockAllowed(origin.kind,mapping.item_kind,value.stockStatus))throw conflict('El estado de inventario no corresponde al recibo referenciado.');
    const latest=(await client.query("SELECT details FROM redemption_pos_events WHERE business_id=$1 AND source=$2 AND redemption_id=$3 AND kind='stock_updated' AND details->>'originalEventId'=$4 ORDER BY created_at DESC,id DESC LIMIT 1",[businessId,value.source,value.redemptionId,value.originalEventId])).rows[0]?.details??origin.details;
    if(['done','returned','not_applicable'].includes(latest.stockStatus)&&value.stockStatus!==latest.stockStatus)throw conflict('No se puede degradar una confirmación final de inventario; registra una devolución si corresponde.');
    if(origin.kind==='recorded')stockStatus=value.stockStatus;
    await client.query('UPDATE redemption_pos_records SET stock_status=$3,version=version+1,updated_at=now() WHERE business_id=$1 AND redemption_id=$2',[businessId,value.redemptionId,stockStatus]);
   }
  }
  if(checkout&&value.kind==='recorded')await completeCheckout(client,checkout);
  await client.query('INSERT INTO redemption_pos_events(id,business_id,redemption_id,source,event_id,fingerprint,kind,line_id,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),businessId,value.redemptionId,value.source,value.eventId,hash,value.kind,value.lineId,JSON.stringify(value)]);
  return{ok:true,eventId:value.eventId,redemptionId:value.redemptionId,status:status==='reviewed'?'review':status,replay:false};
 });}catch(error){if(error?.code==='23505')throw conflict('El recibo o evento ya está vinculado a otro canje.');throw error;}
}
