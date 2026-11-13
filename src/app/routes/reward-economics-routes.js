import { Router } from 'express';
import { z } from 'zod';
import { requireStaff, requireOwner } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { requirePlanFeature } from '../../middleware/plan-feature.js';
import { csrfProtect } from '../../middleware/csrf.js';
import { asyncRoute } from '../../middleware/common.js';
import * as services from '../services/reward-economics-service.js';
import { getServiceRestorationCosts,getIssuedCommitments } from '../services/reward-commitment-service.js';

const decimal = (max, places) => z.number().finite().min(0).max(max).refine(value => Math.abs(value * (10 ** places) - Math.round(value * (10 ** places))) < 0.000001).nullable();
const settingsBody = z.object({gross_margin_pct:decimal(100,2),cost_per_point_q:decimal(1000,6)}).strict();
const costBody = z.object({unit_cost_q:decimal(1000000,2),retail_value_q:decimal(1000000,2).optional()}).strict();
const query = z.object({
  days:z.enum(['30','90']).default('30').transform(Number),
  offset:z.string().regex(/^(0|[1-9]\d*)$/).default('0').transform(Number).pipe(z.number().int().max(100000))
}).strict();
const uuid = z.guid().transform(value => value.toLowerCase());
const empty = z.object({}).strict();
const actor = req => ({businessId:req.tenantId,staffId:req.staff.id,ip:req.ip,ua:req.get('user-agent') || null,...(req.staff.impersonated_by ? {impersonated_by:req.staff.impersonated_by} : {})});
const invalid = res => res.status(400).json({error:'Revisa los importes y los datos de esta solicitud.',code:'VALIDATION_ERROR'});

export function createRewardEconomicsRoutes(deps = {}) {
  const s={...services,getServiceRestorationCosts,getIssuedCommitments,...deps},router=Router(),base='/admin/reward-economics';
  router.use(base,(_req,res,next)=>{res.set('Cache-Control','no-store');next();},requireStaff,tenantContext,requireOwner,requirePlanFeature('analytics'));
  router.get(base,asyncRoute(async(req,res)=>{
    const parsed=query.safeParse(req.query);
    if(!parsed.success)return invalid(res);
    return res.json(await s.getRewardEconomics({businessId:req.tenantId,...parsed.data}));
  }));
  router.get(`${base}/commitments`,asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.getIssuedCommitments({businessId:req.tenantId}));}));
  router.get(`${base}/service-restorations`,asyncRoute(async(req,res)=>{
    const parsed=z.object({days:query.shape.days}).strict().safeParse(req.query);
    if(!parsed.success)return invalid(res);
    return res.json(await s.getServiceRestorationCosts({businessId:req.tenantId,...parsed.data}));
  }));
  router.put(`${base}/settings`,csrfProtect,asyncRoute(async(req,res)=>{
    const parsed=settingsBody.safeParse(req.body);
    if(!parsed.success || !empty.safeParse(req.query).success)return invalid(res);
    return res.json(await s.updateRewardEconomicsSettings({...actor(req),grossMarginPct:parsed.data.gross_margin_pct,costPerPointQ:parsed.data.cost_per_point_q}));
  }));
  router.put(`${base}/rewards/:rewardId`,csrfProtect,asyncRoute(async(req,res)=>{
    const parsed=costBody.safeParse(req.body),reward=uuid.safeParse(req.params.rewardId);
    if(!parsed.success || !reward.success || !empty.safeParse(req.query).success)return invalid(res);
    return res.json(await s.updateRewardUnitCost({...actor(req),rewardId:reward.data,unitCostQ:parsed.data.unit_cost_q,retailValueQ:parsed.data.retail_value_q}));
  }));
  return router;
}
