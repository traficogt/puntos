import { Router } from 'express';
import { z } from 'zod';
import { requireStaff, requireOwner, requireStaffPermission } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { csrfProtect } from '../../middleware/csrf.js';
import { requirePlanFeature } from '../../middleware/plan-feature.js';
import { Permission } from '../../utils/permissions.js';
import { asyncRoute } from '../../middleware/common.js';
import * as services from '../services/merchant-launch-service.js';
const empty=z.object({}).strict();
export function createMerchantLaunchRoutes(deps={}){
 const router=Router(),s={...services,...deps},base='/admin/launch/program';
 router.use(base,(_req,res,next)=>{res.set('Cache-Control','no-store');next();},requireStaff,requireOwner,tenantContext,requirePlanFeature('program_rules'));
 router.get(base,asyncRoute(async(req,res)=>{
  if(!empty.safeParse(req.query).success)return res.status(400).json({error:'Esta consulta no acepta parámetros.'});
  return res.json(await s.getLaunchProgram({businessId:req.tenantId}));
 }));
 router.put(base,requireStaffPermission(Permission.ADMIN_PROGRAM_UPDATE_BASIC),csrfProtect,asyncRoute(async(req,res)=>{
  if(!empty.safeParse(req.query).success||!services.LaunchProgramInput.safeParse(req.body).success)return res.status(400).json({error:'Revisa la regla de puntos.',code:'VALIDATION_ERROR'});
  return res.json(await s.updateLaunchProgram({businessId:req.tenantId,staffId:req.staff.id,input:req.body,ip:req.ip,ua:req.get('user-agent')||null,...(req.staff.impersonated_by?{impersonated_by:req.staff.impersonated_by}:{})}));
 }));return router;
}
