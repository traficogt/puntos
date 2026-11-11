import {randomUUID} from 'node:crypto';
import {withTransaction} from '../database.js';
import {conflict,forbidden,notFound} from '../../utils/http-error.js';
import {PlanConfigService} from './plan-config-service.js';
import {normalizeCheckoutOptions,normalizeCheckoutAuthorize,normalizeCheckoutStatus,normalizeCheckoutCancel,checkoutIdentityHash,checkoutFingerprint} from './pos-checkout-model.js';
import {checkoutFeatureBusiness,checkoutSource} from './pos-checkout-config.js';
import {lockCheckout,checkoutIntent,checkoutResponse,assertCheckoutCart} from './pos-checkout-store.js';
import {lookupCustomerByQrToken,redeemCheckoutWithinTransaction} from './staff-service.js';
import {protectedRedemptionReward} from './reward-promise-service.js';
import {getRewardInventory} from './reward-inventory-service.js';
import {publicMapping,fulfillmentAudit,redemptionEvidence,ensureFulfillmentRecord} from './redemption-pos-store.js';
export {getCheckoutSources,configureCheckoutSource} from './pos-checkout-config.js';
const overrides=deps=>(deps.getPlanFeatureOverrides??(()=>PlanConfigService.getPlanFeatureOverrides()))();
const resolveCustomer=async(deps,staff,customerQrToken)=>deps.resolveCustomer?deps.resolveCustomer({staff,customerQrToken}):(await lookupCustomerByQrToken({staff,customerQrToken})).customer;

