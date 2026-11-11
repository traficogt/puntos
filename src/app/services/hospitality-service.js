import {businessRegion,assertRegionAmount} from './regional-settings.js';
import {randomUUID} from 'node:crypto';
import {withTransaction} from '../database.js';
import {badRequest,conflict,forbidden,notFound} from '../../utils/http-error.js';
import {fingerprint,requestIdentity,promiseAudit,livePromiseMember,lockPromiseRequest} from './reward-promise-service.js';
const money=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1000000&&Math.abs(value*100-Math.round(value*100))<0.000001;
export async function createHospitalityGrant(options,injected={}){
 const {businessId,staff,staffId,branchId=null,rewardId,title,totalUnits,totalCost,unitCostLimit,validHours}=options;
 const requestId=requestIdentity(options.requestId),starts=new Date(options.startsAt),ends=new Date(options.endsAt);
 if(!Number.isFinite(starts.getTime())||!Number.isFinite(ends.getTime())||ends<=starts||ends.getTime()-starts.getTime()>31*86400000||!Number.isInteger(totalUnits)||totalUnits<1||totalUnits>10000||!money(totalCost)||!money(unitCostLimit)||unitCostLimit>totalCost||!Number.isInteger(validHours)||validHours<1||validHours>2160||typeof title!=='string'||!title.trim()||title.length>100)throw badRequest('Revisa los límites, el nombre y la vigencia de la cortesía.');
 const hash=fingerprint([staff.id,staffId,branchId,rewardId,title.trim(),totalUnits,totalCost,unitCostLimit,starts.toISOString(),ends.toISOString(),validHours]);
 return (injected.transaction??withTransaction)(async client=>{
  await lockPromiseRequest(client,businessId,requestId);await livePromiseMember(client,options,true);
  const existing=(await client.query('SELECT * FROM hospitality_grants WHERE business_id=$1 AND request_id=$2',[businessId,requestId])).rows[0];if(existing){if(existing.payload_fingerprint!==hash)throw conflict('La solicitud ya tiene otros límites.');return {ok:true,grant:existing,replay:true};}
  const member=(await client.query("SELECT id,branch_id FROM staff_users WHERE business_id=$1 AND id=$2 AND active AND role IN ('OWNER','MANAGER','CASHIER') FOR SHARE",[businessId,staffId])).rows[0];if(!member||branchId&&member.branch_id!==branchId)throw badRequest('Selecciona una persona y su sucursal actual.');
  if(branchId&&!(await client.query('SELECT id FROM branches WHERE business_id=$1 AND id=$2',[businessId,branchId])).rowCount)throw badRequest('Sucursal no encontrada.');
  const business=(await client.query('SELECT program_json FROM businesses WHERE id=$1 FOR SHARE',[businessId])).rows[0];assertRegionAmount(totalCost,businessRegion(business).currency,business);assertRegionAmount(unitCostLimit,businessRegion(business).currency,business);
  const reward=(await client.query('SELECT r.*,c.unit_cost_q FROM rewards r LEFT JOIN reward_unit_costs c ON c.business_id=r.business_id AND c.reward_id=r.id WHERE r.business_id=$1 AND r.id=$2 FOR UPDATE OF r',[businessId,rewardId])).rows[0];
  if(!reward||!reward.active||reward.unit_cost_q==null||Number(reward.unit_cost_q)>unitCostLimit)throw badRequest('La recompensa necesita un costo conocido dentro del límite aprobado.');
  const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;if(ends<=new Date(now))throw badRequest('La autorización ya venció.');
  const {rows}=await client.query(`INSERT INTO hospitality_grants(id,business_id,staff_id,branch_id,reward_id,title,total_units,total_cost,unit_cost_limit,starts_at,ends_at,valid_hours,request_id,payload_fingerprint,created_by_staff_id,reward_name,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,[randomUUID(),businessId,staffId,branchId,rewardId,title.trim(),totalUnits,totalCost,unitCostLimit,starts,ends,validHours,requestId,hash,staff.id,reward.name,reward.description]);
  await promiseAudit(client,options,'hospitality.grant.create',{grant_id:rows[0].id,reward_id:rewardId,total_units:totalUnits,total_cost:totalCost,unit_cost_limit:unitCostLimit,currency:businessRegion(business).currency});return {ok:true,grant:rows[0],replay:false};
 });
}
export async function revokeHospitalityGrant(options,injected={}){
 return (injected.transaction??withTransaction)(async client=>{await livePromiseMember(client,options,true);const result=await client.query('UPDATE hospitality_grants SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE business_id=$1 AND id=$2 RETURNING id',[options.businessId,options.grantId]);if(!result.rowCount)throw notFound('Autorización no encontrada.');await promiseAudit(client,options,'hospitality.grant.revoke',{grant_id:options.grantId});return {ok:true};});
}
export async function issueHospitality(options,injected={}){
 const {businessId,staff,grantId,customerId}=options,requestId=requestIdentity(options.requestId),hash=fingerprint([staff.id,grantId,customerId]);
 return (injected.transaction??withTransaction)(async client=>{
  await lockPromiseRequest(client,businessId,requestId);const member=await livePromiseMember(client,options);
  const existing=(await client.query('SELECT * FROM hospitality_entitlements WHERE business_id=$1 AND request_id=$2',[businessId,requestId])).rows[0];if(existing){if(existing.payload_fingerprint!==hash)throw conflict('La solicitud ya corresponde a otra cortesía.');return {ok:true,entitlement:existing,replay:true};}
  const grant=(await client.query('SELECT * FROM hospitality_grants WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,grantId])).rows[0];
  if(!grant||grant.staff_id!==staff.id||grant.branch_id&&grant.branch_id!==member.branch_id)throw forbidden('No tienes esta autorización en tu sucursal.');
  const reward=(await client.query('SELECT r.*,c.unit_cost_q FROM rewards r LEFT JOIN reward_unit_costs c ON c.business_id=r.business_id AND c.reward_id=r.id WHERE r.business_id=$1 AND r.id=$2 FOR UPDATE OF r',[businessId,grant.reward_id])).rows[0];
  if(!reward||!reward.active||reward.unit_cost_q==null||Number(reward.unit_cost_q)>Number(grant.unit_cost_limit))throw conflict('La recompensa necesita una nueva aprobación de costo.');
  const scope=(await client.query('SELECT branch_id FROM reward_branches WHERE reward_id=$1',[reward.id])).rows.map(x=>x.branch_id);if(scope.length&&!scope.includes(member.branch_id))throw forbidden('La recompensa corresponde a otra sucursal.');
  const availability=(await client.query('SELECT available FROM reward_availability WHERE business_id=$1 AND reward_id=$2',[businessId,reward.id])).rows[0];
  if(availability?.available===false||reward.stock!==null&&reward.stock<=0)throw conflict('La recompensa no está disponible para nuevas cortesías.');
  const now=new Date((await client.query('SELECT clock_timestamp() AS now')).rows[0].now);
  if(grant.revoked_at||now<new Date(grant.starts_at)||now>=new Date(grant.ends_at))throw forbidden('La autorización no está vigente.');
  if(reward.valid_until&&new Date(reward.valid_until)<=now)throw conflict('La recompensa venció.');
  // Reserve the per-item ceiling, so future approved fulfillment cannot exceed
  // the owner budget even if the item's known cost rises before redemption.
  const consumed=await client.query('UPDATE hospitality_grants SET used_units=used_units+1,used_cost=used_cost+unit_cost_limit WHERE id=$1 AND used_units<total_units AND used_cost+unit_cost_limit<=total_cost RETURNING id',[grantId]);if(!consumed.rowCount)throw forbidden('La autorización agotó sus unidades o presupuesto.');
  const customer=await client.query('SELECT id FROM customers WHERE id=$1 AND business_id=$2 AND deleted_at IS NULL FOR SHARE',[customerId,businessId]);if(!customer.rowCount)throw notFound('Cliente no encontrado.');
  const expires=new Date(now.getTime()+grant.valid_hours*3600000);
  const {rows}=await client.query(`INSERT INTO hospitality_entitlements(id,business_id,grant_id,customer_id,issued_by_staff_id,branch_id,reward_id,reward_name,description,title,unit_cost_limit,approved_cost,expires_at,request_id,payload_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[randomUUID(),businessId,grantId,customerId,staff.id,grant.branch_id??member.branch_id,grant.reward_id,grant.reward_name,grant.description,grant.title,grant.unit_cost_limit,reward.unit_cost_q,expires,requestId,hash]);
  await promiseAudit(client,options,'hospitality.issue',{entitlement_id:rows[0].id,grant_id:grantId,customer_id:customerId,reserved_cost:Number(grant.unit_cost_limit)});return {ok:true,entitlement:rows[0],replay:false};
 });
}
export async function listHospitality(options,injected={}){
 return (injected.transaction??withTransaction)(async client=>{const member=await livePromiseMember(client,options,options.owner===true),own=options.owner!==true;
 // Owner totals cover every entitlement, independently of the paged history.
 // The immutable fulfillment cost snapshot is the only historical cost source.
 const grants=(await client.query(own?`SELECT g.*,s.name AS staff_name,(g.total_units-g.used_units) AS remaining_units,(g.total_cost-g.used_cost) AS remaining_cost FROM hospitality_grants g JOIN rewards r ON r.id=g.reward_id JOIN staff_users s ON s.id=g.staff_id WHERE g.business_id=$1 AND g.staff_id=$2 AND (g.branch_id IS NULL OR g.branch_id=$3) ORDER BY g.created_at DESC LIMIT 100`:`
 WITH snapshot AS MATERIALIZED (SELECT statement_timestamp() AS at), totals AS (
  SELECT e.grant_id,count(*)::int AS issued,
   count(f.id)::int AS fulfilled,
   count(*) FILTER(WHERE f.id IS NULL AND e.expires_at<=snapshot.at)::int AS expired_unused,
   count(*) FILTER(WHERE f.id IS NULL AND e.expires_at>snapshot.at)::int AS pending,
   sum(c.unit_cost_q) FILTER(WHERE f.id IS NOT NULL) AS fulfilled_known_cost,
   count(*) FILTER(WHERE f.id IS NOT NULL AND c.unit_cost_q IS NOT NULL)::int AS fulfilled_cost_known_units,
   count(*) FILTER(WHERE f.id IS NOT NULL AND c.unit_cost_q IS NULL)::int AS fulfilled_cost_unknown_units
  FROM hospitality_entitlements e CROSS JOIN snapshot
  LEFT JOIN reward_entitlement_fulfillments f ON f.business_id=e.business_id AND f.hospitality_id=e.id
  LEFT JOIN redemption_cost_snapshots c ON c.business_id=f.business_id AND c.redemption_id=f.redemption_id
  WHERE e.business_id=$1 GROUP BY e.grant_id
 )
 SELECT g.*,s.name AS staff_name,(g.total_units-g.used_units) AS remaining_units,(g.total_cost-g.used_cost) AS remaining_cost,snapshot.at AS report_as_of,
  jsonb_build_object('issued',COALESCE(t.issued,0),'fulfilled',COALESCE(t.fulfilled,0),'expired_unused',COALESCE(t.expired_unused,0),'pending',COALESCE(t.pending,0),
   'committed_cost',g.used_cost,'fulfilled_known_cost',t.fulfilled_known_cost,'fulfilled_cost_known_units',COALESCE(t.fulfilled_cost_known_units,0),'fulfilled_cost_unknown_units',COALESCE(t.fulfilled_cost_unknown_units,0)) AS report
 FROM hospitality_grants g JOIN staff_users s ON s.business_id=g.business_id AND s.id=g.staff_id CROSS JOIN snapshot
 LEFT JOIN totals t ON t.grant_id=g.id WHERE g.business_id=$1 ORDER BY g.created_at DESC`,own?[options.businessId,options.staff.id,member.branch_id]:[options.businessId])).rows;
 const serverNow=grants[0]?.report_as_of??(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
 for(const row of grants)delete row.report_as_of;
 const history=(await client.query(`SELECT e.id,e.title,e.reward_name,e.issued_at,e.expires_at,e.customer_id,e.issued_by_staff_id,e.approved_cost,COALESCE(c.name,'Cliente') AS customer_name,f.redemption_id,f.created_at AS fulfilled_at FROM hospitality_entitlements e JOIN customers c ON c.id=e.customer_id LEFT JOIN reward_entitlement_fulfillments f ON f.hospitality_id=e.id WHERE e.business_id=$1 AND ($2::uuid IS NULL OR e.issued_by_staff_id=$2) ORDER BY e.issued_at DESC LIMIT 100`,[options.businessId,own?options.staff.id:null])).rows;
 const staff=own?[]:(await client.query("SELECT id,name,branch_id FROM staff_users WHERE business_id=$1 AND active AND role IN ('OWNER','MANAGER','CASHIER') ORDER BY name",[options.businessId])).rows;
 const branches=own?[]:(await client.query('SELECT id,name FROM branches WHERE business_id=$1 ORDER BY name',[options.businessId])).rows;
 const rewards=own?[]:(await client.query('SELECT r.id,r.name,c.unit_cost_q FROM rewards r LEFT JOIN reward_unit_costs c ON c.business_id=r.business_id AND c.reward_id=r.id WHERE r.business_id=$1 AND r.active ORDER BY r.name LIMIT 200',[options.businessId])).rows;
 const business=(await client.query('SELECT program_json FROM businesses WHERE id=$1',[options.businessId])).rows[0];return {ok:true,region:businessRegion(business),grants,history,staff,branches,rewards,server_now:new Date(serverNow).toISOString()};});
}
