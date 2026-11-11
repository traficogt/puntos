import {withTransaction} from '../database.js';
import {badRequest,conflict} from '../../utils/http-error.js';
import {fulfillmentActor,fulfillmentAudit} from './redemption-pos-store.js';
import {MANUAL_CATALOG_SOURCE,CSV_CATALOG_SOURCE,normalizeCatalogSync,normalizeInventorySnapshot,normalizeManualCatalogItem,normalizeCatalogCsvBody,normalizeCatalogImport,normalizeCatalogCsv,catalogListSchema} from './merchant-catalog-model.js';
import {publicCatalogItem,catalogBranch,catalogRequest,catalogEvent,checkObservation,catalogSource,writeCatalogItem} from './merchant-catalog-store.js';
import {catalogInventory} from './reward-inventory-service.js';
export async function saveManualCatalogItem({businessId,staff,input},injected={}){
 const value=normalizeManualCatalogItem(input),source=MANUAL_CATALOG_SOURCE;
 return (injected.transaction??withTransaction)(async client=>{
  const actor=await fulfillmentActor(client,businessId,staff,true);
  const request={businessId,source,requestId:value.requestId,operation:'manual',input:value};
  const {fingerprint,replay}=await catalogRequest(client,request);if(replay)return replay;
  await catalogSource(client,{businessId,source,origin:'manual'});
  const item=await writeCatalogItem(client,{businessId,source,origin:'manual',item:value});
  const result={ok:true,item};await catalogEvent(client,{...request,fingerprint,result,actor});
  await fulfillmentAudit(client,actor,'merchant.catalog.saved',{catalog_item_id:item.id,revision:item.revision});return result;
 });
}
export async function previewCatalogCsv({businessId,staff,input},injected={}){
 const {csv}=normalizeCatalogCsvBody(input),items=normalizeCatalogCsv(csv);
 return (injected.transaction??withTransaction)(async client=>{
  await fulfillmentActor(client,businessId,staff,true);
  const old=(await client.query('SELECT product_ref,revision FROM merchant_catalog_items WHERE business_id=$1 AND source=$2 AND product_ref=ANY($3::text[])',[businessId,CSV_CATALOG_SOURCE,items.map(item=>item.productRef)])).rows;
  const revisions=new Map(old.map(item=>[item.product_ref,item.revision]));
  return{ok:true,items:items.map(item=>({...item,source:CSV_CATALOG_SOURCE,origin:'csv',currentRevision:revisions.get(item.productRef)??0})),rowCount:items.length};
 });
}
export async function importCatalogCsv({businessId,staff,input},injected={}){
 const value=normalizeCatalogImport(input),items=normalizeCatalogCsv(value.csv),source=CSV_CATALOG_SOURCE;
 return (injected.transaction??withTransaction)(async client=>{
  const actor=await fulfillmentActor(client,businessId,staff,true);
  const request={businessId,source,requestId:value.requestId,operation:'csv',input:value};
  const {fingerprint,replay}=await catalogRequest(client,request);if(replay)return replay;
  await catalogSource(client,{businessId,source,origin:'csv'});
  const imported=[];for(const item of items)imported.push(await writeCatalogItem(client,{businessId,source,origin:'csv',item}));
  const result={ok:true,items:imported,rowCount:imported.length};await catalogEvent(client,{...request,fingerprint,result,actor});
  await fulfillmentAudit(client,actor,'merchant.catalog.imported',{request_id:value.requestId,item_count:imported.length});return result;
 });
}
export async function syncMerchantCatalog(business,input,injected={}){
 const value=normalizeCatalogSync(input),businessId=business.id,{source,requestId,observedAt}=value;
 return (injected.transaction??withTransaction)(async client=>{
  const request={businessId,source,requestId,operation:'catalog',input:value};
  const {fingerprint,replay}=await catalogRequest(client,request);if(replay)return replay;
  await checkObservation(client,observedAt);await catalogSource(client,{businessId,source,origin:'connector',observedAt});
  const items=[];for(const item of value.items)items.push(await writeCatalogItem(client,{businessId,source,origin:'connector',item,observedAt}));
  const result={ok:true,items,rowCount:items.length};await catalogEvent(client,{...request,fingerprint,result});return result;
 });
}
export async function recordInventorySnapshot(business,input,injected={}){
 const value=normalizeInventorySnapshot(input),businessId=business.id,{source,requestId,branchId,observedAt}=value;
 return (injected.transaction??withTransaction)(async client=>{
  const request={businessId,source,requestId,operation:'inventory',input:value};
  const {fingerprint,replay}=await catalogRequest(client,request);if(replay)return replay;
  await catalogBranch(client,businessId,branchId);await checkObservation(client,observedAt);
  await catalogSource(client,{businessId,source,origin:'connector',scope:'inventory',branchId,observedAt});
  for(const item of value.items){
   const catalog=(await client.query('SELECT item_kind,origin FROM merchant_catalog_items WHERE business_id=$1 AND source=$2 AND product_ref=$3',[businessId,source,item.productRef])).rows[0];
   if(!catalog||catalog.origin!=='connector')throw badRequest('Sincroniza el artículo de este origen antes de sus existencias.');
   if(catalog.item_kind==='service'&&item.availableQuantity!==null)throw badRequest('Los servicios no tienen existencias de producto.');
   const old=(await client.query('SELECT available_quantity,observed_at FROM merchant_inventory_snapshots WHERE business_id=$1 AND source=$2 AND branch_id=$3 AND product_ref=$4 FOR UPDATE',[businessId,source,branchId,item.productRef])).rows[0];
   if(old&&new Date(observedAt)<=new Date(old.observed_at)){
    if(new Date(observedAt)<new Date(old.observed_at)||(old.available_quantity===null?null:Number(old.available_quantity))!==item.availableQuantity)throw conflict('El artículo tiene existencias observadas con fecha igual o posterior.');
    continue;
   }
   await client.query('INSERT INTO merchant_inventory_snapshots(business_id,source,branch_id,product_ref,available_quantity,observed_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(business_id,source,branch_id,product_ref) DO UPDATE SET available_quantity=EXCLUDED.available_quantity,observed_at=EXCLUDED.observed_at,updated_at=now()',[businessId,source,branchId,item.productRef,item.availableQuantity,observedAt]);
  }
  const result={ok:true,rowCount:value.items.length,observedAt};await catalogEvent(client,{...request,fingerprint,result});return result;
 });
}
export async function listMerchantCatalog({businessId,staff,query='',source=undefined,branchId=undefined,offset=0,limit=30},injected={}){
 const normalized=catalogListSchema.safeParse({query,...(source===undefined?{}:{source}),...(branchId===undefined?{}:{branchId}),offset:String(offset),limit:String(limit)});
 if(!normalized.success)throw badRequest('Revisa la búsqueda, sucursal y paginación del catálogo.');
 ({query,source,branchId,offset,limit}=normalized.data);
 return (injected.transaction??withTransaction)(async client=>{
  await fulfillmentActor(client,businessId,staff,true);await catalogBranch(client,businessId,branchId);
  const rows=(await client.query(`SELECT c.*,s.available_quantity,s.observed_at AS inventory_observed_at,clock_timestamp() AS checked_at FROM merchant_catalog_items c
  LEFT JOIN merchant_inventory_snapshots s ON s.business_id=c.business_id AND s.source=c.source AND s.product_ref=c.product_ref AND s.branch_id=$2
  WHERE c.business_id=$1 AND ($3::text IS NULL OR c.source=$3) AND ($4='' OR strpos(lower(c.name),lower($4))>0 OR strpos(lower(COALESCE(c.sku,'')),lower($4))>0 OR strpos(lower(c.product_ref),lower($4))>0)
  ORDER BY lower(c.name),c.id OFFSET $5 LIMIT $6`,[businessId,branchId??null,source??null,query,offset,limit+1])).rows;
  const sources=(await client.query(`SELECT s.source,s.origin,s.observed_at,count(c.id)::integer AS item_count FROM merchant_catalog_sources s LEFT JOIN merchant_catalog_items c ON c.business_id=s.business_id AND c.source=s.source WHERE s.business_id=$1 AND s.scope='catalog' GROUP BY s.id ORDER BY s.source`,[businessId])).rows.map(row=>({source:row.source,origin:row.origin,itemCount:row.item_count,observedAt:row.observed_at?new Date(row.observed_at).toISOString():null}));
  return{ok:true,items:rows.slice(0,limit).map(row=>({...publicCatalogItem(row),inventory:catalogInventory({itemKind:row.item_kind,origin:row.origin,active:row.active,quantity:row.available_quantity,observedAt:row.inventory_observed_at,now:new Date(row.checked_at).getTime()})})),sources,offset,limit,hasMore:rows.length>limit};
 });
}
