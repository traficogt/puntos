import { Router } from "express";
import { z } from "zod";
import { requireOwner } from "../../../middleware/auth.js";
import { asyncRoute } from "../../../middleware/common.js";
import { csrfProtect } from "../../../middleware/csrf.js";
import {
  getRecoveryAudience, listRecoveryRuns, createRecoveryRun,
  getRecoveryRun, updateRecoveryMember
} from "../../services/customer-recovery-service.js";

export const analyticsRecoveryRoutes = Router();
const base = "/admin/analytics/recovery";
const uuid = z.guid().transform(value => value.toLowerCase());
const integerQuery = (minimum, maximum, fallback) => z.string()
  .regex(/^(0|[1-9]\d*)$/).default(String(fallback)).transform(Number)
  .pipe(z.number().int().min(minimum).max(maximum));
const AudienceQuery = z.object({
  inactive_days: z.enum(["30", "60", "90"]).default("30").transform(Number),
  limit: integerQuery(1, 100, 10), offset: integerQuery(0, 100000, 0)
}).strict();
const DetailQuery = z.object({
  limit: integerQuery(1, 100, 25), offset: integerQuery(0, 100000, 0)
}).strict();
const EmptyQuery = z.object({}).strict();
const RunParams = z.object({ id: uuid }).strict();
const MemberParams = z.object({ id: uuid, customerId: uuid }).strict();
const CreateBody = z.object({
  request_id: uuid, name: z.string().trim().min(1).max(100),
  notes: z.string().max(500).default(""),
  inactive_days: z.union([z.literal(30), z.literal(60), z.literal(90)]),
  limit: z.number().int().min(1).max(200).default(50)
}).strict();
const MemberBody = z.object({
  status: z.enum(["contacted", "skipped"]), contact_confirmed: z.boolean().optional()
}).strict().refine(value => value.status !== "contacted" || value.contact_confirmed === true);

function invalid(res) {
  return res.status(400).json({ error: "Revisa los datos y los límites de esta solicitud.", code: "VALIDATION_ERROR" });
}

// Existing analytics router supplies staff authentication, tenant and plan gates.
analyticsRecoveryRoutes.use(base, requireOwner);

analyticsRecoveryRoutes.get(`${base}/audience`, asyncRoute(async (req, res) => {
  const parsed = AudienceQuery.safeParse(req.query);
  if (!parsed.success) return invalid(res);
  return res.json(await getRecoveryAudience({ businessId: req.tenantId,
    inactiveDays: parsed.data.inactive_days, limit: parsed.data.limit, offset: parsed.data.offset }));
}));

analyticsRecoveryRoutes.get(`${base}/runs`, asyncRoute(async (req, res) => {
  if (!EmptyQuery.safeParse(req.query).success) return invalid(res);
  return res.json(await listRecoveryRuns({ businessId: req.tenantId }));
}));

analyticsRecoveryRoutes.post(`${base}/runs`, csrfProtect, asyncRoute(async (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success || !EmptyQuery.safeParse(req.query).success) return invalid(res);
  return res.status(201).json(await createRecoveryRun({
    businessId: req.tenantId, staffId: req.staff.id, requestId: parsed.data.request_id,
    name: parsed.data.name, notes: parsed.data.notes, inactiveDays: parsed.data.inactive_days,
    limit: parsed.data.limit, ip: req.ip, ua: req.get("user-agent") || null
  }));
}));

analyticsRecoveryRoutes.get(`${base}/runs/:id`, asyncRoute(async (req, res) => {
  const params = RunParams.safeParse(req.params);
  const query = DetailQuery.safeParse(req.query);
  if (!params.success || !query.success) return invalid(res);
  return res.json(await getRecoveryRun({ businessId: req.tenantId, runId: params.data.id,
    limit: query.data.limit, offset: query.data.offset }));
}));

analyticsRecoveryRoutes.patch(`${base}/runs/:id/members/:customerId`, csrfProtect, asyncRoute(async (req, res) => {
  const params = MemberParams.safeParse(req.params);
  const body = MemberBody.safeParse(req.body);
  if (!params.success || !body.success || !EmptyQuery.safeParse(req.query).success) return invalid(res);
  return res.json(await updateRecoveryMember({
    businessId: req.tenantId, staffId: req.staff.id, runId: params.data.id, customerId: params.data.customerId,
    status: body.data.status, contactConfirmed: body.data.contact_confirmed,
    ip: req.ip, ua: req.get("user-agent") || null
  }));
}));
