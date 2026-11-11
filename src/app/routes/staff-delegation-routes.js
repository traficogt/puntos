import { dateTimeSchema } from '../../utils/date-time-schema.js';
import { Router } from 'express';
import { z } from 'zod';
import { requireStaff, requireOwner } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { csrfProtect } from '../../middleware/csrf.js';
import { asyncRoute } from '../../middleware/common.js';
import * as services from '../services/staff-delegation-service.js';

const uuid=z.guid().transform(value=>value.toLowerCase());
const empty=z.object({}).strict();
const integer=max=>z.number().int().positive().max(max);
const grantBody=z.object({request_id:uuid,staff_id:uuid,branch_id:uuid.nullable().default(null),action:z.literal('restore_redemption'),per_action_points:integer(100000),total_points:integer(1000000),starts_at:dateTimeSchema({offset:true}),ends_at:dateTimeSchema({offset:true})}).strict();
const noticeFields={title:z.string().trim().min(1).max(100),body:z.string().trim().min(1).max(600),branch_id:uuid.nullable().default(null),expires_at:dateTimeSchema({offset:true})};
const noticeBody=z.object(noticeFields).strict();
const noticeEdit=z.object({...noticeFields,expected_version:integer(2147483646)}).strict();
const acknowledgement=z.object({version:integer(2147483646)}).strict();
const pagination=z.object({offset:z.string().regex(/^(0|[1-9]\d*)$/).default('0').transform(Number).pipe(z.number().int().max(100000))}).strict();
const invalid=res=>res.status(400).json({error:'Revisa los datos de la solicitud.',code:'VALIDATION_ERROR'});
const actor=req=>({businessId:req.tenantId,staff:req.staff});
const noticeInput=body=>({title:body.title,body:body.body,branchId:body.branch_id,expiresAt:body.expires_at});
export function createStaffDelegationRoutes(deps={}){
 const s={...services,...deps},router=Router();
 for(const path of ['/admin/staff-authority','/admin/shift-notices','/staff/service-authority','/staff/shift-briefing']){
  router.use(path,(_req,res,next)=>{res.set('Cache-Control','no-store');next();},requireStaff,tenantContext,...(path.startsWith('/admin/')?[requireOwner]:[]));
 }
 router.get('/admin/staff-authority',asyncRoute(async(req,res)=>{const parsed=pagination.safeParse(req.query);if(!parsed.success)return invalid(res);return res.json(await s.listServiceGrants({...actor(req),...parsed.data}));}));
 router.post('/admin/staff-authority',csrfProtect,asyncRoute(async(req,res)=>{
  const parsed=grantBody.safeParse(req.body);if(!parsed.success||!empty.safeParse(req.query).success)return invalid(res);const v=parsed.data;
  return res.status(201).json(await s.createServiceGrant({...actor(req),requestId:v.request_id,staffId:v.staff_id,branchId:v.branch_id,action:v.action,perActionPoints:v.per_action_points,totalPoints:v.total_points,startsAt:v.starts_at,endsAt:v.ends_at}));
 }));
 router.post('/admin/staff-authority/:grantId/revoke',csrfProtect,asyncRoute(async(req,res)=>{
  const id=uuid.safeParse(req.params.grantId);if(!id.success||!empty.safeParse(req.body).success||!empty.safeParse(req.query).success)return invalid(res);
  return res.json(await s.revokeServiceGrant({...actor(req),grantId:id.data}));
 }));
 router.get('/admin/shift-notices',asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.listShiftNotices(actor(req)));}));
 router.post('/admin/shift-notices',csrfProtect,asyncRoute(async(req,res)=>{
  const parsed=noticeBody.safeParse(req.body);if(!parsed.success||!empty.safeParse(req.query).success)return invalid(res);
  return res.status(201).json(await s.publishShiftNotice({...actor(req),...noticeInput(parsed.data)}));
 }));
 router.put('/admin/shift-notices/:noticeId',csrfProtect,asyncRoute(async(req,res)=>{
  const id=uuid.safeParse(req.params.noticeId),parsed=noticeEdit.safeParse(req.body);if(!id.success||!parsed.success||!empty.safeParse(req.query).success)return invalid(res);
  return res.json(await s.publishShiftNotice({...actor(req),noticeId:id.data,expectedVersion:parsed.data.expected_version,...noticeInput(parsed.data)}));
 }));
 router.get('/staff/service-authority',asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.getOwnServiceAuthority(actor(req)));}));
 router.get('/staff/shift-briefing',asyncRoute(async(req,res)=>{if(!empty.safeParse(req.query).success)return invalid(res);return res.json(await s.getShiftBriefing(actor(req)));}));
 router.post('/staff/shift-briefing/:noticeId/ack',csrfProtect,asyncRoute(async(req,res)=>{
  const id=uuid.safeParse(req.params.noticeId),parsed=acknowledgement.safeParse(req.body);if(!id.success||!parsed.success||!empty.safeParse(req.query).success)return invalid(res);
  return res.json(await s.acknowledgeShiftNotice({...actor(req),noticeId:id.data,version:parsed.data.version}));
 }));
 return router;
}
export const staffDelegationRoutes=createStaffDelegationRoutes();
