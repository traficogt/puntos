import {Router} from 'express';import {z} from 'zod';
import {requireStaff,requireOwner} from '../../middleware/auth.js';import {tenantContext} from '../../middleware/tenant.js';import {csrfProtect} from '../../middleware/csrf.js';import {asyncRoute} from '../../middleware/common.js';
import {getDecisionInbox,reviewDecision,setOperatingMode,ReviewDecisionInput,OperatingModeInput} from '../services/merchant-decisions-service.js';
export function createMerchantDecisionsRoutes(deps={}){
 const s={getDecisionInbox,reviewDecision,setOperatingMode,...deps},router=Router(),base='/admin/decisions',empty=z.object({}).strict();
 const actor=req=>({businessId:req.tenantId,staffId:req.staff.id,ip:req.ip,ua:req.get('user-agent')??null,impersonated_by:req.staff.impersonated_by??null});
 const invalid=res=>res.status(400).json({error:'Revisa los datos de esta solicitud.',code:'VALIDATION_ERROR'});
 router.use(base,(_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();},requireStaff,requireOwner,tenantContext);
 router.get(base,asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success||!empty.safeParse(req.body??{}).success)return invalid(res);res.json(await s.getDecisionInbox({businessId:req.tenantId}));}));
 router.post(`${base}/review`,csrfProtect,asyncRoute(async(req,res)=>{const input=ReviewDecisionInput.safeParse(req.body);if(!input.success||!empty.safeParse(req.query).success)return invalid(res);res.json(await s.reviewDecision({...actor(req),input:input.data}));}));
 router.post(`${base}/operating-mode`,csrfProtect,asyncRoute(async(req,res)=>{const input=OperatingModeInput.safeParse(req.body);if(!input.success||!empty.safeParse(req.query).success)return invalid(res);res.json(await s.setOperatingMode({...actor(req),input:input.data}));}));
 return router;
}
export const merchantDecisionsRoutes=createMerchantDecisionsRoutes();
