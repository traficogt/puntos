import {Router} from 'express';import {z} from 'zod';
import {requireStaff,requireOwner,requireStaffPermission} from '../../middleware/auth.js';
import {Permission} from '../../utils/permissions.js';
import {tenantContext} from '../../middleware/tenant.js';import {csrfProtect} from '../../middleware/csrf.js';import {asyncRoute} from '../../middleware/common.js';
import * as services from '../services/redemption-pos-service.js';import * as mappingServices from '../services/reward-pos-mapping-service.js';
const uuid=z.guid(),empty=z.object({}).strict();
const query=z.object({status:z.enum(['all','pending','recorded','not_required','review','reviewed','unknown']).default('pending'),code:z.string().regex(/^[a-f0-9]{0,16}$/i).default(''),offset:z.string().regex(/^(0|[1-9]\d*)$/).default('0').transform(Number).pipe(z.number().int().max(100000))}).strict();
const invalid=res=>res.status(400).json({error:'Revisa el canje y los datos de la solicitud.',code:'VALIDATION_ERROR'});
export function createRedemptionPosRoutes(deps={}){
 const router=Router(),s={...services,...mappingServices,...deps};
 for(const prefix of ['admin','staff']){
  const base=`/${prefix}/redemption-pos`;router.use(base,(_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();},requireStaff,tenantContext,...(prefix==='admin'?[requireOwner]:[requireStaffPermission(Permission.STAFF_REDEEM)]));
  const actor=req=>({businessId:req.tenantId,staff:req.staff});
  router.get(base,asyncRoute(async(req,res)=>{const parsed=query.safeParse(req.query);if(!parsed.success)return invalid(res);res.json(await s.listRedemptionPosRecords({...actor(req),...parsed.data}));}));
  router.get(`${base}/:redemptionId`,asyncRoute(async(req,res)=>{if(!uuid.safeParse(req.params.redemptionId).success||!empty.safeParse(req.query).success)return invalid(res);res.json(await s.getRedemptionPosRecord({...actor(req),redemptionId:req.params.redemptionId.toLowerCase()}));}));
  router.post(`${base}/:redemptionId`,csrfProtect,asyncRoute(async(req,res)=>{if(!uuid.safeParse(req.params.redemptionId).success||!empty.safeParse(req.query).success)return invalid(res);res.json(await s.recordManualFulfillment({...actor(req),redemptionId:req.params.redemptionId.toLowerCase(),input:req.body}));}));
 }
 const base='/admin/reward-pos-mappings';router.use(base,(_req,res,next)=>{res.set('Cache-Control','no-store');next();},requireStaff,requireOwner,tenantContext);
 router.get(base,asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);res.json(await s.getRewardPosMappings({businessId:req.tenantId,staff:req.staff}));}));
 router.put(`${base}/:rewardId`,csrfProtect,asyncRoute(async(req,res)=>{if(!uuid.safeParse(req.params.rewardId).success||!empty.safeParse(req.query).success)return invalid(res);res.json(await s.saveRewardPosMapping({businessId:req.tenantId,staff:req.staff,rewardId:req.params.rewardId.toLowerCase(),input:req.body}));}));
 return router;
}
export const redemptionPosRoutes=createRedemptionPosRoutes();
