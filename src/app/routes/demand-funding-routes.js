import {Router} from 'express';
import {z} from 'zod';
import {requireStaff,requireOwner,requireCustomer} from '../../middleware/auth.js';
import {tenantContext} from '../../middleware/tenant.js';
import {csrfProtect} from '../../middleware/csrf.js';
import {asyncRoute} from '../../middleware/common.js';
import * as service from '../services/demand-funding-service.js';
import {DEMAND_CATEGORIES,DEMAND_STATUSES} from '../services/demand-funding-model.js';
const uuid=z.guid().transform(v=>v.toLowerCase()),empty=z.object({}).strict();
const offset=z.string().regex(/^(0|[1-9]\d*)$/).default('0').transform(Number).pipe(z.number().int().max(100000));
const entry=z.object({request_id:uuid,category:z.enum(DEMAND_CATEGORIES),topic:z.string().trim().min(3).max(120),note:z.string().trim().max(1000).default(''),reward_id:uuid.nullable().optional(),product_context:z.string().trim().max(200).nullable().optional()}).strict();
const triage=z.object({request_id:uuid,version:z.number().int().min(1).max(2147483646),status:z.enum(DEMAND_STATUSES),note:z.string().trim().min(3).max(1000),follow_up_at:z.iso.datetime({offset:true}).nullable().optional()}).strict();
const agreement=z.object({request_id:uuid,supplier_name:z.string().trim().min(2).max(120),title:z.string().trim().min(3).max(120),reward_ids:z.array(uuid).min(1).max(100),starts_at:z.iso.datetime({offset:true}).optional(),ends_at:z.iso.datetime({offset:true}).optional(),starts_on:z.iso.date().optional(),ends_on:z.iso.date().optional(),currency:z.string().regex(/^[A-Z]{3}$/),unit_amount:z.number().finite().positive().max(100000000),cap_amount:z.number().finite().positive().max(10000000000)}).strict().refine(v=>Boolean(v.starts_at&&v.ends_at&&!v.starts_on&&!v.ends_on)||Boolean(v.starts_on&&v.ends_on&&!v.starts_at&&!v.ends_at));
const claim=z.object({request_id:uuid,redemption_id:uuid}).strict();
const transition=z.object({request_id:uuid,version:z.number().int().min(1).max(2147483646),status:z.enum(['submitted','approved','rejected','paid']),reference:z.string().trim().min(3).max(200),paid_minor:z.number().int().positive().safe().optional(),paid_at:z.iso.date().optional()}).strict();
const invalid=res=>res.status(400).json({error:'Revisa los datos del pedido o la reclamación.',code:'VALIDATION_ERROR'});
const actor=req=>({businessId:req.tenantId,staff:req.staff});
const noStore=(_req,res,next)=>{res.set('Cache-Control','no-store');next();};
export function createDemandFundingRoutes(deps={}){
 const s={...service,...deps},router=Router();
 for(const source of ['staff','customer']){
  const base=`/${source}/demand-notebook`;
  router.use(base,noStore,source==='staff'?requireStaff:requireCustomer,tenantContext);
  const identity=req=>({...actor(req),source,...(source==='customer'?{customerId:req.customerAuth.id,customerAuth:req.customerAuth}:{})});
  router.get(base,asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.getDemandEntry(identity(req)));}));
  router.post(base,csrfProtect,asyncRoute(async(req,res)=>{
   const parsed=(source==='staff'?entry.extend({customer_id:uuid.nullable().optional()}):entry).safeParse(req.body);if(!parsed.success||!empty.safeParse(req.query).success)return invalid(res);const v=parsed.data;
   return res.json(await s.createDemandRequest({...identity(req),requestId:v.request_id,category:v.category,topic:v.topic,note:v.note,rewardId:v.reward_id,productContext:v.product_context,...(source==='staff'?{customerId:('customer_id' in v?v.customer_id:null)??null}:{})}));
  }));
 }
 router.use('/admin/demand-notebook',noStore,requireStaff,tenantContext,requireOwner);
 router.get('/admin/demand-notebook',asyncRoute(async(req,res)=>{const parsed=z.object({status:z.enum(['all',...DEMAND_STATUSES]).default('all'),offset}).strict().safeParse(req.query);if(!parsed.success)return invalid(res);return res.json(await s.listDemandTopics({...actor(req),...parsed.data}));}));
 router.get('/admin/demand-notebook/:id',asyncRoute(async(req,res)=>{const id=uuid.safeParse(req.params.id);if(!id.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.getDemandTopic({...actor(req),topicId:id.data}));}));
 router.post('/admin/demand-notebook/:id/triage',csrfProtect,asyncRoute(async(req,res)=>{const id=uuid.safeParse(req.params.id),p=triage.safeParse(req.body);if(!id.success||!p.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.triageDemandTopic({...actor(req),topicId:id.data,...p.data,requestId:p.data.request_id}));}));
 router.use('/admin/supplier-funding',noStore,requireStaff,tenantContext,requireOwner);
 router.get('/admin/supplier-funding',asyncRoute(async(req,res)=>{const p=z.object({offset}).strict().safeParse(req.query);if(!p.success)return invalid(res);return res.json(await s.getSupplierFunding({...actor(req),...p.data}));}));
 router.post('/admin/supplier-funding/agreements',csrfProtect,asyncRoute(async(req,res)=>{const p=agreement.safeParse(req.body);if(!p.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.createSupplierAgreement({...actor(req),...p.data,requestId:p.data.request_id}));}));
 router.post('/admin/supplier-funding/agreements/:id/close',csrfProtect,asyncRoute(async(req,res)=>{const id=uuid.safeParse(req.params.id);if(!id.success||!empty.safeParse(req.body).success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.closeSupplierAgreement({...actor(req),agreementId:id.data}));}));
 router.get('/admin/supplier-funding/agreements/:id/eligible',asyncRoute(async(req,res)=>{const id=uuid.safeParse(req.params.id),p=z.object({offset}).strict().safeParse(req.query);if(!id.success||!p.success)return invalid(res);return res.json(await s.listEligibleSupplierRedemptions({...actor(req),agreementId:id.data,...p.data}));}));
 router.get('/admin/supplier-funding/agreements/:id/export',asyncRoute(async(req,res)=>{const id=uuid.safeParse(req.params.id);if(!id.success||!empty.safeParse(req.query).success)return invalid(res);return res.json({ok:true,csv:await s.exportSupplierClaims({...actor(req),agreementId:id.data}),filename:`reclamaciones-${id.data}.csv`});}));
 router.post('/admin/supplier-funding/agreements/:id/claims',csrfProtect,asyncRoute(async(req,res)=>{const id=uuid.safeParse(req.params.id),p=claim.safeParse(req.body);if(!id.success||!p.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.createSupplierClaim({...actor(req),agreementId:id.data,requestId:p.data.request_id,redemptionId:p.data.redemption_id}));}));
 router.get('/admin/supplier-funding/claims/:id',asyncRoute(async(req,res)=>{const id=uuid.safeParse(req.params.id);if(!id.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.getSupplierClaim({...actor(req),claimId:id.data}));}));
 router.post('/admin/supplier-funding/claims/:id/transition',csrfProtect,asyncRoute(async(req,res)=>{const id=uuid.safeParse(req.params.id),p=transition.safeParse(req.body);if(!id.success||!p.success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.transitionSupplierClaim({...actor(req),claimId:id.data,...p.data,requestId:p.data.request_id}));}));
 return router;
}
