import {randomUUID} from 'node:crypto';
import {withTransaction} from '../database.js';
import {conflict,notFound,badRequest} from '../../utils/http-error.js';
import {normalizeRewardPosMapping,normalizeMappingLookup} from './redemption-pos-model.js';
import {fulfillmentActor,fulfillmentAudit,publicMapping} from './redemption-pos-store.js';
import {markRewardInventoryWallets} from './reward-inventory-service.js';
import {businessRegion} from './regional-settings.js';
export async function getRewardPosMappings({businessId,staff},injected={}){
 return (injected.transaction??withTransaction)(async client=>{
  await fulfillmentActor(client,businessId,staff,true);
  const rewards=(await client.query('SELECT id,name,active FROM rewards WHERE business_id=$1 ORDER BY name,id',[businessId])).rows;
  const branches=(await client.query('SELECT id,name FROM branches WHERE business_id=$1 ORDER BY name,id',[businessId])).rows;
  const mappings=(await client.query('SELECT * FROM reward_pos_mappings WHERE business_id=$1 ORDER BY reward_id,source',[businessId])).rows.map(publicMapping);
  return{ok:true,rewards,branches,mappings};
 });
}
export async function saveRewardPosMapping({businessId,staff,rewardId,input},injected={}){
 const value=normalizeRewardPosMapping(input);
 if(!/^[a-f0-9-]{36}$/i.test(rewardId??''))throw badRequest('Recompensa inválida.');
 return (injected.transaction??withTransaction)(async client=>{
  const actor=await fulfillmentActor(client,businessId,staff,true);
  // Match reward workspace and protected redemption lock order before updating
  // the business inventory-check flag below.
  await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[businessId]);
  const reward=(await client.query('SELECT id FROM rewards WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,rewardId])).rows[0];if(!reward)throw notFound('Recompensa no encontrada.');
  if(value.branchId&&!(await client.query('SELECT id FROM branches WHERE business_id=$1 AND id=$2',[businessId,value.branchId])).rowCount)throw badRequest('Selecciona una sucursal de este negocio.');
  const old=(await client.query('SELECT * FROM reward_pos_mappings WHERE business_id=$1 AND reward_id=$2 AND source=$3 FOR UPDATE',[businessId,rewardId,value.source])).rows[0];
  if((old?.version??0)!==value.version)throw conflict('El vínculo cambió. Actualiza antes de guardar.');
  const inventoryRequired=value.inventoryRequired??old?.inventory_required??false;
  if(inventoryRequired){
   if(value.itemKind!=='product'||!value.branchId)throw badRequest('La comprobación de existencias necesita un producto y una sucursal.');
   const item=(await client.query('SELECT item_kind,active,origin FROM merchant_catalog_items WHERE business_id=$1 AND source=$2 AND product_ref=$3',[businessId,value.source,value.productRef])).rows[0];
   if(!item||item.item_kind!=='product'||item.origin!=='connector'||(value.enabled&&!item.active))throw badRequest('Selecciona un producto activo sincronizado por una caja.');
   if(value.enabled&&(await client.query('SELECT id FROM reward_pos_mappings WHERE business_id=$1 AND reward_id=$2 AND branch_id=$3 AND enabled AND inventory_required AND source<>$4',[businessId,rewardId,value.branchId,value.source])).rowCount)throw conflict('Esta recompensa ya comprueba otro producto en esta sucursal.');
  }
  const args=[businessId,rewardId,value.source,value.branchId,value.productRef,value.itemName,value.itemKind,value.quantity,value.enabled,inventoryRequired];
  const row=old?(await client.query('UPDATE reward_pos_mappings SET branch_id=$4,product_ref=$5,item_name=$6,item_kind=$7,quantity=$8,enabled=$9,inventory_required=$10,version=version+1,updated_at=now() WHERE business_id=$1 AND reward_id=$2 AND source=$3 RETURNING *',args)).rows[0]:(await client.query('INSERT INTO reward_pos_mappings(business_id,reward_id,source,branch_id,product_ref,item_name,item_kind,quantity,enabled,inventory_required,id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[...args,randomUUID()])).rows[0];
  if(inventoryRequired&&value.enabled)await client.query("UPDATE businesses SET program_json=jsonb_set(COALESCE(program_json,'{}'::jsonb),'{pos_inventory_checks}','true'::jsonb,true) WHERE id=$1",[businessId]);
  if(inventoryRequired&&value.enabled||old?.inventory_required&&old.enabled)await markRewardInventoryWallets(client,businessId);
  await fulfillmentAudit(client,actor,'reward.pos_mapping.saved',{mapping_id:row.id,reward_id:rewardId,version:row.version,source:value.source,enabled:value.enabled});return{ok:true,mapping:publicMapping(row)};
 });
}
export async function getPosRewardMappings(business,input,injected={}){
 const {source}=normalizeMappingLookup(input);
 return (injected.transaction??withTransaction)(async client=>{
  const rows=(await client.query('SELECT m.*,w.name AS reward_name FROM reward_pos_mappings m JOIN rewards w ON w.id=m.reward_id AND w.business_id=m.business_id WHERE m.business_id=$1 AND m.source=$2 AND m.enabled ORDER BY m.reward_id',[business.id,source])).rows;
  return{ok:true,currency:businessRegion(business).currency,mappings:rows.map(publicMapping)};
 });
}
