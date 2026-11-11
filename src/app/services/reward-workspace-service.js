import { dateTimeSchema } from '../../utils/date-time-schema.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {withTransaction} from '../database.js';
import {badRequest,conflict,forbidden,notFound} from '../../utils/http-error.js';
import {planFeaturesWithOverrides,planLimits} from '../../utils/plan.js';
import {PlanConfigService} from './plan-config-service.js';
import {businessRegion,assertRegionAmount} from './regional-settings.js';
import {livePromiseMember,promiseAudit,lockPromiseRequest,fingerprint} from './reward-promise-service.js';
import {saveRewardPosMapping} from './reward-pos-mapping-service.js';
import {catalogInventory} from './reward-inventory-service.js';
const uuid=z.guid().transform(value=>value.toLowerCase());
const text=max=>z.string().max(max).refine(value=>!/[\u0000-\u001f\u007f]/u.test(value));
const quantity=z.number().finite().positive().max(1000000).refine(value=>Math.abs(value*1e6-Math.round(value*1e6))<0.00001);
const cost=z.number().finite().min(0).max(1000000).refine(value=>Math.abs(value*100-Math.round(value*100))<0.000001).nullable();
const mappingSchema=z.object({catalogItemId:uuid,branchId:uuid.nullable(),quantity,inventoryRequired:z.boolean(),enabled:z.boolean(),id:uuid.optional(),version:z.number().int().min(0).max(2147483646)}).strict();
const rewardSchema=z.object({name:text(150).transform(value=>value.trim()).refine(value=>value.length>0),description:z.string().max(1000).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)).nullable(),points_cost:z.number().int().min(1).max(2147483647),active:z.boolean(),stock:z.number().int().min(0).max(2147483647).nullable(),valid_until:dateTimeSchema({offset:true}).transform(value=>new Date(value).toISOString()).nullable(),branch_ids:z.array(uuid).max(200).refine(value=>new Set(value).size===value.length).transform(value=>value.sort())}).strict();
export const rewardWorkspaceSchema=z.object({requestId:uuid,rewardId:uuid.optional(),version:z.string().regex(/^[a-f0-9]{64}$/).optional(),reward:rewardSchema,unitCostQ:cost.optional(),available:z.boolean(),mapping:mappingSchema.nullable().optional()}).strict().refine(value=>Boolean(value.rewardId)===Boolean(value.version));
export function normalizeRewardWorkspace(input){const parsed=rewardWorkspaceSchema.safeParse(input);if(!parsed.success)throw badRequest('Revisa la recompensa, costo, disponibilidad y vínculo antes de guardar.');return parsed.data;}
const iso=value=>value?new Date(value).toISOString():null;
function mappingVersion(row){return{id:row.id,source:row.source,branch_id:row.branch_id,product_ref:row.product_ref,item_name:row.item_name,item_kind:row.item_kind,quantity:Number(row.quantity),enabled:row.enabled,inventory_required:row.inventory_required,version:row.version,updated_at:iso(row.updated_at)};}
function publicReward(row){
 const mappings=row.mappings.map(mapping=>({...mappingVersion(mapping),catalog_item_id:mapping.catalog_item_id??null,sku:mapping.sku??null,origin:mapping.origin??null,inventory:catalogInventory({itemKind:mapping.catalog_kind??mapping.item_kind,origin:mapping.origin,active:mapping.catalog_active??true,quantity:mapping.available_quantity,observedAt:mapping.inventory_observed_at,now:new Date(row.checked_at).getTime(),requiredQuantity:Number(mapping.quantity)})}));
 const reward={id:row.id,name:row.name,description:row.description,points_cost:row.points_cost,active:row.active,stock:row.stock,valid_until:iso(row.valid_until),branch_ids:row.branch_ids,unit_cost_q:row.unit_cost_q===null?null:Number(row.unit_cost_q),available:row.available,mappings};
 const version=fingerprint({...reward,mappings:row.mappings.map(mappingVersion),costUpdatedAt:iso(row.cost_updated_at),availabilityUpdatedAt:iso(row.availability_updated_at),alternativeRewardIds:row.alternative_reward_ids});
 return{...reward,version};
}
async function readRewards(client,businessId,rewardId=null){
 const rows=(await client.query(`SELECT r.*,c.unit_cost_q,c.updated_at AS cost_updated_at,COALESCE(a.available,true) AS available,a.updated_at AS availability_updated_at,COALESCE(a.alternative_reward_ids,'{}'::uuid[]) AS alternative_reward_ids,clock_timestamp() AS checked_at,
 ARRAY(SELECT rb.branch_id FROM reward_branches rb WHERE rb.reward_id=r.id ORDER BY rb.branch_id) AS branch_ids,
 COALESCE((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('catalog_item_id',ci.id,'sku',ci.sku,'origin',ci.origin,'catalog_kind',ci.item_kind,'catalog_active',ci.active,'available_quantity',s.available_quantity,'inventory_observed_at',s.observed_at) ORDER BY m.source,m.id)
 FROM reward_pos_mappings m LEFT JOIN merchant_catalog_items ci ON ci.business_id=m.business_id AND ci.source=m.source AND ci.product_ref=m.product_ref
 LEFT JOIN merchant_inventory_snapshots s ON s.business_id=m.business_id AND s.source=m.source AND s.product_ref=m.product_ref AND s.branch_id=m.branch_id
 WHERE m.business_id=r.business_id AND m.reward_id=r.id),'[]'::jsonb) AS mappings
 FROM rewards r LEFT JOIN reward_unit_costs c ON c.business_id=r.business_id AND c.reward_id=r.id LEFT JOIN reward_availability a ON a.business_id=r.business_id AND a.reward_id=r.id
 WHERE r.business_id=$1 AND ($2::uuid IS NULL OR r.id=$2) ORDER BY r.created_at DESC,r.id LIMIT 10000`,[businessId,rewardId])).rows;
 return rows.map(publicReward);
}
async function workspaceBusiness(client,businessId,overrides,lock='FOR SHARE'){
 const business=(await client.query(`SELECT * FROM businesses WHERE id=$1 ${lock}`,[businessId])).rows[0];if(!business)throw notFound('Negocio no encontrado.');
 return{business,features:planFeaturesWithOverrides(business.plan,overrides),region:businessRegion(business)};
}
export async function getRewardWorkspace({businessId,staff},injected={}){
 const overrides=await (injected.getPlanFeatureOverrides??(()=>PlanConfigService.getPlanFeatureOverrides()))();
 return (injected.transaction??withTransaction)(async client=>{
  await livePromiseMember(client,{businessId,staff},true);
  const {features,region}=await workspaceBusiness(client,businessId,overrides);if(!features.rewards)throw forbidden('Tu plan no incluye recompensas.');
  const rewards=await readRewards(client,businessId),branches=(await client.query('SELECT id,name FROM branches WHERE business_id=$1 ORDER BY name,id',[businessId])).rows;
  return{ok:true,rewards,branches,features,region};
 });
}
async function saveMapping(client,{businessId,staff,rewardId,mapping,features,branchIds}){
 const existing=(await client.query('SELECT * FROM reward_pos_mappings WHERE business_id=$1 AND reward_id=$2 ORDER BY source FOR UPDATE',[businessId,rewardId])).rows;
 const item=(await client.query('SELECT * FROM merchant_catalog_items WHERE business_id=$1 AND id=$2 FOR SHARE',[businessId,mapping.catalogItemId])).rows[0];if(!item||mapping.enabled&&!item.active)throw badRequest('Selecciona un artículo activo del catálogo de este negocio.');
 const old=mapping.id?existing.find(row=>row.id===mapping.id):existing.find(row=>row.source===item.source);
 if(mapping.id&&!old||(old?.version??0)!==mapping.version||!mapping.id&&old)throw conflict('El vínculo cambió. Actualiza antes de guardar.');
 if(branchIds.length&&(!mapping.branchId||!branchIds.includes(mapping.branchId)))throw badRequest('La sucursal del vínculo debe estar incluida en la recompensa.');
 const value={source:item.source,branchId:mapping.branchId,productRef:item.product_ref,itemName:item.name,itemKind:item.item_kind,quantity:mapping.quantity,enabled:mapping.enabled,inventoryRequired:mapping.inventoryRequired,version:mapping.version};
 const unchanged=old&&old.source===value.source&&(old.branch_id??null)===value.branchId&&old.product_ref===value.productRef&&old.item_name===value.itemName&&old.item_kind===value.itemKind&&Number(old.quantity)===value.quantity&&old.enabled===value.enabled&&old.inventory_required===value.inventoryRequired;
 if(unchanged)return;
 if((item.origin==='connector'||old&&!['catalog:manual','catalog:csv'].includes(old.source))&&!features.external_awards)throw forbidden('Tu plan no incluye cambios a vínculos de una caja conectada.');
 if(old&&old.source!==item.source){
  if(existing.some(row=>row.source===item.source))throw conflict('Ya existe un vínculo de este origen. Edita ese vínculo.');
  // Preserve the old source identity for existing receipt evidence, replacing it
  // atomically with a separate mapping for the newly selected source.
  await saveRewardPosMapping({businessId,staff,rewardId,input:{source:old.source,branchId:old.branch_id,productRef:old.product_ref,itemName:old.item_name,itemKind:old.item_kind,quantity:Number(old.quantity),enabled:false,inventoryRequired:false,version:old.version}},{transaction:fn=>fn(client)});
  value.version=0;
 }
 await saveRewardPosMapping({businessId,staff,rewardId,input:value},{transaction:fn=>fn(client)});
}
export async function saveRewardWorkspace({businessId,staff,input},injected={}){
 const value=normalizeRewardWorkspace(input),hash=fingerprint(value),overrides=await (injected.getPlanFeatureOverrides??(()=>PlanConfigService.getPlanFeatureOverrides()))();
 return (injected.transaction??withTransaction)(async client=>{
  await livePromiseMember(client,{businessId,staff},true);await lockPromiseRequest(client,businessId,value.requestId);
  const previous=(await client.query('SELECT fingerprint,response FROM reward_workspace_requests WHERE business_id=$1 AND request_id=$2',[businessId,value.requestId])).rows[0];
  if(previous){if(previous.fingerprint!==hash)throw conflict('Esta solicitud ya corresponde a otros datos.');return{...previous.response,replay:true};}
  // This lock must precede every reward/branch edit: promise capture locks current
  // balances while earning and redemption flows hold the shared business lock.
  const {business,features,region}=await workspaceBusiness(client,businessId,overrides,'FOR UPDATE');if(!features.rewards)throw forbidden('Tu plan no incluye recompensas.');
  const rewardId=value.rewardId??randomUUID();
  let old=null;
  if(value.rewardId){
   if(!(await client.query('SELECT id FROM rewards WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,rewardId])).rowCount)throw notFound('Recompensa no encontrada.');
   old=(await readRewards(client,businessId,rewardId))[0];if(old.version!==value.version)throw conflict('La recompensa cambió. Actualiza antes de guardar.');
  }else{
   const count=(await client.query('SELECT count(*)::integer AS count FROM rewards WHERE business_id=$1',[businessId])).rows[0].count;
   if(count>=planLimits(business.plan).rewards)throw forbidden('Tu plan alcanzó el límite de recompensas.');
  }
  const branches=value.reward.branch_ids;
  if(branches.length&&(await client.query('SELECT id FROM branches WHERE business_id=$1 AND id=ANY($2::uuid[]) FOR SHARE',[businessId,branches])).rowCount!==branches.length)throw badRequest('Selecciona sucursales de este negocio.');
  const costChanged=Object.hasOwn(value,'unitCostQ')&&value.unitCostQ!==(old?.unit_cost_q??null);
  if(costChanged&&!features.analytics)throw forbidden('Tu plan no incluye cambios al costo de entrega.');
  if(costChanged&&value.unitCostQ!==null)assertRegionAmount(value.unitCostQ,region.currency,business);
  const reward=value.reward,args=[businessId,rewardId,reward.name,reward.description,reward.points_cost,old?reward.active:false,reward.stock,reward.valid_until];
  if(old)await client.query('UPDATE rewards SET name=$3,description=$4,points_cost=$5,active=$6,stock=$7,valid_until=$8 WHERE business_id=$1 AND id=$2',args);
  else await client.query('INSERT INTO rewards(business_id,id,name,description,points_cost,active,stock,valid_until) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',args);
  if(!old||JSON.stringify(old.branch_ids)!==JSON.stringify(branches)){
   await client.query('DELETE FROM reward_branches WHERE reward_id=$1',[rewardId]);for(const branchId of branches)await client.query('INSERT INTO reward_branches(reward_id,branch_id) VALUES($1,$2)',[rewardId,branchId]);
  }
  if(!old&&reward.active)await client.query('UPDATE rewards SET active=true WHERE business_id=$1 AND id=$2',[businessId,rewardId]);
  if(costChanged)await client.query(`INSERT INTO reward_unit_costs(business_id,reward_id,unit_cost_q,updated_by_staff_id) VALUES($1,$2,$3,$4) ON CONFLICT(business_id,reward_id) DO UPDATE SET unit_cost_q=EXCLUDED.unit_cost_q,updated_by_staff_id=EXCLUDED.updated_by_staff_id,updated_at=clock_timestamp()`,[businessId,rewardId,value.unitCostQ,staff.id]);
  if(value.available!==(old?.available??true))await client.query(`INSERT INTO reward_availability(business_id,reward_id,available,updated_by_staff_id) VALUES($1,$2,$3,$4) ON CONFLICT(business_id,reward_id) DO UPDATE SET available=EXCLUDED.available,updated_by_staff_id=EXCLUDED.updated_by_staff_id,updated_at=clock_timestamp()`,[businessId,rewardId,value.available,staff.id]);
  if(value.mapping)await saveMapping(client,{businessId,staff,rewardId,mapping:value.mapping,features,branchIds:branches});
  const saved=(await readRewards(client,businessId,rewardId))[0];
  await promiseAudit(client,{businessId,staff},'reward.workspace.saved',{reward_id:rewardId,request_id:value.requestId,version:saved.version,created:!old,cost_changed:costChanged,mapping_changed:Boolean(value.mapping)});
  const response={ok:true,reward:saved,replay:false};await client.query('INSERT INTO reward_workspace_requests(business_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4)',[businessId,value.requestId,hash,JSON.stringify(response)]);
  return response;
 });
}
