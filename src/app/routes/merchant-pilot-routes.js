import { Router } from 'express';
import { z } from 'zod';
import { requireStaff, requireOwner } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { requirePlanFeature } from '../../middleware/plan-feature.js';
import { csrfProtect } from '../../middleware/csrf.js';
import { asyncRoute } from '../../middleware/common.js';
import * as services from '../services/merchant-pilot-service.js';
const uuid=z.guid().transform(v=>v.toLowerCase()),empty=z.object({}).strict();
const create=z.object({request_id:uuid,name:z.string().trim().min(1).max(100),duration_days:z.union([z.literal(14),z.literal(30),z.literal(60)]),pos_profile:services.PilotPosProfile.nullable().optional()}).strict();
const evidence=z.object({status:z.enum(['pending','passed','failed','not_applicable']),note:z.string().trim().max(500)}).strict();
const close=z.object({outcome:z.enum(['completed','stopped']),note:z.string().trim().max(500)}).strict().refine(v=>v.outcome!=='stopped'||v.note.length>0);
const params=z.object({id:uuid}).strict();
const list=z.object({offset:z.string().regex(/^(0|[1-9]\d*)$/).default('0').transform(Number).pipe(z.number().int().max(100000))}).strict();
const actor=req=>({businessId:req.tenantId,staffId:req.staff.id,ip:req.ip,ua:req.get('user-agent')||null});
const invalid=res=>res.status(400).json({error:'Revisa los datos de esta solicitud.',code:'VALIDATION_ERROR'});
export function createMerchantPilotRoutes(deps={}){
 const s={...services,...deps},router=Router(),base='/admin/pilots';
 router.use(base,(_req,res,next)=>{res.set('Cache-Control','no-store');next();},requireStaff,tenantContext,requireOwner,requirePlanFeature('analytics'));
 router.get(base,asyncRoute(async(req,res)=>{const p=list.safeParse(req.query);if(!p.success)return invalid(res);return res.json(await s.listPilots({businessId:req.tenantId,offset:p.data.offset}));}));
 router.post(base,csrfProtect,asyncRoute(async(req,res)=>{const p=create.safeParse(req.body);if(!p.success||!empty.safeParse(req.query).success)return invalid(res);return res.status(201).json(await s.createPilot({...actor(req),requestId:p.data.request_id,name:p.data.name,durationDays:p.data.duration_days,...(p.data.pos_profile!==undefined?{posProfile:p.data.pos_profile}:{})}));}));
 router.get(`${base}/:id`,asyncRoute(async(req,res)=>{const p=params.safeParse(req.params);if(!p.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.getPilot({businessId:req.tenantId,pilotId:p.data.id}));}));
 router.put(`${base}/:id/checks/:key`,csrfProtect,asyncRoute(async(req,res)=>{
  const id=uuid.safeParse(req.params.id),p=evidence.safeParse(req.body),key=req.params.key;
  if(!id.success||!p.success||!empty.safeParse(req.query).success||!services.PILOT_CHECKS.some(c=>c.key===key))return invalid(res);
  return res.json(await s.updatePilotCheck({...actor(req),pilotId:id.data,key,status:p.data.status,note:p.data.note}));
 }));
 router.post(`${base}/:id/close`,csrfProtect,asyncRoute(async(req,res)=>{const id=params.safeParse(req.params),p=close.safeParse(req.body);if(!id.success||!p.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.closePilot({...actor(req),pilotId:id.data.id,...p.data}));}));
 return router;
}
