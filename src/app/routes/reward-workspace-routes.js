import {Router} from 'express';
import {z} from 'zod';
import {requireStaff,requireOwner} from '../../middleware/auth.js';
import {tenantContext} from '../../middleware/tenant.js';
import {csrfProtect} from '../../middleware/csrf.js';
import {asyncRoute} from '../../middleware/common.js';
import {rateLimitByUser} from '../../middleware/rate-limit.js';
import * as services from '../services/reward-workspace-service.js';
const empty=z.object({}).strict();
const invalid=res=>res.status(400).json({error:'Esta solicitud no admite parámetros adicionales.',code:'VALIDATION_ERROR'});
export function createRewardWorkspaceRoutes(deps={}){
 const router=Router(),s={...services,...deps},base='/admin/reward-workspace';
 router.use(base,(_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();},requireStaff,tenantContext,requireOwner);
 const actor=req=>({businessId:req.tenantId,staff:req.staff});
 router.get(base,asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);res.json(await s.getRewardWorkspace(actor(req)));}));
 router.post(base,csrfProtect,rateLimitByUser(100,60_000),asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);res.json(await s.saveRewardWorkspace({...actor(req),input:req.body}));}));
 return router;
}
export const rewardWorkspaceRoutes=createRewardWorkspaceRoutes();
