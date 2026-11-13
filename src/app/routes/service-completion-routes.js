import {Router} from 'express';
import {z} from 'zod';
import {requireStaff,requireOwner} from '../../middleware/auth.js';
import {tenantContext} from '../../middleware/tenant.js';
import {csrfProtect} from '../../middleware/csrf.js';
import {asyncRoute} from '../../middleware/common.js';
import * as services from '../services/service-completion-service.js';
const empty=z.object({}).strict(),uuid=z.guid().transform(value=>value.toLowerCase()),version=z.number().int().min(1).max(2147483646);
const step=z.object({requestId:uuid,version,action:z.enum(['signup','earn','ineligibility','unlock','redeem','refund']),quantity:z.number().positive().max(1000000).optional(),rewardId:uuid.optional()}).strict();
const invalid=res=>res.status(400).json({error:'Revisa los datos de la práctica o del resumen.',code:'VALIDATION_ERROR'});
export function createServiceCompletionRoutes(deps={}){
 const router=Router(),s={...services,...deps};
 for(const prefix of ['staff','admin']){
  const base=`/${prefix}/service-operations`,actor=req=>({businessId:req.tenantId,staff:req.staff});
  router.use(base,(_req,res,next)=>{res.set('Cache-Control','no-store');next();},requireStaff,tenantContext,...(prefix==='admin'?[requireOwner]:[]));
  router.get(`${base}/briefing`,asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.getAutomaticBriefing(actor(req)));}));
  router.post(`${base}/briefing/:id/ack`,csrfProtect,asyncRoute(async(req,res)=>{const id=uuid.safeParse(req.params.id),body=z.object({version}).strict().safeParse(req.body);if(!id.success||!body.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.acknowledgeAutomaticBriefing({...actor(req),briefingId:id.data,...body.data}));}));
  router.get(`${base}/rehearsal`,asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.getRehearsal(actor(req)));}));
  router.post(`${base}/rehearsal`,csrfProtect,asyncRoute(async(req,res)=>{const body=z.object({requestId:uuid}).strict().safeParse(req.body);if(!body.success||!empty.safeParse(req.query).success)return invalid(res);return res.status(201).json(await s.startRehearsal({...actor(req),requestId:body.data.requestId}));}));
  router.post(`${base}/rehearsal/:id/step`,csrfProtect,asyncRoute(async(req,res)=>{const id=uuid.safeParse(req.params.id),body=step.safeParse(req.body);if(!id.success||!body.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.advanceRehearsal({...actor(req),rehearsalId:id.data,...body.data,requestId:body.data.requestId}));}));
 }
 return router;
}
export const serviceCompletionRoutes=createServiceCompletionRoutes();
