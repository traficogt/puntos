import {randomUUID} from 'node:crypto';
import {badRequest,conflict} from '../../utils/http-error.js';
import {markRewardInventoryWallets} from './reward-inventory-service.js';
import {fulfillmentFingerprint} from './redemption-pos-model.js';
export const publicCatalogItem=row=>({id:row.id,source:row.source,productRef:row.product_ref,sku:row.sku,name:row.name,itemKind:row.item_kind,active:row.active,origin:row.origin,revision:row.revision,observedAt:row.observed_at?new Date(row.observed_at).toISOString():null});
export async function catalogBranch(client,businessId,branchId){if(branchId&&!(await client.query('SELECT id FROM branches WHERE business_id=$1 AND id=$2',[businessId,branchId])).rowCount)throw badRequest('Selecciona una sucursal de este negocio.');}
export async function catalogRequest(client,{businessId,source,requestId,operation,input}){
 // Event/source foreign keys need this lock later; acquire it before catalog
 // rows so owner workspace edits cannot form the reverse lock dependency.
 await client.query('SELECT id FROM businesses WHERE id=$1 FOR KEY SHARE',[businessId]);
 await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[businessId,`catalog:${source}`]);
 const fingerprint=fulfillmentFingerprint({operation,input});
 const old=(await client.query('SELECT fingerprint,result FROM merchant_catalog_events WHERE business_id=$1 AND source=$2 AND request_id=$3',[businessId,source,requestId])).rows[0];
 if(old&&old.fingerprint!==fingerprint)throw conflict('Esta solicitud ya se usó con otros datos.');
 return {fingerprint,replay:old?{...old.result,replay:true}:null};
}
export async function catalogEvent(client,{businessId,source,requestId,operation,input,fingerprint,result,actor=null}){
 await client.query('INSERT INTO merchant_catalog_events(id,business_id,source,request_id,operation,fingerprint,actor_staff_id,observed_at,details,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),businessId,source,requestId,operation,fingerprint,actor?.id??null,input.observedAt??null,JSON.stringify(input),JSON.stringify(result)]);
 if(['catalog','inventory'].includes(operation)){
  const affected=await client.query('SELECT id FROM reward_pos_mappings WHERE business_id=$1 AND source=$2 AND product_ref=ANY($3::text[]) AND enabled AND inventory_required AND ($4::uuid IS NULL OR branch_id=$4) LIMIT 1',[businessId,source,input.items.map(item=>item.productRef),input.branchId??null]);
  if(affected.rowCount)await markRewardInventoryWallets(client,businessId);
 }
}
export async function checkObservation(client,observedAt){
 const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
 if(new Date(observedAt).getTime()>new Date(now).getTime())throw badRequest('La observación no puede estar en el futuro.');
}
export async function catalogSource(client,{businessId,source,origin,scope='catalog',branchId=null,observedAt=null}){
 const old=(await client.query('SELECT * FROM merchant_catalog_sources WHERE business_id=$1 AND source=$2 AND scope=$3 AND branch_id IS NOT DISTINCT FROM $4::uuid FOR UPDATE',[businessId,source,scope,branchId])).rows[0];
 if(old?.origin&&old.origin!==origin)throw conflict('El origen de este catálogo no coincide.');
 if(observedAt&&old?.observed_at&&new Date(observedAt)<new Date(old.observed_at))throw conflict('La observación es anterior a la última recibida.');
 if(old)await client.query('UPDATE merchant_catalog_sources SET observed_at=$2,updated_at=now() WHERE id=$1',[old.id,observedAt]);
 else await client.query('INSERT INTO merchant_catalog_sources(id,business_id,source,scope,branch_id,origin,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),businessId,source,scope,branchId,origin,observedAt]);
}
export async function writeCatalogItem(client,{businessId,source,origin,item,observedAt=null}){
 const old=(await client.query('SELECT * FROM merchant_catalog_items WHERE business_id=$1 AND source=$2 AND product_ref=$3 FOR UPDATE',[businessId,source,item.productRef])).rows[0];
 if(old&&old.origin!==origin)throw conflict('No se puede reemplazar la procedencia de un artículo.');
 if(origin!=='connector'&&(old?.revision??0)!==item.revision)throw conflict('El artículo cambió. Actualiza su revisión antes de guardar.');
 if(old?.observed_at&&observedAt&&new Date(observedAt)<=new Date(old.observed_at)){
  const same=old.sku===(item.sku??null)&&old.name===item.name&&old.item_kind===item.itemKind&&old.active===item.active;
  if(new Date(observedAt)<new Date(old.observed_at)||!same)throw conflict('El artículo tiene una observación igual o más reciente.');
  return publicCatalogItem(old);
 }
 const args=[businessId,source,item.productRef,item.sku??null,item.name,item.itemKind,item.active,origin,observedAt];
 const row=old?(await client.query('UPDATE merchant_catalog_items SET sku=$4,name=$5,item_kind=$6,active=$7,origin=$8,observed_at=$9,revision=revision+1,updated_at=now() WHERE business_id=$1 AND source=$2 AND product_ref=$3 RETURNING *',args)).rows[0]:(await client.query('INSERT INTO merchant_catalog_items(business_id,source,product_ref,sku,name,item_kind,active,origin,observed_at,id,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1) RETURNING *',[...args,randomUUID()])).rows[0];
 return publicCatalogItem(row);
}
