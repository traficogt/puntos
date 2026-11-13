import {randomUUID} from 'node:crypto';
import {DateTime} from 'luxon';
import {withTransaction} from '../database.js';
import {badRequest,conflict,notFound} from '../../utils/http-error.js';
import {businessRegion,assertRegionAmount} from './regional-settings.js';
import {fingerprint,requestIdentity,livePromiseMember,lockPromiseRequest,promiseAudit} from './reward-promise-service.js';
import {demandText,validateClaimTransition,supplierExport} from './demand-funding-model.js';
const tx=(deps,fn)=>(deps.transaction??withTransaction)(fn);
const visible=row=>{const {request_id:_id,request_fingerprint:_hash,...out}=row;for(const key of ['amount_minor','paid_minor','cap_minor','unit_amount_minor','reserved_minor'])if(out[key]!=null)out[key]=Number(out[key]);return out;};
const ELIGIBLE=`r.status='REDEEMED' AND r.redeemed_at IS NOT NULL AND p.status='recorded' AND p.recorded_at IS NOT NULL
 AND p.method IN('manual','connector') AND COALESCE(p.returned_quantity,0)=0 AND p.stock_status<>'returned'
 AND EXISTS(SELECT 1 FROM redemption_pos_events pe WHERE pe.business_id=r.business_id AND pe.redemption_id=r.id AND pe.kind='recorded')
 AND NOT EXISTS(SELECT 1 FROM service_redemption_restorations sr WHERE sr.business_id=r.business_id AND sr.redemption_id=r.id)
 AND (SELECT count(*) FROM transactions t WHERE t.business_id=r.business_id AND t.meta->>'redemption_id'=r.id::text AND t.source='redeem')=1
 AND EXISTS(SELECT 1 FROM transactions t WHERE t.business_id=r.business_id AND t.meta->>'redemption_id'=r.id::text AND t.source='redeem' AND t.status='POSTED' AND t.points=-r.points_cost AND t.reversed_transaction_id IS NULL)`;