export async function getPosCheckoutOptions(business,input,deps={}){
 const v=normalizeCheckoutOptions(input),features=await overrides(deps);
 return(deps.transaction??withTransaction)(async client=>{
  await checkoutFeatureBusiness(client,business.id,features,{requireConnection:true});
  const {staff}=await checkoutSource(client,business.id,v),customer=await resolveCustomer(deps,staff,v.customerQrToken);
  const mappings=(await client.query('SELECT * FROM reward_pos_mappings WHERE business_id=$1 AND source=$2 AND branch_id IS NOT DISTINCT FROM $3::uuid AND enabled ORDER BY item_name LIMIT 200',[business.id,v.source,v.branchId])).rows;
  const rewards=[];
  for(const mapping of mappings){
   let reward=(await client.query('SELECT * FROM rewards WHERE business_id=$1 AND id=$2',[business.id,mapping.reward_id])).rows[0];
   if(!reward)continue;
   try{reward=await protectedRedemptionReward(client,{businessId:business.id,customerId:customer.id,reward});}catch(e){if(e?.statusCode===409)continue;throw e;}
   const branches=reward.protected_branch_ids??(await client.query('SELECT branch_id FROM reward_branches WHERE reward_id=$1',[reward.id])).rows.map(r=>r.branch_id);
   if(!reward.active||reward.stock===0||reward.valid_until&&new Date(reward.valid_until)<=new Date()||branches.length&&!branches.includes(v.branchId))continue;
   const availability=await getRewardInventory(client,{businessId:business.id,rewardId:reward.id,branchId:v.branchId});
   rewards.push({rewardId:reward.id,rewardName:reward.name,pointsCost:reward.points_cost,mapping:publicMapping(mapping),availability});
  }
  return{ok:true,customer:{id:customer.id,name:customer.name,points:customer.points},rewards};
 });
}
export async function authorizePosCheckout(business,input,deps={}){
 const v=normalizeCheckoutAuthorize(input),hash=checkoutIdentityHash(v),features=await overrides(deps);
 try{return await(deps.transaction??withTransaction)(async client=>{
  await lockCheckout(client,business.id,v.source,v.requestId);
  const prior=await checkoutIntent(client,business.id,v.source,v.requestId);
  if(prior){assertCheckoutCart(prior,v);if(prior.fingerprint&&prior.fingerprint!==hash)throw conflict('La autorización ya corresponde a otros datos.');return checkoutResponse(prior,true);}
  await checkoutFeatureBusiness(client,business.id,features,{requireConnection:true});
  const {staff}=await checkoutSource(client,business.id,v),customer=await resolveCustomer(deps,staff,v.customerQrToken);
  if(customer.id!==v.customerId)throw forbidden('La tarjeta no corresponde a este cliente.');
  const mapping=(await client.query('SELECT * FROM reward_pos_mappings WHERE business_id=$1 AND id=$2 FOR SHARE',[business.id,v.mappingId])).rows[0];
  if(!mapping?.enabled||mapping.reward_id!==v.rewardId||mapping.source!==v.source||(mapping.branch_id??null)!==v.branchId||mapping.version!==v.mappingVersion)throw conflict('El vínculo cambió. Consulta otra vez los premios de esta caja.');
  const redemptionRequestId=randomUUID(),captured=[];
  const out=await redeemCheckoutWithinTransaction(client,{staff,customerId:v.customerId,rewardId:v.rewardId,requestId:redemptionRequestId},async(_client,payload)=>{captured.push(payload);});
  await client.query("UPDATE transactions SET type='REDEMPTION' WHERE business_id=$1 AND source='redeem' AND meta->>'redemption_id'=$2",[business.id,out.redemptionId]);
  const completion=captured[0];
  if(!completion)throw conflict('No se pudo conservar la autorización. Reintenta con la misma referencia.');
  completion.cycleId=(await client.query('SELECT id FROM reward_promise_cycles WHERE business_id=$1 AND customer_id=$2 AND completed_at IS NULL',[business.id,v.customerId])).rows[0]?.id??null;
  await client.query('UPDATE redemption_pos_records SET reward_name=$3 WHERE business_id=$1 AND redemption_id=$2',[business.id,out.redemptionId,completion.reward.name]);
  const authorization_snapshot={redemption:{id:out.redemptionId,code:out.redemptionCode,points_cost:completion.pointsCost,balance_after:out.newBalance},mapping:publicMapping(mapping)};
  const row=(await client.query(`INSERT INTO pos_checkout_intents(id,business_id,source,branch_id,request_id,cart_id,cart_line_id,customer_id,fingerprint,status,redemption_id,redemption_request_id,staff_user_id,authorization_snapshot,completion_payload,quota_decremented)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'authorized',$10,$11,$12,$13,$14,$15) RETURNING *`,[randomUUID(),business.id,v.source,v.branchId,v.requestId,v.cartId,v.cartLineId,v.customerId,hash,out.redemptionId,redemptionRequestId,staff.id,JSON.stringify(authorization_snapshot),JSON.stringify(completion),completion.reward.stock!=null])).rows[0];
  await fulfillmentAudit(client,staff,'pos.checkout.authorized',{request_id:v.requestId,source:v.source,cart_id:v.cartId,cart_line_id:v.cartLineId,operator_ref:v.operatorRef,redemption_id:out.redemptionId});
  return checkoutResponse(row);
 });}catch(e){if(e?.code==='23505')throw conflict('Este cliente o línea ya tiene una autorización pendiente.');throw e;}
}
export async function getPosCheckoutStatus(business,input,deps={}){
 const v=normalizeCheckoutStatus(input);
 return(deps.transaction??withTransaction)(async client=>{
  const row=await checkoutIntent(client,business.id,v.source,v.requestId);
  if(!row||(row.branch_id??null)!==v.branchId)throw notFound('Autorización no encontrada.');
  return checkoutResponse(row,true);
 });
}
export async function cancelPosCheckout(business,input,deps={}){
 const v=normalizeCheckoutCancel(input),hash=checkoutFingerprint(v);
 try{return await(deps.transaction??withTransaction)(async client=>{
  await lockCheckout(client,business.id,v.source,v.requestId);
  const row=await checkoutIntent(client,business.id,v.source,v.requestId);
  if(row){
   assertCheckoutCart(row,v);
   if(row.status==='cancelled'){if(row.cancel_fingerprint!==hash)throw conflict('La cancelación ya corresponde a otra solicitud.');return checkoutResponse(row,true);}
   if(row.status==='recorded')throw conflict('El recibo ya está confirmado. Registra una devolución y revisión.');
   // Matches restoration and receipt writers: original debit first, then record.
   const redemption=await redemptionEvidence(client,business.id,row.redemption_id,{lock:true,requireUnrestored:true});
   const record=await ensureFulfillmentRecord(client,redemption);
   if(record.method||record.status!=='pending')throw conflict('El canje tiene evidencia o una revisión; no se devuelve automáticamente.');
   const debit=(await client.query("SELECT id,points FROM transactions WHERE business_id=$1 AND source='redeem' AND meta->>'redemption_id'=$2",[business.id,row.redemption_id])).rows;
   if(debit.length!==1||-Number(debit[0].points)!==Number(redemption.points_cost))throw conflict('El débito requiere revisión.');
   // Same order as redemption: reward quota before balance. Business sharing
   // protects concurrent rule edits; the original debit protects corrections.
   await client.query('SELECT id FROM businesses WHERE id=$1 FOR SHARE',[business.id]);
   await client.query('SELECT id FROM rewards WHERE business_id=$1 AND id=$2 FOR UPDATE',[business.id,redemption.reward_id]);
   const balance=await client.query('UPDATE customer_balances SET points=points+$2,updated_at=now() WHERE customer_id=$1 AND points<=2147483647-$2 RETURNING points',[row.customer_id,redemption.points_cost]);
   if(!balance.rowCount)throw conflict('El saldo requiere revisión.');
   if(row.quota_decremented)await client.query('UPDATE rewards SET stock=stock+1 WHERE business_id=$1 AND id=$2 AND stock IS NOT NULL AND stock<2147483647',[business.id,redemption.reward_id]);
   const reversalId=randomUUID(),adjustmentId=randomUUID();
   // Match service recovery: restoring spent points is a balance adjustment,
   // not newly earned points. The neutral transaction links immutable history.
   await client.query('INSERT INTO ledger_balance_adjustments(id,business_id,customer_id,created_by_staff_id,reason,delta_points,delta_pending_points,delta_lifetime_points) VALUES($1,$2,$3,$4,$5,$6,0,0)',[adjustmentId,business.id,row.customer_id,row.staff_user_id,`Cancelación de carrito ${row.request_id}: ${v.reason}`,redemption.points_cost]);
   await client.query("INSERT INTO transactions(id,business_id,branch_id,customer_id,staff_user_id,type,amount_q,points,source,original_transaction_id,meta) VALUES($1,$2,$3,$4,$5,'ADJUSTMENT',0,0,'pos_checkout_cancel',$6,$7)",[reversalId,business.id,row.branch_id,row.customer_id,row.staff_user_id,debit[0].id,{redemption_id:row.redemption_id,adjustment_id:adjustmentId,points_restored:redemption.points_cost,original_transaction_id:debit[0].id,checkout_request_id:row.request_id,cancel_request_id:v.cancelRequestId,reason:v.reason}]);
   await client.query('UPDATE transactions SET reversed_transaction_id=$2 WHERE id=$1',[debit[0].id,reversalId]);
   await client.query("UPDATE redemptions SET status='CANCELLED' WHERE business_id=$1 AND id=$2",[business.id,row.redemption_id]);
   await client.query("UPDATE redemption_pos_records SET status='reviewed',version=version+1,updated_at=now() WHERE business_id=$1 AND redemption_id=$2",[business.id,row.redemption_id]);
   const updated=(await client.query("UPDATE pos_checkout_intents SET status='cancelled',cancel_request_id=$2,cancel_fingerprint=$3,cancel_reason=$4,reversal_id=$5,cancelled_at=now(),updated_at=now() WHERE id=$1 RETURNING *",[row.id,v.cancelRequestId,hash,v.reason,reversalId])).rows[0];
   await fulfillmentAudit(client,{business_id:business.id,id:row.staff_user_id},'pos.checkout.cancelled',{request_id:row.request_id,cancel_request_id:v.cancelRequestId,redemption_id:row.redemption_id,reversal_id:reversalId,reason:v.reason});
   return checkoutResponse(updated);
  }
  await client.query('SELECT id FROM businesses WHERE id=$1 FOR SHARE',[business.id]);
  await checkoutSource(client,business.id,v,{enabled:false});
  const tombstone=(await client.query("INSERT INTO pos_checkout_intents(id,business_id,source,branch_id,request_id,cart_id,cart_line_id,status,cancel_request_id,cancel_fingerprint,cancel_reason,cancelled_at) VALUES($1,$2,$3,$4,$5,$6,$7,'cancelled',$8,$9,$10,now()) RETURNING *",[randomUUID(),business.id,v.source,v.branchId,v.requestId,v.cartId,v.cartLineId,v.cancelRequestId,hash,v.reason])).rows[0];
  return checkoutResponse(tombstone);
 });}catch(e){if(e?.code==='23505')throw conflict('La referencia de cancelación o línea ya fue usada.');throw e;}
}
