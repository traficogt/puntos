import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {dbQuery,withTransaction} from '../database.js';
import {badRequest,conflict,notFound} from '../../utils/http-error.js';
import {dateTimeSchema} from '../../utils/date-time-schema.js';
import {withImpersonationMeta} from '../../utils/impersonation.js';
import {readinessForBusiness} from './merchant-data-readiness.js';

const uuid=z.guid().transform(v=>v.toLowerCase());
export const healthSourceSchema=z.object({id:uuid,source:z.string().regex(/^[a-z][a-z0-9_-]{1,49}$/),label:z.string().trim().min(2).max(100),branch_id:uuid.nullable(),expected_minutes:z.number().int().min(5).max(10080),enabled:z.boolean()}).strict();
export const healthSettingsSchema=z.object({version:z.string().regex(/^[a-f0-9]{64}$/),sources:z.array(healthSourceSchema).max(100)}).strict().refine(v=>new Set(v.sources.map(s=>s.id)).size===v.sources.length&&new Set(v.sources.map(s=>`${s.source}:${s.branch_id}`)).size===v.sources.length);
export const heartbeatSchema=z.object({request_id:uuid,monitor_id:uuid,coverage_through:dateTimeSchema({offset:true}),status:z.enum(['complete','partial','error']),pending:z.number().int().min(0).max(10000000),errors:z.number().int().min(0).max(10000000)}).strict();
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stored=b=>b.program_json?.data_health??{sources:[]};
const defaults={query:dbQuery,transaction:withTransaction,now:()=>new Date()};
async function audit(client,o,action,meta){await client.query("INSERT INTO audit_logs(id,business_id,actor_type,actor_id,action,meta) VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),o.businessId,o.staffId?'STAFF':'INTEGRATION',o.staffId??null,action,JSON.stringify(withImpersonationMeta(meta,o))]);}
export async function getDataHealth({businessId},injected={}){
 const d={...defaults,...injected};
 const b=(await d.query('SELECT id,slug,program_json FROM businesses WHERE id=$1',[businessId])).rows[0];if(!b)throw notFound('Negocio no encontrado.');
 const branches=(await d.query('SELECT id,name FROM branches WHERE business_id=$1 ORDER BY name,id',[businessId])).rows;
 const events=(await d.query('SELECT id,monitor_id,details,created_at FROM ingestion_health_events WHERE business_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30',[businessId])).rows;
 return {version:hash(stored(b)),sources:stored(b).sources??[],branches,events,readiness:readinessForBusiness(b,d.now()),heartbeat_path:`/api/public/pos/${encodeURIComponent(b.slug)}/health/heartbeat`};
}
export async function saveDataHealth(options,injected={}){
 const parsed=healthSettingsSchema.safeParse(options.input);if(!parsed.success)throw badRequest('Revisa las conexiones, sucursales y plazos.');
 const d={...defaults,...injected},input=parsed.data;
 return d.transaction(async client=>{
  const b=(await client.query('SELECT id,program_json FROM businesses WHERE id=$1 FOR UPDATE',[options.businessId])).rows[0];if(!b)throw notFound('Negocio no encontrado.');
  if(hash(stored(b))!==input.version)throw conflict('La configuración cambió. Actualiza antes de guardar.');
  const branches=(await client.query('SELECT id FROM branches WHERE business_id=$1',[options.businessId])).rows.map(r=>r.id);
  if(input.sources.some(s=>s.branch_id&&!branches.includes(s.branch_id)))throw badRequest('La sucursal no pertenece a este negocio.');
  const existing=stored(b).sources??[];
  const sources=input.sources.map(s=>{const prev=existing.find(x=>x.id===s.id&&x.source===s.source&&x.branch_id===s.branch_id);return {...s,last_heartbeat:prev?.last_heartbeat??null};});
  const value={sources};
  await client.query("UPDATE businesses SET program_json=jsonb_set(COALESCE(program_json,'{}'::jsonb),'{data_health}',$2::jsonb,true) WHERE id=$1",[options.businessId,JSON.stringify(value)]);
  await audit(client,options,'data_health.configured',{sources:input.sources});
  return {ok:true,version:hash(value),sources};
 });
}
export async function recordDataHeartbeat(business,payload,injected={}){
 const parsed=heartbeatSchema.safeParse(payload);if(!parsed.success)throw badRequest('La confirmación de sincronización no es válida.');
 const d={...defaults,...injected},input=parsed.data,now=d.now(),fingerprint=hash(input);
 if(Date.parse(input.coverage_through)>now.getTime()+300000)throw badRequest('La ventana no puede terminar en el futuro.');
 return d.transaction(async client=>{
  const b=(await client.query('SELECT id,program_json FROM businesses WHERE id=$1 FOR UPDATE',[business.id])).rows[0];if(!b)throw notFound('Negocio no encontrado.');
  const prior=(await client.query('SELECT fingerprint,details FROM ingestion_health_events WHERE business_id=$1 AND request_id=$2',[b.id,input.request_id])).rows[0];
  if(prior){if(prior.fingerprint!==fingerprint)throw conflict('El ID ya corresponde a otra confirmación.');return {ok:true,replayed:true,heartbeat:prior.details};}
  const settings=stored(b),source=settings.sources?.find(s=>s.id===input.monitor_id&&s.enabled===true);if(!source)throw notFound('Conexión de seguimiento no disponible.');
  if(source.last_heartbeat&&Date.parse(input.coverage_through)<Date.parse(source.last_heartbeat.coverage_through))throw conflict('La ventana es anterior a la confirmación guardada.');
  const heartbeat={...input,coverage_through:new Date(input.coverage_through).toISOString(),received_at:now.toISOString(),evidence:'integration_reported'};
  const next={...settings,sources:settings.sources.map(s=>s.id===source.id?{...s,last_heartbeat:heartbeat}:s)};
  await client.query('INSERT INTO ingestion_health_events(id,business_id,monitor_id,request_id,fingerprint,details) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),b.id,source.id,input.request_id,fingerprint,JSON.stringify(heartbeat)]);
  await client.query("UPDATE businesses SET program_json=jsonb_set(COALESCE(program_json,'{}'::jsonb),'{data_health}',$2::jsonb,true) WHERE id=$1",[b.id,JSON.stringify(next)]);
  return {ok:true,replayed:false,heartbeat};
 });
}
