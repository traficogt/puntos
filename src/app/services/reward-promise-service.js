import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {withTransaction} from '../database.js';
import {badRequest,conflict,forbidden,notFound} from '../../utils/http-error.js';
import {withImpersonationMeta} from '../../utils/impersonation.js';
import {businessRegion} from './regional-settings.js';
import {snapshotCompletedRedemption} from './reward-economics-service.js';
import {assertNoPendingCheckout} from './pos-checkout-guard.js';
import {assertRewardInventory} from './reward-inventory-service.js';
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const requestIdentity=value=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw badRequest('La solicitud necesita un identificador válido.');return value.toLowerCase();};
export async function promiseAudit(client,{businessId,staff},action,meta){await client.query("INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,meta) VALUES($1,$2,'STAFF',$3,$4,$5)",[randomUUID(),businessId,staff.id,action,withImpersonationMeta(meta,staff)]);}
export async function livePromiseMember(client,{businessId,staff},owner=false){
 if(staff?.business_id!==businessId)throw forbidden('Tu sesión no pertenece a este negocio.');
 const {rows}=await client.query('SELECT id,role,branch_id FROM staff_users WHERE id=$1 AND business_id=$2 AND active FOR SHARE',[staff.id,businessId]);
 const member=rows[0];if(!member||!['OWNER','MANAGER','CASHIER'].includes(member.role)||owner&&member.role!=='OWNER'||(member.branch_id??null)!==(staff.branch_id??null))throw forbidden('La autorización del equipo cambió. Ingresa nuevamente.');return member;
}
export async function lockPromiseRequest(client,businessId,requestId){await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[businessId,requestId]);}
/** Business then balance: edits lock the business before snapshotting progress. */
export async function protectedEarningBusiness(client,{business,customerId}){
 const {rows}=await client.query('SELECT * FROM businesses WHERE id=$1 FOR SHARE',[business.id]);
 if(!rows[0])throw notFound('Negocio no encontrado.');
 await client.query('SELECT customer_id FROM customer_balances WHERE customer_id=$1 FOR UPDATE',[customerId]);
 const cycle=(await client.query('SELECT id,program_type,earning_terms FROM reward_promise_cycles WHERE business_id=$1 AND customer_id=$2 AND completed_at IS NULL',[business.id,customerId])).rows[0];
 const current={...business,...rows[0]};return cycle?{...current,program_type:cycle.program_type,program_json:{...current.program_json,...cycle.earning_terms},reward_promise_cycle_id:cycle.id}:current;
}
export async function completeProtectedCycle(client,{businessId,customerId,redemptionId,pointsCost,cycleId=undefined}){
 if(pointsCost<=0||cycleId===null)return;
 await client.query('UPDATE reward_promise_cycles SET completed_at=clock_timestamp(),completed_redemption_id=$3 WHERE business_id=$1 AND customer_id=$2 AND completed_at IS NULL'+(cycleId?' AND id=$4':''),[businessId,customerId,redemptionId,...(cycleId?[cycleId]:[])]);
}
export async function listCustomerEntitlements({businessId,customerId},injected={}){
 return (injected.transaction??withTransaction)(async client=>{
  const customer=(await client.query('SELECT c.id,cb.points,cb.pending_points FROM customers c JOIN customer_balances cb ON cb.customer_id=c.id WHERE c.id=$1 AND c.business_id=$2 AND c.deleted_at IS NULL',[customerId,businessId])).rows[0];if(!customer)throw notFound('Cliente no encontrado.');
  const cycle=(await client.query('SELECT * FROM reward_promise_cycles WHERE business_id=$1 AND customer_id=$2 AND completed_at IS NULL',[businessId,customerId])).rows[0]??null;
  const promises=cycle?(await client.query(`SELECT p.*,GREATEST(p.valid_until,(SELECT max(e.extended_until) FROM reward_promise_extensions e WHERE e.business_id=p.business_id AND e.promise_id=p.id)) AS effective_valid_until,r.stock,COALESCE(a.available,true) AS available,COALESCE(a.alternative_reward_ids,'{}'::uuid[]) AS alternative_reward_ids,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ar.id,'name',ar.name,'stock',ar.stock)) FROM rewards ar WHERE ar.business_id=p.business_id AND ar.id=ANY(a.alternative_reward_ids) AND ar.active),'[]'::jsonb) AS alternatives
   FROM customer_reward_promises p JOIN rewards r ON r.id=p.reward_id LEFT JOIN reward_availability a ON a.business_id=p.business_id AND a.reward_id=p.reward_id WHERE p.cycle_id=$1 ORDER BY p.points_cost,p.reward_name`,[cycle.id])).rows:[];
  const hospitality=(await client.query(`SELECT e.id,e.title,e.reward_name,e.description,e.reward_id,e.branch_id,e.issued_at,e.expires_at,r.stock,COALESCE(a.available,true) AS available,f.redemption_id
   FROM hospitality_entitlements e JOIN rewards r ON r.id=e.reward_id LEFT JOIN reward_availability a ON a.business_id=e.business_id AND a.reward_id=e.reward_id LEFT JOIN reward_entitlement_fulfillments f ON f.hospitality_id=e.id
   WHERE e.business_id=$1 AND e.customer_id=$2 ORDER BY e.issued_at DESC LIMIT 100`,[businessId,customerId])).rows;
  const business=(await client.query('SELECT program_json FROM businesses WHERE id=$1',[businessId])).rows[0];
  return {ok:true,region:businessRegion(business),cycle,promises,hospitality,points:Number(customer.points),pending_points:Number(customer.pending_points),server_now:new Date().toISOString()};
 });
}
export async function configureRewardAvailability(options,injected={}){
 const {businessId,rewardId,available,alternativeRewardIds=[]}=options;
 if(typeof available!=='boolean'||!Array.isArray(alternativeRewardIds)||alternativeRewardIds.length>5||new Set(alternativeRewardIds).size!==alternativeRewardIds.length||alternativeRewardIds.includes(rewardId))throw badRequest('Revisa la disponibilidad y hasta cinco alternativas.');
 return (injected.transaction??withTransaction)(async client=>{
  await livePromiseMember(client,options,true);
  await client.query('SELECT id FROM businesses WHERE id=$1 FOR UPDATE',[businessId]);
  const rewards=(await client.query('SELECT id FROM rewards WHERE business_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[businessId,[rewardId,...alternativeRewardIds]])).rows;
  if(rewards.length!==alternativeRewardIds.length+1)throw notFound('Una recompensa no pertenece al negocio.');
  await client.query(`INSERT INTO reward_availability(business_id,reward_id,available,alternative_reward_ids,updated_by_staff_id) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(business_id,reward_id) DO UPDATE SET available=EXCLUDED.available,alternative_reward_ids=EXCLUDED.alternative_reward_ids,updated_by_staff_id=EXCLUDED.updated_by_staff_id,updated_at=clock_timestamp()`,[businessId,rewardId,available,alternativeRewardIds,options.staff.id]);
  await promiseAudit(client,options,'reward.availability.update',{reward_id:rewardId,available,alternative_reward_ids:alternativeRewardIds});return {ok:true};
 });
}
export async function getRewardPromisesOverview(options,injected={}){
 return (injected.transaction??withTransaction)(async client=>{await livePromiseMember(client,options,true);const rewards=(await client.query(`SELECT r.id,r.name,r.points_cost,r.stock,r.active,COALESCE(a.available,true) AS available,COALESCE(a.alternative_reward_ids,'{}'::uuid[]) AS alternative_reward_ids,
 (SELECT count(*)::int FROM customer_reward_promises p JOIN reward_promise_cycles c ON c.id=p.cycle_id WHERE p.business_id=r.business_id AND p.reward_id=r.id AND c.completed_at IS NULL) AS protected_customers
 FROM rewards r LEFT JOIN reward_availability a ON a.business_id=r.business_id AND a.reward_id=r.id WHERE r.business_id=$1 ORDER BY r.name LIMIT 200`,[options.businessId])).rows;
 const history=(await client.query(`SELECT f.*,r.code,r.points_cost,p.reward_name AS promised_name,h.title AS hospitality_title,f.fulfilled_reward_name AS fulfilled_name FROM reward_entitlement_fulfillments f JOIN redemptions r ON r.id=f.redemption_id LEFT JOIN customer_reward_promises p ON p.id=f.promise_id LEFT JOIN hospitality_entitlements h ON h.id=f.hospitality_id JOIN rewards actual ON actual.id=f.fulfilled_reward_id WHERE f.business_id=$1 ORDER BY f.created_at DESC LIMIT 100`,[options.businessId])).rows;
 const business=(await client.query('SELECT program_json FROM businesses WHERE id=$1',[options.businessId])).rows[0];return {ok:true,region:businessRegion(business),rewards,history};});
}
export async function redeemEntitlement(options,injected={}){
 const {businessId,staff,customerId,promiseId=null,hospitalityId=null,fulfillmentRewardId=null,customerAccepted=false}=options;
 if(Boolean(promiseId)===Boolean(hospitalityId))throw badRequest('Selecciona un beneficio.');
 const requestId=requestIdentity(options.requestId),hash=fingerprint([staff.id,customerId,promiseId,hospitalityId,fulfillmentRewardId,customerAccepted]);
 return (injected.transaction??withTransaction)(async client=>{
  await lockPromiseRequest(client,businessId,requestId);const member=await livePromiseMember(client,options);
  const replay=(await client.query(`SELECT f.payload_fingerprint,r.id,r.code,r.points_cost,r.balance_after,f.fulfilled_reward_name AS name FROM reward_entitlement_fulfillments f JOIN redemptions r ON r.id=f.redemption_id JOIN rewards rw ON rw.id=r.reward_id WHERE f.business_id=$1 AND f.request_id=$2`,[businessId,requestId])).rows[0];
  if(replay){if(replay.payload_fingerprint!==hash)throw conflict('El identificador ya corresponde a otro canje.');return {ok:true,redemptionId:replay.id,redemptionCode:replay.code,pointsCost:replay.points_cost,newBalance:replay.balance_after,rewardName:replay.name,replay:true};}
  const entitlement=promiseId?(await client.query(`SELECT p.*,c.customer_id,c.completed_at FROM customer_reward_promises p JOIN reward_promise_cycles c ON c.id=p.cycle_id WHERE p.business_id=$1 AND p.id=$2`,[businessId,promiseId])).rows[0]:(await client.query('SELECT * FROM hospitality_entitlements WHERE business_id=$1 AND id=$2',[businessId,hospitalityId])).rows[0];
  if(!entitlement||entitlement.customer_id!==customerId)throw notFound('Beneficio no encontrado.');
  const actualId=fulfillmentRewardId??entitlement.reward_id;
  const business=(await client.query('SELECT * FROM businesses WHERE id=$1 FOR SHARE',[businessId])).rows[0];
  const locked=(await client.query('SELECT * FROM rewards WHERE business_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[businessId,[...new Set([actualId,entitlement.reward_id])]])).rows;
  const reward=locked.find(row=>row.id===actualId);if(!reward)throw notFound('Recompensa no encontrada.');
  const balance=(await client.query('SELECT points FROM customer_balances WHERE customer_id=$1 FOR UPDATE',[customerId])).rows[0];
  await assertNoPendingCheckout(client,{business,customerId});
  if(business.program_json?.pos_inventory_checks===true)await assertRewardInventory(client,{businessId,rewardId:actualId,branchId:member.branch_id??null});
  const customer=(await client.query('SELECT id FROM customers WHERE id=$1 AND business_id=$2 AND deleted_at IS NULL FOR SHARE',[customerId,businessId])).rows[0];if(!customer||!balance)throw notFound('Cliente no encontrado.');
  if(promiseId){const cycle=(await client.query('SELECT completed_at FROM reward_promise_cycles WHERE id=$1',[entitlement.cycle_id])).rows[0];if(cycle.completed_at)throw conflict('Este ciclo ya terminó.');}
  else if((await client.query('SELECT id FROM reward_entitlement_fulfillments WHERE hospitality_id=$1',[hospitalityId])).rowCount)throw conflict('La cortesía ya fue entregada.');
  const expiration=promiseId?await effectivePromiseExpiration(client,businessId,promiseId,entitlement.valid_until):entitlement.expires_at;
  const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;if(expiration&&new Date(expiration)<=new Date(now))throw conflict('El beneficio venció.');
  const scope=promiseId?entitlement.branch_ids:entitlement.branch_id?[entitlement.branch_id]:[];
  if(scope.length&&!scope.includes(member.branch_id))throw forbidden('El beneficio corresponde a otra sucursal.');
  const availability=(await client.query('SELECT * FROM reward_availability WHERE business_id=$1 AND reward_id=$2',[businessId,entitlement.reward_id])).rows[0];
  const substituted=actualId!==entitlement.reward_id;
  if(substituted){if(!customerAccepted)throw badRequest('Confirma que el cliente acepta la alternativa.');if(hospitalityId||!availability?.alternative_reward_ids?.includes(actualId))throw forbidden('Esta alternativa no está aprobada.');if(!reward.active||reward.valid_until&&new Date(reward.valid_until)<=new Date(now))throw conflict('La alternativa no está disponible.');
   const branches=(await client.query('SELECT branch_id FROM reward_branches WHERE reward_id=$1',[actualId])).rows.map(x=>x.branch_id);if(branches.length&&!branches.includes(member.branch_id))throw forbidden('La alternativa no corresponde a esta sucursal.');
  }else if(availability?.available===false)throw conflict('La recompensa está temporalmente no disponible.');
  const actualAvailability=(await client.query('SELECT available FROM reward_availability WHERE business_id=$1 AND reward_id=$2',[businessId,actualId])).rows[0];if(actualAvailability?.available===false)throw conflict('La recompensa está temporalmente no disponible.');
  if(hospitalityId){const cost=(await client.query('SELECT unit_cost_q FROM reward_unit_costs WHERE business_id=$1 AND reward_id=$2',[businessId,actualId])).rows[0]?.unit_cost_q;if(cost==null||Number(cost)>Number(entitlement.unit_cost_limit))throw conflict('El costo actual necesita una nueva aprobación del dueño.');}
  if(promiseId)await assertProtectedRedemptionGuards(client,{business,customerId,rewardId:entitlement.reward_id});
  const pointsCost=promiseId?entitlement.points_cost:0;
  if(Number(balance.points)<pointsCost)throw conflict('Todavía faltan puntos disponibles.');
  if(reward.stock!==null&&reward.stock!==undefined){const stock=await client.query('UPDATE rewards SET stock=stock-1 WHERE id=$1 AND stock>0 RETURNING stock',[actualId]);if(stock.rowCount!==1)throw conflict('La recompensa está agotada.');}
  const updated=await client.query('UPDATE customer_balances SET points=points-$2,updated_at=now() WHERE customer_id=$1 RETURNING points',[customerId,pointsCost]);
  const redemptionId=randomUUID(),code=randomBytes(8).toString('hex').toUpperCase();
  await client.query(`INSERT INTO redemptions(id,business_id,branch_id,reward_id,customer_id,staff_user_id,code,points_cost,status,redeemed_at,request_id,balance_after) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'REDEEMED',clock_timestamp(),$9,$10)`,[redemptionId,businessId,member.branch_id,actualId,customerId,staff.id,code,pointsCost,requestId,updated.rows[0].points]);
  await snapshotCompletedRedemption(client,{businessId,redemptionId});
  await client.query(`INSERT INTO transactions(id,business_id,branch_id,customer_id,staff_user_id,amount_q,points,source,meta) VALUES($1,$2,$3,$4,$5,0,$6,'redeem',$7)`,[randomUUID(),businessId,member.branch_id,customerId,staff.id,-pointsCost,{redemption_id:redemptionId,reward_id:actualId,promise_id:promiseId,hospitality_id:hospitalityId,request_id:requestId}]);
  await client.query(`INSERT INTO reward_entitlement_fulfillments(id,business_id,promise_id,hospitality_id,redemption_id,original_reward_id,fulfilled_reward_id,customer_accepted,request_id,payload_fingerprint,fulfilled_reward_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[randomUUID(),businessId,promiseId,hospitalityId,redemptionId,entitlement.reward_id,actualId,customerAccepted,requestId,hash,substituted?reward.name:entitlement.reward_name]);
  await completeProtectedCycle(client,{businessId,customerId,redemptionId,pointsCost});
  await promiseAudit(client,options,'reward.entitlement.fulfill',{redemption_id:redemptionId,promise_id:promiseId,hospitality_id:hospitalityId,original_reward_id:entitlement.reward_id,fulfilled_reward_id:actualId,customer_accepted:customerAccepted,points_cost:pointsCost});
  return {ok:true,redemptionId,redemptionCode:code,pointsCost,newBalance:updated.rows[0].points,rewardName:substituted?reward.name:entitlement.reward_name,replay:false};
 });
}
/** Legacy/native callers also honor the active cycle without changing payloads. */
export async function protectedRedemptionReward(client,{businessId,customerId,reward}){
 await client.query('SELECT customer_id FROM customer_balances WHERE customer_id=$1 FOR UPDATE',[customerId]);
 const terms=(await client.query(`SELECT p.* FROM customer_reward_promises p JOIN reward_promise_cycles c ON c.id=p.cycle_id WHERE p.business_id=$1 AND c.customer_id=$2 AND p.reward_id=$3 AND c.completed_at IS NULL`,[businessId,customerId,reward.id])).rows[0];
 const availability=(await client.query('SELECT available FROM reward_availability WHERE business_id=$1 AND reward_id=$2',[businessId,reward.id])).rows[0];if(availability?.available===false)throw conflict('La recompensa está temporalmente no disponible.');
 return terms?{...reward,name:terms.reward_name,description:terms.description,points_cost:terms.points_cost,valid_until:await effectivePromiseExpiration(client,businessId,terms.id,terms.valid_until),active:true,promise_id:terms.id,protected_branch_ids:terms.branch_ids}:reward;
}
export async function completeLegacyProtectedRedemption(client,{businessId,staff,customerId,redemptionId,reward,pointsCost,requestId,cycleId=undefined}){
 if(reward.promise_id){
  await client.query(`INSERT INTO reward_entitlement_fulfillments(id,business_id,promise_id,redemption_id,original_reward_id,fulfilled_reward_id,customer_accepted,request_id,payload_fingerprint,fulfilled_reward_name) VALUES($1,$2,$3,$4,$5,$5,false,$6,$7,$8)`,[randomUUID(),businessId,reward.promise_id,redemptionId,reward.id,requestId??redemptionId,fingerprint([staff.id,customerId,reward.id,requestId]),reward.name]);
  await promiseAudit(client,{businessId,staff},'reward.promise.fulfill',{redemption_id:redemptionId,promise_id:reward.promise_id,points_cost:pointsCost});
 }
 await completeProtectedCycle(client,{businessId,customerId,redemptionId,pointsCost,cycleId});
}

export async function lockProtectedRedemptionBusiness(client,businessId){return (await client.query('SELECT id,program_json FROM businesses WHERE id=$1 FOR SHARE',[businessId])).rows[0];}

export async function assertProtectedRedemptionGuards(client,{business,customerId,rewardId}){
 const guard=business.program_json?.redemption_guard??{},daily=Math.max(0,Math.floor(Number(guard.max_redemptions_per_day??0))),perReward=Math.max(0,Math.floor(Number(guard.max_reward_redemptions_per_day??0))),cooldown=Math.max(0,Math.floor(Number(guard.reward_cooldown_hours??0)));
 if(!daily&&!perReward&&!cooldown)return;
 const row=(await client.query(`SELECT count(*) FILTER(WHERE r.created_at>=((clock_timestamp() AT TIME ZONE $4)::date::timestamp AT TIME ZONE $4))::int AS daily,
 count(*) FILTER(WHERE COALESCE(f.original_reward_id,r.reward_id)=$3 AND r.created_at>=((clock_timestamp() AT TIME ZONE $4)::date::timestamp AT TIME ZONE $4))::int AS reward_daily,
 COALESCE(bool_or(COALESCE(f.original_reward_id,r.reward_id)=$3 AND r.created_at>clock_timestamp()-make_interval(hours=>$5::int)),false) AS cooldown
 FROM redemptions r LEFT JOIN reward_entitlement_fulfillments f ON f.redemption_id=r.id WHERE r.business_id=$1 AND r.customer_id=$2 AND r.status<>'CANCELLED'`,[business.id,customerId,rewardId,businessRegion(business).timezone,cooldown])).rows[0];
 if(daily&&row.daily>=daily||perReward&&row.reward_daily>=perReward||cooldown&&row.cooldown)throw conflict('El límite o período de espera de canjes sigue vigente.');
}

export async function protectedRedemptionName(client,redemptionId){return (await client.query('SELECT fulfilled_reward_name FROM reward_entitlement_fulfillments WHERE redemption_id=$1',[redemptionId])).rows[0]?.fulfilled_reward_name;}

/** Additional permission is append-only; the original issued terms remain unchanged. */
export async function extendRewardPromise(options,injected={}){
 const {businessId,staff,promiseId,extendedUntil}=options,requestId=requestIdentity(options.requestId),reason=String(options.reason??'').trim(),until=new Date(extendedUntil);
 requestIdentity(promiseId);if(reason.length<3||reason.length>500||!Number.isFinite(+until))throw badRequest('Indica el motivo y la nueva fecha.');
 const payload=fingerprint([staff.id,promiseId,until.toISOString(),reason]);
 return (injected.transaction??withTransaction)(async client=>{
  const member=await livePromiseMember(client,options);await lockPromiseRequest(client,businessId,requestId);
  const prior=(await client.query('SELECT * FROM reward_promise_extensions WHERE business_id=$1 AND request_id=$2',[businessId,requestId])).rows[0];if(prior){if(prior.payload_fingerprint!==payload)throw conflict('La referencia ya pertenece a otra extensión.');return {ok:true,extension:prior,replay:true};}
  const promise=(await client.query('SELECT p.*,c.completed_at FROM customer_reward_promises p JOIN reward_promise_cycles c ON c.id=p.cycle_id WHERE p.business_id=$1 AND p.id=$2 FOR UPDATE OF c',[businessId,promiseId])).rows[0];
  if(!promise)throw notFound('Promesa no encontrada.');if(promise.completed_at)throw conflict('El ciclo de esta promesa ya terminó.');if(promise.branch_ids.length&&!promise.branch_ids.includes(member.branch_id)&&member.role!=='OWNER')throw forbidden('La promesa corresponde a otra sucursal.');
  const previous=await effectivePromiseExpiration(client,businessId,promiseId,promise.valid_until),now=new Date((await client.query('SELECT clock_timestamp() AS now')).rows[0].now);
  if(!previous)throw conflict('La promesa ya está vigente sin vencimiento.');
  if(until<=new Date(previous)||until<=now||until>new Date(+now+90*86400000))throw badRequest('La extensión debe ampliar la fecha y quedar dentro de los próximos 90 días.');
  await (await import('./staff-delegation-service.js')).consumeStaffAuthority(client,{merchantId:businessId,staffId:staff.id,staff,action:'extend_promise',locationId:member.branch_id??null,referenceType:'promise_extension',referenceId:requestId});
  const extension=(await client.query('INSERT INTO reward_promise_extensions(id,business_id,promise_id,previous_valid_until,extended_until,reason,actor_staff_id,request_id,payload_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[randomUUID(),businessId,promiseId,previous,until,reason,staff.id,requestId,payload])).rows[0];
  await promiseAudit(client,options,'reward.promise.extend',{extension_id:extension.id,promise_id:promiseId,previous_valid_until:previous,extended_until:until,reason});return {ok:true,extension,replay:false};
 });
}
export async function effectivePromiseExpiration(client,businessId,promiseId,original){
 if(!original)return null;
 const extension=(await client.query('SELECT max(extended_until) AS extended_until FROM reward_promise_extensions WHERE business_id=$1 AND promise_id=$2',[businessId,promiseId])).rows[0]?.extended_until;
 return extension&&new Date(extension)>new Date(original)?extension:original;
}
