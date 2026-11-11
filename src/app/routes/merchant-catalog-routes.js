import {Router} from 'express';
import {z} from 'zod';
import {requireStaff,requireOwner} from '../../middleware/auth.js';
import {tenantContext} from '../../middleware/tenant.js';
import {csrfProtect} from '../../middleware/csrf.js';
import {asyncRoute} from '../../middleware/common.js';
import * as services from '../services/merchant-catalog-service.js';
import {catalogListSchema} from '../services/merchant-catalog-model.js';
const empty=z.object({}).strict();
const invalid=res=>res.status(400).json({error:'Revisa los campos y la paginación del catálogo.',code:'VALIDATION_ERROR'});
export function createMerchantCatalogRoutes(deps={}){
 const router=Router(),s={...services,...deps},base='/admin/merchant-catalog';
 router.use(base,(_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();},requireStaff,tenantContext,requireOwner);
 const actor=req=>({businessId:req.tenantId,staff:req.staff});
 router.get(base,asyncRoute(async(req,res)=>{const parsed=catalogListSchema.safeParse(req.query);if(!parsed.success)return invalid(res);res.json(await s.listMerchantCatalog({...actor(req),...parsed.data}));}));
 router.put(`${base}/items`,csrfProtect,asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);res.json(await s.saveManualCatalogItem({...actor(req),input:req.body}));}));
 router.post(`${base}/csv/preview`,csrfProtect,asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);res.json(await s.previewCatalogCsv({...actor(req),input:req.body}));}));
 router.post(`${base}/csv/import`,csrfProtect,asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);res.json(await s.importCatalogCsv({...actor(req),input:req.body}));}));
 return router;
}
export const merchantCatalogRoutes=createMerchantCatalogRoutes();