async function agreementRow(client,businessId,id,lock=false){const row=(await client.query(`SELECT * FROM supplier_agreements WHERE business_id=$1 AND id=$2${lock?' FOR UPDATE':''}`,[businessId,requestIdentity(id)])).rows[0];if(!row)throw notFound('Acuerdo no encontrado.');return row;}
async function reserved(client,businessId,agreementId){return Number((await client.query("SELECT COALESCE(sum(amount_minor),0) AS amount FROM supplier_claims WHERE business_id=$1 AND agreement_id=$2 AND status<>'rejected'",[businessId,agreementId])).rows[0].amount);}
async function claimEvent(client,options,row,requestId,hash,details){await client.query('INSERT INTO supplier_claim_events(id,business_id,claim_id,staff_id,request_id,request_fingerprint,version,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),options.businessId,row.id,options.staff.id,requestId,hash,row.version,details]);}
async function fulfillment(client,businessId,redemptionId,agreement){
 // Debit before POS matches refund and manual fulfillment lock ordering. The
 // original redemption remains append-only and needs no UPDATE privilege.
 await client.query("SELECT id FROM transactions WHERE business_id=$1 AND source='redeem' AND meta->>'redemption_id'=$2 FOR UPDATE",[businessId,redemptionId]);
 await client.query('SELECT redemption_id FROM redemption_pos_records WHERE business_id=$1 AND redemption_id=$2 FOR UPDATE',[businessId,redemptionId]);
 const row=(await client.query(`SELECT r.id,r.reward_id,r.points_cost,r.redeemed_at,p.reward_name,p.method,p.recorded_at,p.version,p.currency,p.receipt_ref,p.source,p.order_id,p.line_id,
  (SELECT pe.id FROM redemption_pos_events pe WHERE pe.business_id=r.business_id AND pe.redemption_id=r.id AND pe.kind='recorded' ORDER BY pe.created_at,pe.id LIMIT 1) AS proof_event_id
  FROM redemptions r JOIN redemption_pos_records p ON p.business_id=r.business_id AND p.redemption_id=r.id
  WHERE r.business_id=$1 AND r.id=$2 AND ${ELIGIBLE}`,[businessId,redemptionId])).rows[0];
 if(!row||!agreement.reward_ids.includes(row.reward_id)||new Date(row.redeemed_at)<new Date(agreement.starts_at)||new Date(row.redeemed_at)>=new Date(agreement.ends_at)||row.currency!==agreement.currency)throw conflict('El canje no tiene una entrega elegible registrada, o requiere revisar devolución, fechas o moneda.');
 return row;
}
export async function createSupplierAgreement(options,deps={}){
 const {businessId}=options,requestId=requestIdentity(options.requestId),supplierName=demandText(options.supplier_name,2,120),title=demandText(options.title,3,120);
 const ids=options.reward_ids;if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)throw badRequest('Selecciona de una a cien recompensas distintas.');ids.forEach(requestIdentity);
 const days=options.starts_on!=null||options.ends_on!=null;
 const starts=days?DateTime.fromISO(String(options.starts_on),{zone:'UTC'}).toJSDate():new Date(options.starts_at),ends=days?DateTime.fromISO(String(options.ends_on),{zone:'UTC'}).toJSDate():new Date(options.ends_at);if(!Number.isFinite(starts.getTime())||!Number.isFinite(ends.getTime())||ends<=starts||days&&(options.starts_at!=null||options.ends_at!=null||!/^\d{4}-\d{2}-\d{2}$/.test(options.starts_on??'')||!/^\d{4}-\d{2}-\d{2}$/.test(options.ends_on??'')))throw badRequest('Revisa las fechas del acuerdo.');
 const hash=fingerprint([options.staff.id,supplierName,title,[...ids].sort(),days?options.starts_on:starts.toISOString(),days?options.ends_on:ends.toISOString(),options.currency,options.unit_amount,options.cap_amount]);
 return tx(deps,async client=>{await livePromiseMember(client,options,true);await lockPromiseRequest(client,businessId,`supplier-agreement:${requestId}`);
  const prior=(await client.query('SELECT * FROM supplier_agreements WHERE business_id=$1 AND request_id=$2',[businessId,requestId])).rows[0];if(prior){if(prior.request_fingerprint!==hash)throw conflict('La solicitud ya corresponde a otro acuerdo.');return{ok:true,agreement:visible(prior),replay:true};}
  const business=(await client.query('SELECT program_json FROM businesses WHERE id=$1 FOR SHARE',[businessId])).rows[0],region=businessRegion(business);
  const startAt=days?DateTime.fromISO(options.starts_on,{zone:region.timezone}).startOf('day').toJSDate():starts,endAt=days?DateTime.fromISO(options.ends_on,{zone:region.timezone}).startOf('day').toJSDate():ends;
  assertRegionAmount(options.unit_amount,options.currency,business);assertRegionAmount(options.cap_amount,options.currency,business);
  const unit=Math.round(options.unit_amount*10**region.minorUnits),cap=Math.round(options.cap_amount*10**region.minorUnits);
  if(!Number.isSafeInteger(unit)||unit<=0||unit>100000000||!Number.isSafeInteger(cap)||cap<unit||cap>10000000000)throw badRequest('Revisa el aporte por canje y el límite total.');
  if((await client.query('SELECT id FROM rewards WHERE business_id=$1 AND id=ANY($2::uuid[])',[businessId,ids])).rowCount!==ids.length)throw notFound('Una recompensa no pertenece al negocio.');
  const row=(await client.query('INSERT INTO supplier_agreements(id,business_id,supplier_name,title,reward_ids,starts_at,ends_at,currency,minor_units,unit_amount_minor,cap_minor,created_by_staff_id,request_id,request_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',[randomUUID(),businessId,supplierName,title,ids,startAt,endAt,region.currency,region.minorUnits,unit,cap,options.staff.id,requestId,hash])).rows[0];
  await promiseAudit(client,options,'supplier.agreement.create',{agreement_id:row.id,currency:region.currency,unit_amount_minor:unit,cap_minor:cap});return{ok:true,agreement:visible(row),replay:false};
 });
}
export async function closeSupplierAgreement(options,deps={}){
 return tx(deps,async client=>{await livePromiseMember(client,options,true);const row=await agreementRow(client,options.businessId,options.agreementId,true);if(row.closed_at)return{ok:true,agreement:visible(row),replay:true};
  const result=(await client.query('UPDATE supplier_agreements SET closed_at=now() WHERE business_id=$1 AND id=$2 RETURNING *',[options.businessId,row.id])).rows[0];await promiseAudit(client,options,'supplier.agreement.close',{agreement_id:row.id});return{ok:true,agreement:visible(result)};
 });
}
export async function listEligibleSupplierRedemptions(options,deps={}){
 const offset=options.offset??0;if(!Number.isInteger(offset)||offset<0||offset>100000)throw badRequest('Página inválida.');
 return tx(deps,async client=>{await livePromiseMember(client,options,true);const a=await agreementRow(client,options.businessId,options.agreementId);
  const rows=a.closed_at?[]:(await client.query(`SELECT r.id,r.reward_id,p.reward_name,r.redeemed_at,p.method,p.recorded_at FROM redemptions r JOIN redemption_pos_records p ON p.business_id=r.business_id AND p.redemption_id=r.id
   WHERE r.business_id=$1 AND r.reward_id=ANY($2::uuid[]) AND r.redeemed_at>=$3 AND r.redeemed_at<$4 AND p.currency=$5 AND ${ELIGIBLE}
   AND NOT EXISTS(SELECT 1 FROM supplier_claims c WHERE c.business_id=r.business_id AND c.redemption_id=r.id)
   ORDER BY r.redeemed_at DESC,r.id DESC LIMIT 51 OFFSET $6`,[options.businessId,a.reward_ids,a.starts_at,a.ends_at,a.currency,offset])).rows;
  return{ok:true,redemptions:rows.slice(0,50),pagination:{offset,limit:50,has_more:rows.length>50}};
 });
}
export async function createSupplierClaim(options,deps={}){
 const {businessId,agreementId}=options,redemptionId=requestIdentity(options.redemptionId),requestId=requestIdentity(options.requestId),hash=fingerprint([options.staff.id,agreementId,redemptionId]);
 return tx(deps,async client=>{await livePromiseMember(client,options,true);await lockPromiseRequest(client,businessId,`supplier-claim:${requestId}`);
  const a=await agreementRow(client,businessId,agreementId,true);
  const prior=(await client.query('SELECT * FROM supplier_claims WHERE business_id=$1 AND request_id=$2',[businessId,requestId])).rows[0];if(prior){if(prior.request_fingerprint!==hash)throw conflict('La solicitud ya se usó para otro canje.');return{ok:true,claim:visible(prior),replay:true};}
  if(a.closed_at)throw conflict('El acuerdo está cerrado para nuevos canjes.');
  await lockPromiseRequest(client,businessId,`supplier-redemption:${redemptionId}`);
  if((await client.query('SELECT id FROM supplier_claims WHERE business_id=$1 AND redemption_id=$2',[businessId,redemptionId])).rowCount)throw conflict('El canje ya tiene una reclamación. Consulta su historial.');
  const proof=await fulfillment(client,businessId,redemptionId,a);
  if(await reserved(client,businessId,agreementId)+Number(a.unit_amount_minor)>Number(a.cap_minor))throw conflict('El límite del acuerdo no alcanza para otro canje.');
  const evidence={schema_version:1,reward_id:proof.reward_id,reward_name:proof.reward_name,redeemed_at:proof.redeemed_at,fulfilled_at:proof.recorded_at,kind:proof.method==='manual'?'staff_attested_pos':'connector_pos',proof_event_id:proof.proof_event_id,pos_version:proof.version,pos:{receipt_ref:proof.receipt_ref??null,source:proof.source??null,order_id:proof.order_id??null,line_id:proof.line_id??null},points_cost:proof.points_cost,agreement:{supplier_name:a.supplier_name,title:a.title,starts_at:a.starts_at,ends_at:a.ends_at,unit_amount_minor:Number(a.unit_amount_minor),cap_minor:Number(a.cap_minor),currency:a.currency}};
  const row=(await client.query('INSERT INTO supplier_claims(id,business_id,agreement_id,redemption_id,amount_minor,currency,evidence,request_id,request_fingerprint,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[randomUUID(),businessId,agreementId,redemptionId,a.unit_amount_minor,a.currency,evidence,requestId,hash,options.staff.id])).rows[0];
  await claimEvent(client,options,row,requestId,hash,{status:'draft'});await promiseAudit(client,options,'supplier.claim.create',{claim_id:row.id,agreement_id:agreementId,amount_minor:Number(row.amount_minor)});return{ok:true,claim:visible(row),replay:false};
 });
}
export async function transitionSupplierClaim(options,deps={}){
 const {businessId,version}=options,claimId=requestIdentity(options.claimId),requestId=requestIdentity(options.requestId);if(!Number.isInteger(version)||version<1)throw badRequest('Versión inválida.');
 const hash=fingerprint([options.staff.id,claimId,version,options.status,options.reference,options.paid_minor??null,options.paid_at??null]);
 return tx(deps,async client=>{await livePromiseMember(client,options,true);await lockPromiseRequest(client,businessId,`supplier-transition:${requestId}`);
  const found=(await client.query('SELECT agreement_id FROM supplier_claims WHERE business_id=$1 AND id=$2',[businessId,claimId])).rows[0];if(!found)throw notFound('Reclamación no encontrada.');
  const a=await agreementRow(client,businessId,found.agreement_id,true),row=(await client.query('SELECT * FROM supplier_claims WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,claimId])).rows[0];
  const prior=(await client.query('SELECT request_fingerprint FROM supplier_claim_events WHERE business_id=$1 AND request_id=$2',[businessId,requestId])).rows[0];if(prior){if(prior.request_fingerprint!==hash)throw conflict('La solicitud ya se usó para otra acción.');return{ok:true,claim:visible(row),replay:true};}
  if(row.version!==version)throw conflict('La reclamación cambió. Actualiza antes de guardar.');const change=validateClaimTransition(row,options);
  if(change.status!=='rejected')await fulfillment(client,businessId,row.redemption_id,a);
  if(row.status==='rejected'){
   if(a.closed_at)throw conflict('El acuerdo está cerrado.');if(await reserved(client,businessId,a.id)+Number(row.amount_minor)>Number(a.cap_minor))throw conflict('El límite disponible no alcanza para reenviar la reclamación.');
  }
  const result=(await client.query('UPDATE supplier_claims SET status=$3,version=version+1,updated_at=now(),paid_minor=$4,paid_at=$5,payment_reference=$6 WHERE business_id=$1 AND id=$2 RETURNING *',[businessId,claimId,change.status,change.paid_minor,change.paid_at,change.status==='paid'?change.reference:null])).rows[0];
  await claimEvent(client,options,result,requestId,hash,change);await promiseAudit(client,options,'supplier.claim.transition',{claim_id:claimId,...change});return{ok:true,claim:visible(result),replay:false};
 });
}
export async function getSupplierClaim(options,deps={}){
 return tx(deps,async client=>{await livePromiseMember(client,options,true);const row=(await client.query('SELECT * FROM supplier_claims WHERE business_id=$1 AND id=$2',[options.businessId,requestIdentity(options.claimId)])).rows[0];if(!row)throw notFound('Reclamación no encontrada.');
  const events=(await client.query('SELECT version,details,created_at FROM supplier_claim_events WHERE business_id=$1 AND claim_id=$2 ORDER BY version',[options.businessId,row.id])).rows;return{ok:true,claim:visible(row),events};
 });
}
export async function getFundingSummary(client,businessId){
 const rows=(await client.query(`SELECT a.currency,a.minor_units,sum(a.cap_minor)::text AS cap_minor,
  sum(COALESCE(c.reserved_minor,0))::text AS reserved_minor,sum(COALESCE(c.approved_minor,0))::text AS approved_minor,sum(COALESCE(c.paid_minor,0))::text AS paid_minor,
  sum(CASE WHEN a.closed_at IS NULL THEN a.cap_minor-COALESCE(c.reserved_minor,0) ELSE 0 END)::text AS available_minor
  FROM supplier_agreements a LEFT JOIN LATERAL(SELECT sum(amount_minor) FILTER(WHERE status<>'rejected') AS reserved_minor,sum(amount_minor) FILTER(WHERE status='approved') AS approved_minor,sum(amount_minor) FILTER(WHERE status='paid') AS paid_minor FROM supplier_claims WHERE business_id=a.business_id AND agreement_id=a.id)c ON true
  WHERE a.business_id=$1 GROUP BY a.currency,a.minor_units ORDER BY a.currency`,[businessId])).rows;
 return rows.map(r=>({...r,cap_minor:Number(r.cap_minor),reserved_minor:Number(r.reserved_minor),approved_minor:Number(r.approved_minor),paid_minor:Number(r.paid_minor),available_minor:Number(r.available_minor)}));
}
export async function getSupplierFunding(options,deps={}){
 const offset=options.offset??0;if(!Number.isInteger(offset)||offset<0||offset>100000)throw badRequest('Página inválida.');
 return tx(deps,async client=>{await livePromiseMember(client,options,true);const business=(await client.query('SELECT program_json FROM businesses WHERE id=$1',[options.businessId])).rows[0];
  const agreements=(await client.query(`SELECT a.*,(SELECT COALESCE(sum(amount_minor),0) FROM supplier_claims c WHERE c.business_id=a.business_id AND c.agreement_id=a.id AND c.status<>'rejected') AS reserved_minor FROM supplier_agreements a WHERE business_id=$1 ORDER BY created_at DESC LIMIT 200`,[options.businessId])).rows.map(visible);
  const claims=(await client.query(`SELECT c.*,a.supplier_name,a.title AS agreement_title,NOT EXISTS(SELECT 1 FROM redemptions r JOIN redemption_pos_records p ON p.business_id=r.business_id AND p.redemption_id=r.id WHERE r.business_id=c.business_id AND r.id=c.redemption_id AND ${ELIGIBLE}) AS requires_review FROM supplier_claims c JOIN supplier_agreements a ON a.business_id=c.business_id AND a.id=c.agreement_id WHERE c.business_id=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT 51 OFFSET $2`,[options.businessId,offset])).rows.map(visible);
  const rewards=(await client.query('SELECT id,name FROM rewards WHERE business_id=$1 ORDER BY name LIMIT 200',[options.businessId])).rows;
  return{ok:true,region:businessRegion(business),agreements,claims:claims.slice(0,50),rewards,summary:await getFundingSummary(client,options.businessId),pagination:{offset,limit:50,has_more:claims.length>50}};
 });
}
export async function exportSupplierClaims(options,deps={}){
 return tx(deps,async client=>{await livePromiseMember(client,options,true);const a=await agreementRow(client,options.businessId,options.agreementId);
  const rows=(await client.query('SELECT c.id,c.amount_minor,c.currency,c.status,c.evidence,c.paid_minor,c.paid_at FROM supplier_claims c WHERE business_id=$1 AND agreement_id=$2 ORDER BY created_at,id',[options.businessId,a.id])).rows;
  await promiseAudit(client,options,'supplier.claim.export',{agreement_id:a.id,count:rows.length});return supplierExport(rows.map(r=>({...r,supplier_name:a.supplier_name,agreement_title:a.title})));
 });
}
