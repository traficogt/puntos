import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../../middleware/common.js';
import { moderateRateLimit } from '../../middleware/rate-limit.js';
import { BusinessRepo } from '../repositories/business-repository.js';
import { AcquisitionService, sourceCodePattern } from '../services/acquisition-service.js';
const visitSchema=z.object({source_code:z.string().max(80)}).strict();
export function createAcquisitionPublicRoutes({getBusiness=slug=>BusinessRepo.getPublicBySlug(slug),visit=(business,code)=>AcquisitionService.visit(business,code),rateLimit=moderateRateLimit}={}) {
  const router=Router();
  router.post('/public/business/:slug/acquisition/visit',(_req,res,next)=>{res.set('Cache-Control','no-store');next();},rateLimit,asyncRoute(async(req,res)=>{
    const parsed=visitSchema.safeParse(req.body);
    if(!req.is('application/json') || Object.keys(req.query).length || !parsed.success)return res.status(400).json({error:'Origen no válido.'});
    if(!sourceCodePattern.test(parsed.data.source_code))return res.json({ok:true,visit_token:null});
    const business=await getBusiness(req.params.slug);
    if(!business)return res.json({ok:true,visit_token:null});
    return res.json(await visit(business,parsed.data.source_code));
  }));
  return router;
}
export const acquisitionPublicRoutes=createAcquisitionPublicRoutes();
