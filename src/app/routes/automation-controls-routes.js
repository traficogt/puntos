import {SecondVisitSettings,getSecondVisitControls,saveSecondVisitSettings} from "../services/second-visit-service.js";
import {WeeklyBriefSettings,getWeeklyBriefControls,saveWeeklyBriefSettings,previewWeeklyOwnerBrief,retryWeeklyOwnerBrief,requestOwnerBriefEmailVerification,confirmOwnerBriefEmailVerification,requestWeeklyOwnerBriefTest} from "../services/weekly-owner-brief-service.js";
import {Router} from 'express';
import {z} from 'zod';
import {requireStaff,requireOwner} from '../../middleware/auth.js';
import {tenantContext} from '../../middleware/tenant.js';
import {requirePlanFeature} from '../../middleware/plan-feature.js';
import {csrfProtect} from '../../middleware/csrf.js';
import {asyncRoute} from '../../middleware/common.js';
import {AutomationSettings,getAutomationControls,saveAutomationSettings} from '../services/automation-controls-service.js';
const Empty=z.object({}).strict();
export function createAutomationControlsRoutes(deps={}) {
  const router=Router();const base='/admin/automations';
  router.use(base,(_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();},requireStaff,requireOwner,tenantContext,requirePlanFeature('lifecycle_automation'));
  router.get(base,asyncRoute(async(req,res)=>{
    if(!Empty.safeParse(req.query).success||!Empty.safeParse(req.body??{}).success||req.get('Transfer-Encoding')||Number(req.get('Content-Length')||0)>0)return res.status(400).json({error:'Esta consulta no acepta parámetros ni cuerpo.',code:'VALIDATION_ERROR'});
    return res.json(await(deps.getAutomationControls??getAutomationControls)({businessId:req.tenantId}));
  }));
  router.put(base,csrfProtect,asyncRoute(async(req,res)=>{
    const parsed=AutomationSettings.safeParse(req.body);
    if(!parsed.success||!Empty.safeParse(req.query).success)return res.status(400).json({error:'Revisa los límites, el horario y el presupuesto de cada incentivo.',code:'VALIDATION_ERROR'});
    return res.json(await(deps.saveAutomationSettings??saveAutomationSettings)({businessId:req.tenantId,staffId:req.staff.id,ip:req.ip,ua:req.get('user-agent')||null,settings:parsed.data}));
  }));
  const actor=req=>({businessId:req.tenantId,staffId:req.staff.id,ip:req.ip,ua:req.get('user-agent')||null,...(req.staff.impersonated_by?{impersonated_by:req.staff.impersonated_by}:{})});
  const invalid=res=>res.status(400).json({error:'Revisa los datos de esta solicitud.',code:'VALIDATION_ERROR'});
  for(const [suffix,schema,read,save] of [
   ['second-visit',SecondVisitSettings,deps.getSecondVisitControls??getSecondVisitControls,deps.saveSecondVisitSettings??saveSecondVisitSettings],
   ['owner-brief',WeeklyBriefSettings,deps.getWeeklyBriefControls??getWeeklyBriefControls,deps.saveWeeklyBriefSettings??saveWeeklyBriefSettings]
  ]){
   router.get(`${base}/${suffix}`,asyncRoute(async(req,res)=>{
    if(!Empty.safeParse(req.query).success||!Empty.safeParse(req.body??{}).success||req.get('Transfer-Encoding')||Number(req.get('Content-Length')||0)>0)return invalid(res);
    return res.json(await read(actor(req)));
   }));
   router.put(`${base}/${suffix}`,csrfProtect,asyncRoute(async(req,res)=>{
    const parsed=schema.safeParse(req.body);if(!parsed.success||!Empty.safeParse(req.query).success)return invalid(res);
    return res.json(await save({...actor(req),settings:parsed.data}));
   }));
  }
  router.post(`${base}/owner-brief/preview`,csrfProtect,asyncRoute(async(req,res)=>{
   if(!Empty.safeParse(req.query).success||!Empty.safeParse(req.body??{}).success)return invalid(res);
   return res.json(await(deps.previewWeeklyOwnerBrief??previewWeeklyOwnerBrief)(actor(req)));
  }));
  const Request=z.object({request_id:z.guid()}).strict();
  for(const [suffix,schema,action] of [
   ['email-verification/request',Request,deps.requestOwnerBriefEmailVerification??requestOwnerBriefEmailVerification],
   ['email-verification/confirm',Request.extend({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}),deps.confirmOwnerBriefEmailVerification??confirmOwnerBriefEmailVerification],
   ['test',Request,deps.requestWeeklyOwnerBriefTest??requestWeeklyOwnerBriefTest]
  ])router.post(`${base}/owner-brief/${suffix}`,csrfProtect,asyncRoute(async(req,res)=>{
   const parsed=schema.safeParse(req.body);if(!parsed.success||!Empty.safeParse(req.query).success)return invalid(res);
   return res.json(await action({...actor(req),requestId:parsed.data.request_id,...('token' in parsed.data?{token:parsed.data.token}:{})}));
  }));
  router.post(`${base}/owner-brief/:id/retry`,csrfProtect,asyncRoute(async(req,res)=>{
   const id=z.guid().safeParse(req.params.id);if(!id.success||!Empty.safeParse(req.query).success||!Empty.safeParse(req.body??{}).success)return invalid(res);
   return res.json(await(deps.retryWeeklyOwnerBrief??retryWeeklyOwnerBrief)({...actor(req),id:id.data}));
  }));return router;
}
