import {randomUUID} from 'node:crypto';
import {withTransaction} from '../database.js';
import {badRequest,conflict,forbidden,notFound} from '../../utils/http-error.js';
import {fingerprint,requestIdentity,livePromiseMember,lockPromiseRequest,promiseAudit} from './reward-promise-service.js';
import {normalizeDemand,DEMAND_CATEGORIES,DEMAND_STATUSES,demandText} from './demand-funding-model.js';
const tx=(deps,fn)=>(deps.transaction??withTransaction)(fn);
async function member(client,options){
 if(options.source==='customer'){
  if(options.customerAuth?.business_id!==options.businessId||options.customerAuth?.id!==options.customerId)throw forbidden('La sesión no corresponde a esta solicitud.');
 }else await livePromiseMember(client,options);
 if(options.customerId){const row=(await client.query('SELECT id FROM customers WHERE business_id=$1 AND id=$2 AND deleted_at IS NULL',[options.businessId,requestIdentity(options.customerId)])).rows[0];if(!row)throw notFound('Cliente no encontrado.');}
}
const publicRequest=row=>{const {request_fingerprint:_hash,request_id:_request,receipt_fingerprint:_receiptHash,deduplicated:_dedup,...out}=row;return out;};
async function receipt(client,businessId,requestId,row,hash,deduplicated){await client.query('INSERT INTO demand_request_receipts(business_id,request_id,demand_request_id,request_fingerprint,deduplicated) VALUES($1,$2,$3,$4,$5)',[businessId,requestId,row.id,hash,deduplicated]);}
export async function createDemandRequest(options,deps={}){
 const {businessId,source,customerId=null}=options,requestId=requestIdentity(options.requestId),value=normalizeDemand(options);
 if(!['staff','customer'].includes(source))throw badRequest('Origen inválido.');if(value.rewardId)requestIdentity(value.rewardId);
 const hash=fingerprint({source,customerId,staffId:source==='staff'?options.staff?.id:null,...value});
 return tx(deps,async client=>{
  await member(client,options);await lockPromiseRequest(client,businessId,`demand:${requestId}`);
  const existing=(await client.query('SELECT d.*,r.request_fingerprint AS receipt_fingerprint,r.deduplicated FROM demand_request_receipts r JOIN demand_requests d ON d.business_id=r.business_id AND d.id=r.demand_request_id WHERE r.business_id=$1 AND r.request_id=$2',[businessId,requestId])).rows[0];
  if(existing){if(existing.receipt_fingerprint!==hash)throw conflict('La solicitud ya se usó para otro pedido.');return{ok:true,request:publicRequest(existing),replay:true,deduplicated:existing.deduplicated};}
  if(value.rewardId&&!(await client.query('SELECT id FROM rewards WHERE business_id=$1 AND id=$2',[businessId,value.rewardId])).rowCount)throw notFound('Recompensa no encontrada.');
  await lockPromiseRequest(client,businessId,`demand-topic:${value.topicKey}`);
  let topic=(await client.query('SELECT * FROM demand_topics WHERE business_id=$1 AND topic_key=$2',[businessId,value.topicKey])).rows[0];
  if(!topic)topic=(await client.query(`INSERT INTO demand_topics(id,business_id,topic_key,category,topic,reward_id,product_context) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[randomUUID(),businessId,value.topicKey,value.category,value.topic,value.rewardId,value.productContext])).rows[0];
  if(customerId){const prior=(await client.query('SELECT * FROM demand_requests WHERE business_id=$1 AND topic_id=$2 AND customer_id=$3',[businessId,topic.id,customerId])).rows[0];if(prior){await receipt(client,businessId,requestId,prior,hash,true);return{ok:true,request:publicRequest(prior),topic,deduplicated:true,replay:false};}}
  const row=(await client.query('INSERT INTO demand_requests(id,business_id,topic_id,customer_id,staff_id,source,note,request_id,request_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[randomUUID(),businessId,topic.id,customerId,source==='staff'?options.staff.id:null,source,value.note,requestId,hash])).rows[0];
  await receipt(client,businessId,requestId,row,hash,false);
  if(source==='staff')await promiseAudit(client,options,'demand.request.create',{topic_id:topic.id,request_id:row.id,customer_linked:!!customerId});
  else await client.query("INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,meta) VALUES($1,$2,'CUSTOMER',$3,'demand.request.create',$4)",[randomUUID(),businessId,customerId,{topic_id:topic.id,request_id:row.id}]);
  return{ok:true,request:publicRequest(row),topic,deduplicated:false,replay:false};
 });
}
export async function getDemandEntry(options,deps={}){
 return tx(deps,async client=>{await member(client,options);const rewards=(await client.query('SELECT id,name FROM rewards WHERE business_id=$1 AND active ORDER BY name LIMIT 200',[options.businessId])).rows;
  const requests=options.source==='customer'?(await client.query(`SELECT d.id,d.note,d.created_at,t.topic,t.category,t.status,t.follow_up_at FROM demand_requests d JOIN demand_topics t ON t.id=d.topic_id AND t.business_id=d.business_id WHERE d.business_id=$1 AND d.customer_id=$2 ORDER BY d.created_at DESC LIMIT 50`,[options.businessId,options.customerId])).rows:[];
  return{ok:true,categories:DEMAND_CATEGORIES,rewards,requests};
 });
}
export async function listDemandTopics(options,deps={}){
 const status=options.status??'all',offset=options.offset??0;if(!['all',...DEMAND_STATUSES].includes(status)||!Number.isInteger(offset)||offset<0||offset>100000)throw badRequest('Filtro inválido.');
 return tx(deps,async client=>{await livePromiseMember(client,options,true);const topics=(await client.query(`SELECT t.*,r.name AS reward_name,
  (SELECT count(*)::int FROM demand_requests d WHERE d.business_id=t.business_id AND d.topic_id=t.id AND d.customer_id IS NOT NULL) AS member_count,
  (SELECT count(*)::int FROM demand_requests d WHERE d.business_id=t.business_id AND d.topic_id=t.id AND d.customer_id IS NULL) AS staff_observations,
  (SELECT max(created_at) FROM demand_requests d WHERE d.business_id=t.business_id AND d.topic_id=t.id) AS last_requested_at
  FROM demand_topics t LEFT JOIN rewards r ON r.business_id=t.business_id AND r.id=t.reward_id WHERE t.business_id=$1 AND ($2='all' OR t.status=$2)
  ORDER BY t.created_at DESC,t.id DESC LIMIT 51 OFFSET $3`,[options.businessId,status,offset])).rows;
  return{ok:true,topics:topics.slice(0,50),pagination:{offset,limit:50,has_more:topics.length>50}};
 });
}
export async function getDemandTopic(options,deps={}){
 return tx(deps,async client=>{await livePromiseMember(client,options,true);const topic=(await client.query('SELECT * FROM demand_topics WHERE business_id=$1 AND id=$2',[options.businessId,requestIdentity(options.topicId)])).rows[0];if(!topic)throw notFound('Tema no encontrado.');
  const requests=(await client.query(`SELECT d.id,d.source,d.note,d.created_at,d.customer_id,c.name AS customer_name FROM demand_requests d LEFT JOIN customers c ON c.business_id=d.business_id AND c.id=d.customer_id AND c.deleted_at IS NULL WHERE d.business_id=$1 AND d.topic_id=$2 ORDER BY d.created_at DESC LIMIT 100`,[options.businessId,topic.id])).rows;
  const events=(await client.query('SELECT version,details,created_at FROM demand_events WHERE business_id=$1 AND topic_id=$2 ORDER BY version DESC LIMIT 100',[options.businessId,topic.id])).rows;
  return{ok:true,topic,requests,events};
 });
}
export async function triageDemandTopic(options,deps={}){
 const {businessId,topicId,version,status}=options,requestId=requestIdentity(options.requestId),note=demandText(options.note,3,1000),followUp=options.follow_up_at??null;
 if(!DEMAND_STATUSES.includes(status)||!Number.isInteger(version)||version<1||followUp&&!Number.isFinite(Date.parse(followUp)))throw badRequest('Revisa el estado y la fecha de seguimiento.');
 const hash=fingerprint([options.staff.id,topicId,version,status,note,followUp]);
 return tx(deps,async client=>{await livePromiseMember(client,options,true);await lockPromiseRequest(client,businessId,`demand-triage:${requestId}`);
  const row=(await client.query('SELECT * FROM demand_topics WHERE business_id=$1 AND id=$2 FOR UPDATE',[businessId,requestIdentity(topicId)])).rows[0];if(!row)throw notFound('Tema no encontrado.');
  const prior=(await client.query('SELECT request_fingerprint FROM demand_events WHERE business_id=$1 AND request_id=$2',[businessId,requestId])).rows[0];if(prior){if(prior.request_fingerprint!==hash)throw conflict('La solicitud ya se usó para otro seguimiento.');return{ok:true,topic:row,replay:true};}
  if(row.version!==version)throw conflict('El tema cambió. Actualiza antes de guardar.');
  const topic=(await client.query('UPDATE demand_topics SET status=$3,follow_up_at=$4,version=version+1,updated_at=now() WHERE business_id=$1 AND id=$2 RETURNING *',[businessId,topicId,status,followUp])).rows[0];
  const details={status,note,follow_up_at:followUp};await client.query('INSERT INTO demand_events(id,business_id,topic_id,staff_id,request_id,request_fingerprint,version,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),businessId,topicId,options.staff.id,requestId,hash,topic.version,details]);
  await promiseAudit(client,options,'demand.topic.triage',{topic_id:topicId,...details});return{ok:true,topic,replay:false};
 });
}
