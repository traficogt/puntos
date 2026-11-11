import { dateTimeSchema } from '../../utils/date-time-schema.js';
import {Router} from 'express';
import {z} from 'zod';
import {requireStaff,requireOwner} from '../../middleware/auth.js';
import {tenantContext} from '../../middleware/tenant.js';
import {csrfProtect} from '../../middleware/csrf.js';
import {asyncRoute} from '../../middleware/common.js';
import * as service from '../services/hospitality-service.js';
const uuid=z.guid().transform(v=>v.toLowerCase()),empty=z.object({}).strict(),money=z.number().finite().min(0).max(1000000).multipleOf(0.01);
const grant=z.object({request_id:uuid,staff_id:uuid,branch_id:uuid.nullable().default(null),reward_id:uuid,title:z.string().trim().min(1).max(100),total_units:z.number().int().min(1).max(10000),total_cost:money,unit_cost_limit:money,starts_at:dateTimeSchema({offset:true}),ends_at:dateTimeSchema({offset:true}),valid_hours:z.number().int().min(1).max(2160)}).strict();
const issue=z.object({request_id:uuid,grant_id:uuid,customer_id:uuid}).strict();
const actor=req=>({businessId:req.tenantId,staff:req.staff}),invalid=res=>res.status(400).json({error:'Revisa los datos de la cortesía.',code:'VALIDATION_ERROR'});
export function createHospitalityRoutes(deps={}){
 const s={...service,...deps},router=Router();for(const path of ['/admin/hospitality','/staff/hospitality'])router.use(path,(_req,res,next)=>{res.set('Cache-Control','no-store');next();},requireStaff,tenantContext,...(path.startsWith('/admin/')?[requireOwner]:[]));
 for(const path of ['/admin/hospitality','/staff/hospitality'])router.get(path,asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.listHospitality({...actor(req),owner:path.startsWith('/admin/')}));}));
 router.post('/admin/hospitality',csrfProtect,asyncRoute(async(req,res)=>{const parsed=grant.safeParse(req.body);if(!parsed.success||!empty.safeParse(req.query).success)return invalid(res);const v=parsed.data;return res.status(201).json(await s.createHospitalityGrant({...actor(req),requestId:v.request_id,staffId:v.staff_id,branchId:v.branch_id,rewardId:v.reward_id,title:v.title,totalUnits:v.total_units,totalCost:v.total_cost,unitCostLimit:v.unit_cost_limit,startsAt:v.starts_at,endsAt:v.ends_at,validHours:v.valid_hours}));}));
 router.post('/admin/hospitality/:grantId/revoke',csrfProtect,asyncRoute(async(req,res)=>{const id=uuid.safeParse(req.params.grantId);if(!id.success||!empty.safeParse(req.body).success||!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.revokeHospitalityGrant({...actor(req),grantId:id.data}));}));
 router.post('/staff/hospitality/issue',csrfProtect,asyncRoute(async(req,res)=>{const parsed=issue.safeParse(req.body);if(!parsed.success||!empty.safeParse(req.query).success)return invalid(res);const v=parsed.data;return res.status(201).json(await s.issueHospitality({...actor(req),requestId:v.request_id,grantId:v.grant_id,customerId:v.customer_id}));}));return router;
}
export const hospitalityRoutes=createHospitalityRoutes();
