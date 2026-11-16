import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {withTransaction} from '../database.js';
import {badRequest,conflict,notFound,tooManyRequests} from '../../utils/http-error.js';

export const SUPPORT_ATTACHMENT_BYTES=600*1024;
const text=(max,min=1)=>z.string().trim().min(min).max(max);
const token=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const supportDiagnosticsSchema=z.object({
 screen:z.literal('support'), online:z.boolean(), browser:z.enum(['Firefox','Edge','Chrome','Safari','Other']),
 device:z.enum(['mobile','desktop']),language:z.string().regex(/^[A-Za-z-]{2,20}$/),viewport:z.string().regex(/^\d{1,5}x\d{1,5}$/)
}).strict();
export const supportCreateSchema=z.object({
 requestId:z.uuid(),trackingToken:token,name:text(100),email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),
 business:text(160,0).default(''),category:z.enum(['access','points','reward','scan','business','privacy','other']),description:text(4000,15),
 includeAccount:z.boolean().default(false),diagnostics:supportDiagnosticsSchema.optional(),
 attachment:z.object({data:z.string().max(Math.ceil(SUPPORT_ATTACHMENT_BYTES/3)*4).regex(/^[A-Za-z0-9+/]+={0,2}$/)}).strict().optional(),
 turnstileToken:z.string().max(4096).default(''),website:z.string().max(100).default('')
}).strict();
export const supportTrackSchema=z.object({trackingToken:token}).strict();
export const supportReplySchema=z.object({trackingToken:token,requestId:z.uuid(),message:text(4000,5)}).strict();
export const supportUpdateSchema=z.object({requestId:z.uuid(),version:z.number().int().positive(),status:z.enum(['new','open','waiting','resolved','closed']),assignedTo:z.string().trim().email().max(254).nullable(),message:text(4000,0).default(''),visibility:z.enum(['public','internal'])}).strict();
export const hashSupportSecret=value=>createHash('sha256').update(value).digest('hex');
const fingerprint=value=>hashSupportSecret(JSON.stringify(value));
export const canTransitionSupport=(from,to)=>from===to || ({new:['open','waiting','resolved','closed'],open:['waiting','resolved','closed'],waiting:['open','resolved','closed'],resolved:['open','closed'],closed:['open']}[from]||[]).includes(to);
export function publicSupportCase(row,events=[],attachment=null){
 return {reference:row.reference,status:row.status,category:row.category,description:row.description,createdAt:row.created_at,updatedAt:row.updated_at,
  events:events.filter(e=>e.visibility==='public').map(e=>({kind:e.kind,message:e.message,createdAt:e.created_at})),
  attachment:attachment?{available:true,expiresAt:attachment.expires_at}:null};
}
export async function sanitizeSupportAttachment(attachment){
 if(!attachment)return null;
 const bytes=Buffer.from(attachment.data,'base64');
 if(!bytes.length||bytes.length>SUPPORT_ATTACHMENT_BYTES)throw badRequest('La captura debe pesar como máximo 600 KB.');
 try{
  const {default:sharp}=await import('sharp');
  const input=sharp(bytes,{limitInputPixels:12000000,failOn:'warning',animated:false});
  const meta=await input.metadata();
  if(!['png','jpeg','webp'].includes(meta.format)||!meta.width||!meta.height||meta.width>4096||meta.height>4096||(meta.pages||1)>1)throw new Error('format');
  const result=await input.rotate().webp({quality:80}).toBuffer({resolveWithObject:true});
  if(result.data.length>SUPPORT_ATTACHMENT_BYTES)throw new Error('size');
  return {data:result.data,width:result.info.width,height:result.info.height};
 }catch{throw badRequest('No pudimos leer la captura. Usa una imagen PNG, JPEG o WebP válida, sin animación y de hasta 4096 píxeles por lado.');}
}
function parse(schema,input){const result=schema.safeParse(input);if(!result.success)throw badRequest('Revisa los campos del reporte. No incluyas datos adicionales.');return result.data;}
async function scope(secret,task,deps){
 return (deps?.transaction||withTransaction)(async client=>{
  await client.query("SELECT set_config('app.support_hash',$1,true)",[secret?hashSupportSecret(secret):'']);
  return task(client);
 });
}
async function caseForToken(client,secret,lock=false){
 const row=(await client.query(`SELECT * FROM support_cases WHERE tracking_hash=$1${lock?' FOR UPDATE':''}`,[hashSupportSecret(secret)])).rows[0];
 if(!row)throw notFound('No encontramos el caso. Revisa tu enlace privado.');return row;
}
async function detail(client,row,admin=false){
 const events=(await client.query(`SELECT * FROM support_case_events WHERE case_id=$1 ${admin?'':"AND visibility='public'"} ORDER BY created_at,id`,[row.id])).rows;
 const attachment=(await client.query('SELECT id,expires_at,width,height FROM support_case_attachments WHERE case_id=$1 AND expires_at>clock_timestamp()',[row.id])).rows[0];
 return admin?{case:{...row,tracking_hash:undefined,request_fingerprint:undefined},events,attachment:attachment||null}:publicSupportCase(row,events,attachment);
}
export async function createSupportCase(input,{verify=async(_token)=>false,context=null,...deps}={}){
 const payload=parse(supportCreateSchema,input);if(payload.website)throw badRequest('No se pudo enviar el reporte.');
 const {turnstileToken,trackingToken,website:_website,...content}=payload;
 const digest=fingerprint(content);
 return scope(trackingToken,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[payload.requestId]);
  const existing=(await client.query('SELECT * FROM support_cases WHERE request_id=$1',[payload.requestId])).rows[0];
  if(existing){if(existing.request_fingerprint!==digest)throw conflict('El intento anterior tiene otro contenido. Revisa el caso guardado antes de crear uno nuevo.');return {...await detail(client,existing),replayed:true};}
  if(!await verify(turnstileToken))throw badRequest('Completa la verificación de seguridad e intenta de nuevo.');
  const attachment=await sanitizeSupportAttachment(payload.attachment);
  const id=randomUUID(),reference=`PF-${randomBytes(6).toString('hex').toUpperCase()}`;
  const row=(await client.query(`INSERT INTO support_cases(id,reference,request_id,request_fingerprint,tracking_hash,name,email,business_label,business_id,actor_type,actor_id,category,description,diagnostics) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[id,reference,payload.requestId,digest,hashSupportSecret(trackingToken),payload.name,payload.email,payload.business,payload.includeAccount?context?.businessId||null:null,payload.includeAccount?context?.actorType||null:null,payload.includeAccount?context?.actorId||null:null,payload.category,payload.description,payload.diagnostics||null])).rows[0];
  await client.query("INSERT INTO support_case_events(id,case_id,request_id,request_fingerprint,kind,visibility,message) VALUES($1,$2,$3,$4,'created','public','Recibimos tu reporte. Puedes dar seguimiento desde este enlace privado.')",[randomUUID(),id,payload.requestId,digest]);
  if(attachment)await client.query("INSERT INTO support_case_attachments(id,case_id,content_type,data,width,height) VALUES($1,$2,'image/webp',$3,$4,$5)",[randomUUID(),id,attachment.data,attachment.width,attachment.height]);
  return {...await detail(client,row),replayed:false};
 },deps).catch(error=>{if(error.code==='23505')throw conflict('Este intento ya está guardado. Usa su enlace privado o inicia otro reporte.');throw error;});
}
export async function trackSupportCase(input,deps={}){const p=parse(supportTrackSchema,input);return scope(p.trackingToken,async c=>detail(c,await caseForToken(c,p.trackingToken)),deps);}
export async function replySupportCase(input,deps={}){
 const p=parse(supportReplySchema,input),digest=fingerprint({message:p.message});
 return scope(p.trackingToken,async c=>{
  const row=await caseForToken(c,p.trackingToken,true);
  const prior=(await c.query('SELECT request_fingerprint FROM support_case_events WHERE case_id=$1 AND request_id=$2',[row.id,p.requestId])).rows[0];
  if(prior){if(prior.request_fingerprint!==digest)throw conflict('Este intento ya tiene otro mensaje.');return detail(c,row);}
  if(row.status==='closed')throw conflict('Este caso está cerrado. Abre un nuevo reporte si necesitas más ayuda.');
  const count=(await c.query("SELECT count(*)::int n FROM support_case_events WHERE case_id=$1 AND kind='customer' AND created_at>clock_timestamp()-interval '1 day'",[row.id])).rows[0].n;
  if(count>=20)throw tooManyRequests('Ya recibimos varios mensajes de este caso. Espera antes de enviar otro.');
  await c.query("INSERT INTO support_case_events(id,case_id,request_id,request_fingerprint,kind,visibility,message) VALUES($1,$2,$3,$4,'customer','public',$5)",[randomUUID(),row.id,p.requestId,digest,p.message]);
  const updated=(await c.query("UPDATE support_cases SET status=CASE WHEN status IN ('waiting','resolved') THEN 'open' ELSE status END,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",[row.id])).rows[0];return detail(c,updated);
 },deps);
}
export async function listSupportCases({status=undefined,search='',offset=0}={},deps={}){
 const validStatus=z.enum(['new','open','waiting','resolved','closed']).optional().parse(status);
 return (deps.transaction||withTransaction)(async c=>(await c.query(`SELECT id,reference,name,email,category,status,assigned_to,business_label,created_at,updated_at,version FROM support_cases WHERE ($1::text IS NULL OR status=$1) AND ($2='' OR reference ILIKE '%'||$2||'%' OR email ILIKE '%'||$2||'%' OR business_label ILIKE '%'||$2||'%') ORDER BY updated_at DESC,id LIMIT 50 OFFSET $3`,[validStatus||null,String(search).slice(0,160),Math.max(0,Number(offset)||0)])).rows);
}
export async function getSupportCase(id,deps={}){return (deps.transaction||withTransaction)(async c=>{const row=(await c.query('SELECT * FROM support_cases WHERE id=$1',[z.uuid().parse(id)])).rows[0];if(!row)throw notFound();return detail(c,row,true);});}
export async function updateSupportCase(id,input,actorEmail,deps={}){
 const p=parse(supportUpdateSchema,input),digest=fingerprint(p);
 return (deps.transaction||withTransaction)(async c=>{
  const row=(await c.query('SELECT * FROM support_cases WHERE id=$1 FOR UPDATE',[z.uuid().parse(id)])).rows[0];if(!row)throw notFound();
  const prior=(await c.query('SELECT request_fingerprint FROM support_case_events WHERE case_id=$1 AND request_id=$2',[id,p.requestId])).rows[0];
  if(prior){if(prior.request_fingerprint!==digest)throw conflict('El intento anterior tiene otro contenido.');return detail(c,row,true);}
  if(row.version!==p.version)throw conflict('El caso cambió. Actualiza la página y revisa los cambios.');
  if(!canTransitionSupport(row.status,p.status))throw conflict('Primero reabre el caso para cambiarlo a ese estado.');
  const updated=(await c.query('UPDATE support_cases SET status=$2,assigned_to=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[id,p.status,p.assignedTo])).rows[0];
  await c.query("INSERT INTO support_case_events(id,case_id,request_id,request_fingerprint,kind,visibility,message,actor_email,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[randomUUID(),id,p.requestId,digest,p.message?(p.visibility==='public'?'response':'note'):'updated',p.visibility,p.message,actorEmail,{from:row.status,to:p.status,assignedFrom:row.assigned_to,assignedTo:p.assignedTo,version:updated.version}]);
  return detail(c,updated,true);
 });
}
export async function getSupportAttachment({trackingToken=null,caseId=null},deps={}){
 return scope(trackingToken,async c=>{
  const id=trackingToken?(await caseForToken(c,trackingToken)).id:z.uuid().parse(caseId);
  const row=(await c.query('SELECT data,content_type FROM support_case_attachments WHERE case_id=$1 AND expires_at>clock_timestamp()',[id])).rows[0];if(!row)throw notFound('La captura no está disponible.');return row;
 },deps);
}
