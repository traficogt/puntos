import {dateTimeSchema} from '../../utils/date-time-schema.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireStaff,requireOwner } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { csrfProtect } from '../../middleware/csrf.js';
import { asyncRoute } from '../../middleware/common.js';
import * as services from '../services/service-recovery-service.js';
const uuid=z.guid().transform(value=>value.toLowerCase());
const empty=z.object({}).strict();
const query=z.object({status:z.enum(['open','resolved','all']).default('open'),offset:z.string().regex(/^(0|[1-9]\d*)$/).default('0').transform(Number).pipe(z.number().int().max(100000)),customerId:uuid.optional()}).strict();
const report=z.object({customerId:uuid,rewardId:uuid.optional(),redemptionId:uuid.optional(),requestId:uuid,kind:z.enum(['unavailable','unfulfilled']),reason:z.string().trim().min(3).max(500)}).strict();
const resolve=z.object({requestId:uuid,version:z.number().int().min(1).max(2147483646),resolution:z.enum(['original_fulfilled','alternative_accepted','closed_with_reason','points_restored']),reason:z.string().trim().min(3).max(500),attested:z.boolean().optional(),promiseId:uuid.optional(),fulfillmentRewardId:uuid.optional()}).strict();
const invalid=res=>res.status(400).json({error:'Revisa el caso y los datos de la solicitud.',code:'VALIDATION_ERROR'});
export function createServiceRecoveryRoutes(deps={}){
 const router=Router(),s={...services,...deps};
 for(const prefix of ['admin','staff']){
  const base=`/${prefix}/service-cases`,auth=[(_req,res,next)=>{res.set('Cache-Control','no-store');next();},requireStaff,tenantContext,...(prefix==='admin'?[requireOwner]:[])];
  router.use(base,...auth);
  const actor=req=>({businessId:req.tenantId,staff:req.staff});
  router.get(base,asyncRoute(async(req,res)=>{const parsed=query.safeParse(req.query);if(!parsed.success)return invalid(res);return res.json(await s.listServiceCases({...actor(req),...parsed.data}));}));
  router.post(base,csrfProtect,asyncRoute(async(req,res)=>{const parsed=report.safeParse(req.body);if(!parsed.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.createServiceCase({...actor(req),...parsed.data}));}));
  router.get(`${base}/insights`,asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.getServiceInsights(actor(req)));}));
  router.get(`${base}/:caseId`,asyncRoute(async(req,res)=>{const parsed=uuid.safeParse(req.params.caseId);if(!parsed.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.getServiceCase({...actor(req),caseId:parsed.data}));}));
  router.post(`${base}/:caseId/resolve`,csrfProtect,asyncRoute(async(req,res)=>{const parsed=resolve.safeParse(req.body),caseId=uuid.safeParse(req.params.caseId);if(!parsed.success||!caseId.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.resolveServiceCase({...actor(req),...parsed.data,caseId:caseId.data}));}));
  router.post(`${base}/:caseId/manage`,csrfProtect,asyncRoute(async(req,res)=>{const body=z.object({requestId:uuid,version:z.number().int().min(1).max(2147483646),action:z.enum(['assign','escalate','extend_expiry']),reason:z.string().trim().min(3).max(500),assignedStaffId:uuid.nullable().optional(),promiseId:uuid.optional(),extendedUntil:dateTimeSchema({offset:true}).optional()}).strict().safeParse(req.body),id=uuid.safeParse(req.params.caseId);if(!body.success||!id.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.manageServiceCase({...actor(req),caseId:id.data,...body.data}));}));
  router.get(`/${prefix}/service-redemptions`,...auth,asyncRoute(async(req,res)=>{const parsed=z.object({customerId:uuid}).strict().safeParse(req.query);if(!parsed.success)return invalid(res);return res.json(await s.listServiceRedemptions({...actor(req),customerId:parsed.data.customerId}));}));
 }
 return router;
}
