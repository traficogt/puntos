import {conflict} from '../../utils/http-error.js';
export const INVENTORY_FRESH_SECONDS=300;
export function catalogInventory({itemKind,origin,active=true,quantity=null,observedAt=null,now=Date.now(),requiredQuantity=1}){
 if(itemKind==='service')return{state:'not_applicable',quantity:null,observedAt:null};
 const observed=observedAt?new Date(observedAt).getTime():null;
 const value=quantity===null||quantity===undefined?null:Number(quantity);
 let state='unknown';
 if(!active)state='unavailable';
 else if(origin==='connector'&&observed!==null){
  if(observed>now||value===null)state='unknown';
  else if(now-observed>INVENTORY_FRESH_SECONDS*1000)state='stale';
  else if(value!==null)state=value>=requiredQuantity?'available':'unavailable';
 }
 return{state,quantity:origin==='connector'?value:null,observedAt:origin==='connector'&&observed!==null?new Date(observed).toISOString():null};
}
export async function getRewardInventory(client,{businessId,rewardId,branchId=null}){
 const rows=(await client.query(`SELECT m.source,m.product_ref,m.quantity,c.item_kind,c.origin,c.active,s.available_quantity,s.observed_at,clock_timestamp() AS checked_at
 FROM reward_pos_mappings m LEFT JOIN merchant_catalog_items c ON c.business_id=m.business_id AND c.source=m.source AND c.product_ref=m.product_ref
 LEFT JOIN merchant_inventory_snapshots s ON s.business_id=m.business_id AND s.source=m.source AND s.product_ref=m.product_ref AND s.branch_id=m.branch_id
 WHERE m.business_id=$1 AND m.reward_id=$2 AND ($3::uuid IS NULL OR m.branch_id=$3::uuid) AND m.enabled AND m.inventory_required`,[businessId,rewardId,branchId])).rows;
 if(!rows.length)return{state:'not_required',required:false,quantity:null,requiredQuantity:null,observedAt:null,source:null,productRef:null};
 const row=rows[0],evidence=catalogInventory({itemKind:row.item_kind,origin:row.origin,active:row.active??true,quantity:row.available_quantity,observedAt:row.observed_at,now:new Date(row.checked_at).getTime(),requiredQuantity:Number(row.quantity)});
 if(branchId===null||rows.length!==1||row.item_kind==='service')evidence.state='unknown';
 return{...evidence,required:true,requiredQuantity:Number(row.quantity),source:row.source,productRef:row.product_ref};
}
export async function assertRewardInventory(client,input){
 const inventory=await getRewardInventory(client,input);
 if(!['not_required','available'].includes(inventory.state))throw conflict(inventory.state==='unavailable'?'El artículo no tiene existencias suficientes en esta sucursal.':'Falta una comprobación reciente de existencias. Actualiza la caja antes de canjear.');
 return inventory;
}

// The existing Wallet pass trigger allocates revisions and queues asynchronous
// refresh work. Keep this in the same transaction as inventory evidence.
export async function markRewardInventoryWallets(client,businessId){
 await client.query('UPDATE native_wallet_passes SET revision=revision+1 WHERE business_id=$1 AND revoked_at IS NULL',[businessId]);
}
