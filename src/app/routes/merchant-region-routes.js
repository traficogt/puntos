import { Router } from 'express';
import { requireStaff, requireOwner } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { csrfProtect } from '../../middleware/csrf.js';
import { asyncRoute } from '../../middleware/common.js';
import { getMerchantRegion, updateMerchantRegion } from '../services/merchant-region-service.js';
export function createMerchantRegionRoutes(deps = {}) {
  const service = {getMerchantRegion,updateMerchantRegion,...deps}, router=Router(), base='/admin/region';
  router.use(base,(_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();},requireStaff,requireOwner,tenantContext);
  router.use(base,(req,res,next)=>(Object.keys(req.query).length || req.method==='GET' && Object.keys(req.body??{}).length)?res.status(400).json({error:'Esta configuración usa el negocio de tu sesión.'}):next());
  router.get(base,asyncRoute(async(req,res)=>res.json(await service.getMerchantRegion({businessId:req.tenantId}))));
  router.put(base,csrfProtect,asyncRoute(async(req,res)=>res.json(await service.updateMerchantRegion({businessId:req.tenantId,staffId:req.staff.id,impersonated_by:req.staff.impersonated_by??null,input:req.body}))));
  return router;
}
export const merchantRegionRoutes=createMerchantRegionRoutes();
