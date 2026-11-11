import { Router } from 'express';
import { requireOwner, requireStaff } from '../../../middleware/auth.js';
import { csrfProtect } from '../../../middleware/csrf.js';
import { tenantContext } from '../../../middleware/tenant.js';
import { asyncRoute } from '../../../middleware/common.js';
import { config } from '../../../config/index.js';
import { hasPlanFeature, normalizePlan } from '../../../utils/plan.js';
import { BusinessRepo } from '../../repositories/business-repository.js';
import { PlanConfigService } from '../../services/plan-config-service.js';
import { AcquisitionService, acquisitionSourceUrl, sourceInputSchema } from '../../services/acquisition-service.js';

/** @param {{staffAuth?: import("express").RequestHandler, getBusiness?: (id: string) => Promise<any>, getPlanFeatureOverrides?: () => Promise<any>, service?: Pick<typeof AcquisitionService,"listSources"|"report"|"createSource">, appOrigin?: string}} [deps] */
export function createAdminAcquisitionRoutes({staffAuth=requireStaff,getBusiness=id=>BusinessRepo.getById(id),getPlanFeatureOverrides=()=>PlanConfigService.getPlanFeatureOverrides(),service=AcquisitionService,appOrigin=config.APP_ORIGIN}={}) {
  const router=Router();
  const guards=[(_req,res,next)=>{res.set('Cache-Control','private, no-store');next();},staffAuth,requireOwner,tenantContext];
  async function context(req,res){
    if(!req.tenantId){res.status(401).json({error:'Contexto de negocio requerido'});return null;}
    const business=await getBusiness(req.tenantId);
    if(!business || String(business.id)!==String(req.tenantId)){res.status(404).json({error:'Negocio no encontrado'});return null;}
    const overrides=await getPlanFeatureOverrides();
    if(!['EMPRENDEDOR','NEGOCIO','EMPRESA'].includes(normalizePlan(business.plan)) || !hasPlanFeature(business.plan,'analytics',overrides)){
      res.status(403).json({error:'La medición de orígenes requiere analítica en tu plan.',code:'PLAN_FEATURE_LOCKED',feature:'analytics',suggested_plan:'NEGOCIO'});return null;
    }
    if(Object.keys(req.query).length){res.status(400).json({error:'Usa el negocio de tu sesión, sin filtros adicionales.'});return null;}
    return business;
  }
  router.get('/admin/acquisition',...guards,asyncRoute(async(req,res)=>{const business=await context(req,res);if(business)res.json(await service.report(business,appOrigin));}));
  router.get('/admin/acquisition/sources',...guards,asyncRoute(async(req,res)=>{const business=await context(req,res);if(business)res.json(await service.listSources(business,appOrigin));}));
  router.post('/admin/acquisition/sources',...guards,csrfProtect,asyncRoute(async(req,res)=>{
    const business=await context(req,res);if(!business)return;
    const parsed=sourceInputSchema.safeParse(req.body);
    if(!req.is('application/json') || !parsed.success)return res.status(400).json({error:'Revisa el nombre y la sucursal del origen.'});
    const source=await service.createSource(business,parsed.data);
    return res.status(201).json({ok:true,source:{...source,registration_url:acquisitionSourceUrl(business,appOrigin,source)}});
  }));
  return router;
}
export const adminAcquisitionRoutes=createAdminAcquisitionRoutes();
