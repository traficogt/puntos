import { Router } from 'express';
import { z } from 'zod';
import { requireCustomer,requireStaff,requireOwner } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { csrfProtect } from '../../middleware/csrf.js';
import { requirePlanFeature } from '../../middleware/plan-feature.js';
import { rateLimitByIp,rateLimitByUser } from '../../middleware/rate-limit.js';
import { asyncRoute } from '../../middleware/common.js';
import { getMarketingPreference,setMarketingPreference,tokenMarketingPreference } from '../services/marketing-preference-service.js';
import { getCampaignMessages,queueCampaignMessages } from '../services/campaign-message-service.js';

const Preference=z.object({marketing_opt_in:z.boolean()}).strict();
const Confirm=z.object({confirm:z.literal(true)}).strict();
const Queue=Confirm.extend({request_id:z.guid()}).strict();
const Empty=z.object({}).strict();
const Id=z.guid();
function invalid(res) {return res.status(400).json({error:'Revisa los datos de la solicitud.',code:'VALIDATION_ERROR'});}
function noStore(_req,res,next) {res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();}
export function createGrowthMessagingRoutes({getPreference=getMarketingPreference,setPreference=setMarketingPreference,tokenPreference=tokenMarketingPreference,getMessages=getCampaignMessages,queueMessages=queueCampaignMessages}={}) {
  const router=Router();
  const customer=[noStore,requireCustomer,tenantContext,rateLimitByUser(30,60000)];
  router.get('/customer/marketing-preferences',...customer,asyncRoute(async(req,res)=>{
    if(!Empty.safeParse(req.query).success) return invalid(res);
    return res.json(await getPreference({businessId:req.customerAuth.business_id,customerId:req.customerAuth.id}));
  }));
  router.put('/customer/marketing-preferences',...customer,csrfProtect,asyncRoute(async(req,res)=>{
    const parsed=Preference.safeParse(req.body);if(!parsed.success||!Empty.safeParse(req.query).success)return invalid(res);
    if(req.authSession?.impersonated_by) return res.status(403).json({error:'Confirma esta preferencia desde tu propia sesión.'});
    return res.json(await setPreference({businessId:req.customerAuth.business_id,customerId:req.customerAuth.id,marketing_opt_in:parsed.data.marketing_opt_in}));
  }));
  const publicLimit=rateLimitByIp(30,60000,{keyPrefix:'marketing-unsubscribe:'});
  router.get('/public/marketing-unsubscribe/:token',noStore,publicLimit,asyncRoute(async(req,res)=>{
    if(!Empty.safeParse(req.query).success)return invalid(res);
    return res.json(await tokenPreference({token:req.params.token}));
  }));
  router.post('/public/marketing-unsubscribe/:token',noStore,publicLimit,csrfProtect,asyncRoute(async(req,res)=>{
    if(!Confirm.safeParse(req.body).success||!Empty.safeParse(req.query).success)return invalid(res);
    return res.json(await tokenPreference({token:req.params.token,confirm:true}));
  }));
  const owner=[noStore,requireStaff,requireOwner,tenantContext,requirePlanFeature('campaign_rules'),requirePlanFeature('lifecycle_automation'),requirePlanFeature('analytics'),rateLimitByUser(30,60000)];
  router.get('/admin/growth-campaigns/:id/messages',...owner,asyncRoute(async(req,res)=>{
    if(!Id.safeParse(req.params.id).success||!Empty.safeParse(req.query).success)return invalid(res);
    return res.json(await getMessages({businessId:req.tenantId,campaignId:req.params.id}));
  }));
  router.post('/admin/growth-campaigns/:id/messages/queue',...owner,csrfProtect,asyncRoute(async(req,res)=>{
    const parsed=Queue.safeParse(req.body);
    if(!Id.safeParse(req.params.id).success||!parsed.success||!Empty.safeParse(req.query).success)return invalid(res);
    return res.json(await queueMessages({businessId:req.tenantId,campaignId:req.params.id,request_id:parsed.data.request_id}));
  }));
  return router;
}
