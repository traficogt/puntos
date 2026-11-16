import {Router} from 'express';
import {z} from 'zod';
import {asyncRoute} from '../../middleware/common.js';
import {csrfProtect} from '../../middleware/csrf.js';
import {requireSuperAdmin} from '../../middleware/auth.js';
import {rateLimitByIp} from '../../middleware/rate-limit.js';
import {getRequestIp} from '../../utils/request-ip.js';
import {config} from '../../config/index.js';
import {withDbClientContext,dbQuery} from '../database.js';
import {browserSessionStatus,getBrowserSession} from '../services/auth-session-service.js';
import {verifyTurnstile} from '../services/contact-service.js';
import {createSupportCase,trackSupportCase,replySupportCase,listSupportCases,getSupportCase,updateSupportCase,getSupportAttachment,supportTrackSchema} from '../services/support-case-service.js';

export async function verifiedSupportContext(req){
 if(req.body?.includeAccount!==true)return null;
 for(const [cookie,actorType] of [[config.STAFF_COOKIE_NAME,'STAFF'],[config.CUSTOMER_COOKIE_NAME,'CUSTOMER']]){
  if(!req.cookies?.[cookie])continue;
  const session=await getBrowserSession(req.cookies[cookie]);
  if(!browserSessionStatus(session).ok||session.actor_type!==actorType||!session.business_id)continue;
  const valid=await withDbClientContext({tenantId:session.business_id,platformAdmin:false},async()=>{
   const result=actorType==='STAFF'
    ?await dbQuery('SELECT id FROM staff_users WHERE id=$1 AND business_id=$2 AND active=true',[session.actor_id,session.business_id])
    :await dbQuery('SELECT id FROM customers WHERE id=$1 AND business_id=$2 AND deleted_at IS NULL',[session.actor_id,session.business_id]);
   return Boolean(result.rows[0]);
  });
  if(valid)return {businessId:session.business_id,actorType,actorId:session.actor_id};
 }
 return null;
}
export function createSupportCaseRoutes({verifyChallenge=verifyTurnstile,resolveContext=verifiedSupportContext,serviceDeps={}}={}){
 const routes=Router();
 const createLimit=rateLimitByIp(8,60*60*1000,{keyPrefix:'support:create:'});
 const readLimit=rateLimitByIp(60,60*1000,{keyPrefix:'support:read:'});
 const replyLimit=rateLimitByIp(20,60*60*1000,{keyPrefix:'support:reply:'});
 routes.use(['/public/support','/super/support'],(_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex'});next();});
 routes.get('/public/support/config',(_req,res)=>res.json({challengeRequired:Boolean(config.CONTACT_TURNSTILE_SECRET),siteKey:process.env.CONTACT_TURNSTILE_SITE_KEY||'0x4AAAAAACxpjwCi9p0pY8BF',attachmentMaxBytes:614400}));
 routes.post('/public/support/cases',createLimit,csrfProtect,asyncRoute(async(req,res)=>{
  const context=await resolveContext(req);
  const out=await createSupportCase(req.body,{...serviceDeps,context,verify:token=>verifyChallenge(token,getRequestIp(req)).catch(()=>false)});
  res.status(out.replayed?200:201).json(out);
 }));
 routes.post('/public/support/track',readLimit,csrfProtect,asyncRoute(async(req,res)=>res.json(await trackSupportCase(req.body,serviceDeps))));
 routes.post('/public/support/reply',replyLimit,csrfProtect,asyncRoute(async(req,res)=>res.json(await replySupportCase(req.body,serviceDeps))));
 routes.post('/public/support/attachment',readLimit,csrfProtect,asyncRoute(async(req,res)=>{
  const parsed=supportTrackSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Enlace privado inválido.'});
  const row=await getSupportAttachment(parsed.data,serviceDeps);res.type(row.content_type).set('Content-Disposition','inline; filename="captura.webp"').send(row.data);
 }));
 routes.use('/super/support',requireSuperAdmin,csrfProtect);
 routes.get('/super/support/cases',asyncRoute(async(req,res)=>{
  const query=z.object({status:z.enum(['new','open','waiting','resolved','closed']).optional(),offset:z.coerce.number().int().min(0).max(100000).optional()}).strict().safeParse(req.query);
  if(!query.success)return res.status(400).json({error:'Filtro inválido.'});res.json({cases:await listSupportCases(query.data,serviceDeps)});
 }));
 routes.post('/super/support/search',asyncRoute(async(req,res)=>{
  const query=z.object({status:z.enum(['new','open','waiting','resolved','closed']).optional(),search:z.string().max(160).optional(),offset:z.number().int().min(0).max(100000).optional()}).strict().safeParse(req.body);
  if(!query.success)return res.status(400).json({error:'Filtro inválido.'});res.json({cases:await listSupportCases(query.data,serviceDeps)});
 }));
 routes.get('/super/support/cases/:id',asyncRoute(async(req,res)=>{if(!z.uuid().safeParse(req.params.id).success)return res.status(400).json({error:'Caso inválido.'});res.json(await getSupportCase(req.params.id,serviceDeps));}));
 routes.patch('/super/support/cases/:id',asyncRoute(async(req,res)=>{if(!z.uuid().safeParse(req.params.id).success)return res.status(400).json({error:'Caso inválido.'});res.json(await updateSupportCase(req.params.id,req.body,req.superAdmin.email,serviceDeps));}));
 routes.get('/super/support/cases/:id/attachment',asyncRoute(async(req,res)=>{
  if(!z.uuid().safeParse(req.params.id).success)return res.status(400).json({error:'Caso inválido.'});
  const row=await getSupportAttachment({caseId:req.params.id},serviceDeps);res.type(row.content_type).set('Content-Disposition','inline; filename="captura.webp"').send(row.data);
 }));
 return routes;
}
export const supportCaseRoutes=createSupportCaseRoutes();
