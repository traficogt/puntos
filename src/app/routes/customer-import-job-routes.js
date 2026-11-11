import { Router } from 'express';
import { requireStaff, requireOwner } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { csrfProtect } from '../../middleware/csrf.js';
import { asyncRoute } from '../../middleware/common.js';
import * as imports from '../services/customer-import-job-service.js';
export function createCustomerImportJobRoutes(deps={}){
 const s={...imports,...deps},router=Router(),base='/admin/customer-import-jobs';
 router.use(base,(_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();},requireStaff,requireOwner,tenantContext);
 router.use(base,(req,res,next)=>(Object.keys(req.query).length || req.method==='GET' && Object.keys(req.body??{}).length)?res.status(400).json({error:'La importación usa el negocio de tu sesión.'}):next());
 const actor=req=>({businessId:req.tenantId,staffId:req.staff.id,impersonated_by:req.staff.impersonated_by??null});
 router.get(base,asyncRoute(async(req,res)=>res.json(await s.listCustomerImportJobs(actor(req)))));
 router.post(`${base}/preview`,csrfProtect,asyncRoute(async(req,res)=>res.json(await s.previewCustomerImportJob({...actor(req),input:req.body}))));
 router.post(base,csrfProtect,asyncRoute(async(req,res)=>res.status(202).json(await s.createCustomerImportJob({...actor(req),input:req.body}))));
 for(const action of ['cancel','retry'])router.post(`${base}/:id/${action}`,csrfProtect,asyncRoute(async(req,res)=>{
  if(Object.keys(req.body??{}).length)return res.status(400).json({error:'Esta acción no admite otros datos.'});
  return res.json(await s.controlCustomerImportJob({...actor(req),id:req.params.id,action}));
 }));
 return router;
}
export const customerImportJobRoutes=createCustomerImportJobRoutes();
