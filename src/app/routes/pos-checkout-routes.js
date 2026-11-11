import {Router} from 'express';
import {requireStaff,requireOwner} from '../../middleware/auth.js';
import {tenantContext} from '../../middleware/tenant.js';
import {csrfProtect} from '../../middleware/csrf.js';
import {asyncRoute} from '../../middleware/common.js';
import * as services from '../services/pos-checkout-config.js';
export function createPosCheckoutRoutes(deps={}){
 const router=Router(),s={...services,...deps},base='/admin/pos-checkout/sources';
 router.use(base,(_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();},requireStaff,tenantContext,requireOwner);
 const actor=req=>({businessId:req.tenantId,staff:req.staff});
 router.get(base,asyncRoute(async(req,res)=>{if(Object.keys(req.query).length)return res.status(400).json({error:'No se admiten filtros.'});res.json(await s.getCheckoutSources(actor(req)));}));
 router.put(base,csrfProtect,asyncRoute(async(req,res)=>{if(Object.keys(req.query).length)return res.status(400).json({error:'No se admiten filtros.'});res.json(await s.configureCheckoutSource({...actor(req),input:req.body}));}));
 return router;
}
export const posCheckoutRoutes=createPosCheckoutRoutes();
