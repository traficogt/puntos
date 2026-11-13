import {Router} from 'express';
import {z} from 'zod';
import {requireStaff,requireOwner,requireSuperAdmin} from '../../middleware/auth.js';
import {tenantContext} from '../../middleware/tenant.js';
import {csrfProtect} from '../../middleware/csrf.js';
import {asyncRoute} from '../../middleware/common.js';
import {getDataHealth,saveDataHealth,healthSettingsSchema} from '../services/data-health-service.js';
import {getPlatformOperationsHealth} from '../services/platform-health-service.js';
const empty=z.object({}).strict();
const page=z.object({limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).max(1000000).default(0)}).strict();
const noStore=(_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();};
const invalid=res=>res.status(400).json({error:'Revisa los datos enviados.',code:'VALIDATION_ERROR'});
export function createDataHealthRoutes(injected={}){
 const s={getDataHealth,saveDataHealth,getPlatformOperationsHealth,...injected},router=Router();
 router.get('/admin/data-health',noStore,requireStaff,requireOwner,tenantContext,asyncRoute(async(req,res)=>{
  if(!empty.safeParse(req.query).success||!empty.safeParse(req.body??{}).success)return invalid(res);
  return res.json(await s.getDataHealth({businessId:req.tenantId}));
 }));
 router.put('/admin/data-health',noStore,requireStaff,requireOwner,tenantContext,csrfProtect,asyncRoute(async(req,res)=>{
  const input=healthSettingsSchema.safeParse(req.body);if(!input.success||!empty.safeParse(req.query).success)return invalid(res);
  return res.json(await s.saveDataHealth({businessId:req.tenantId,staffId:req.staff.id,impersonated_by:req.staff.impersonated_by??null,input:input.data}));
 }));
 router.get('/super/operations-health',noStore,requireSuperAdmin,asyncRoute(async(req,res)=>{
  const input=page.safeParse(req.query);if(!input.success||!empty.safeParse(req.body??{}).success)return invalid(res);
  return res.json(await s.getPlatformOperationsHealth(input.data));
 }));
 return router;
}
export const dataHealthRoutes=createDataHealthRoutes();
