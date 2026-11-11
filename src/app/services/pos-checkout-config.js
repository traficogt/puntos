import {withTransaction} from '../database.js';import {fulfillmentActor,fulfillmentAudit} from './redemption-pos-store.js';import {normalizeCheckoutSource} from './pos-checkout-model.js';import {badRequest,conflict,forbidden,notFound} from '../../utils/http-error.js';import {hasPlanFeature} from '../../utils/plan.js';import {PlanConfigService} from './plan-config-service.js';
export async function checkoutFeatureBusiness(client,businessId,overrides={}, {requireConnection=false}={}){const b=(await client.query('SELECT * FROM businesses WHERE id=$1 FOR SHARE',[businessId])).rows[0];if(!b)throw notFound('Negocio no encontrado.');if(requireConnection&&(b.program_json?.pos_integration?.enabled!==true||b.program_json?.external_awards?.enabled!==true))throw forbidden('La conexión POS está desactivada.');for(const f of ['external_awards','redemptions'])if(!hasPlanFeature(b.plan,f,overrides))throw forbidden('Tu plan no incluye canjes desde una caja conectada.');return b;}
export async function checkoutSource(client,businessId,input,{enabled=true}={}){
 const row=(await client.query('SELECT * FROM pos_checkout_sources WHERE business_id=$1 AND source=$2 FOR SHARE',[businessId,input.source])).rows[0];
 if(!row||(row.branch_id??null)!==(input.branchId??null))throw forbidden('Esta caja y sucursal no están autorizadas para canjear.');
 if(enabled&&!row.enabled)throw forbidden('Activa los canjes desde esta caja en el panel del propietario.');
 const staff=(await client.query('SELECT id,business_id,branch_id,role,active FROM staff_users WHERE business_id=$1 AND id=$2 FOR SHARE',[businessId,row.staff_user_id])).rows[0];
 if(enabled&&(!staff?.active||!['OWNER','MANAGER','CASHIER'].includes(staff.role)||(staff.branch_id??null)!==(row.branch_id??null)))throw forbidden('La cuenta responsable de esta caja necesita revisión.');
 return{config:row,staff};
}
export async function getCheckoutSources({businessId,staff},injected={}){
 const overrides=await (injected.getPlanFeatureOverrides??(()=>PlanConfigService.getPlanFeatureOverrides()))();
 return(injected.transaction??withTransaction)(async client=>{await fulfillmentActor(client,businessId,staff,true);const b=(await client.query('SELECT * FROM businesses WHERE id=$1',[businessId])).rows[0];return{ok:true,sources:(await client.query('SELECT * FROM pos_checkout_sources WHERE business_id=$1 ORDER BY source',[businessId])).rows,catalog_sources:(await client.query('SELECT source FROM merchant_catalog_sources WHERE business_id=$1 ORDER BY source',[businessId])).rows,branches:(await client.query('SELECT id,name FROM branches WHERE business_id=$1 ORDER BY name',[businessId])).rows,staff:(await client.query('SELECT id,name,role,branch_id,active FROM staff_users WHERE business_id=$1 AND active ORDER BY name',[businessId])).rows,features:Object.fromEntries(['external_awards','redemptions'].map(f=>[f,hasPlanFeature(b.plan,f,overrides)]))};});
}
export async function configureCheckoutSource({businessId,staff,input},injected={}){
 const v=normalizeCheckoutSource(input),overrides=await(injected.getPlanFeatureOverrides??(()=>PlanConfigService.getPlanFeatureOverrides()))();
 return(injected.transaction??withTransaction)(async client=>{const actor=await fulfillmentActor(client,businessId,staff,true);await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[businessId]);await checkoutFeatureBusiness(client,businessId,overrides);
 const chosen=(await client.query('SELECT id,branch_id FROM staff_users WHERE business_id=$1 AND id=$2 AND active AND role IN(\'OWNER\',\'MANAGER\',\'CASHIER\')',[businessId,v.staffId])).rows[0];if(!chosen||(chosen.branch_id??null)!==(v.branchId??null))throw badRequest('Selecciona una cuenta activa de la misma sucursal.');
 if(v.branchId&&!(await client.query('SELECT id FROM branches WHERE business_id=$1 AND id=$2',[businessId,v.branchId])).rowCount)throw badRequest('Sucursal inválida.');
 const old=(await client.query('SELECT * FROM pos_checkout_sources WHERE business_id=$1 AND source=$2 FOR UPDATE',[businessId,v.source])).rows[0];if((old?.version??0)!==v.version)throw conflict('La conexión cambió. Actualiza sus datos.');
 if(old&&(old.branch_id??null)!==(v.branchId??null))throw conflict('La sucursal del origen es fija. Usa otro origen para otra caja.');
 const row=(await client.query(`INSERT INTO pos_checkout_sources(business_id,source,branch_id,staff_user_id,enabled) VALUES($1,$2,$3,$4,$5) ON CONFLICT(business_id,source) DO UPDATE SET staff_user_id=EXCLUDED.staff_user_id,enabled=EXCLUDED.enabled,version=pos_checkout_sources.version+1,updated_at=now() RETURNING *`,[businessId,v.source,v.branchId,v.staffId,v.enabled])).rows[0];
 if(v.enabled)await client.query("UPDATE businesses SET program_json=jsonb_set(program_json,'{pos_checkout_enabled}','true') WHERE id=$1",[businessId]);
 await fulfillmentAudit(client,actor,'pos.checkout.configuration',{source:v.source,branch_id:v.branchId,staff_user_id:v.staffId,enabled:v.enabled});return{ok:true,source:row};});
}
