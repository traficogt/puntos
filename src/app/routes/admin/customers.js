import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { CustomerRepo } from "../../repositories/customer-repository.js";
import { toCSV } from "../../../utils/csv.js";
import { withTransaction } from "../../database.js";
import { AuditRepo } from "../../repositories/audit-repository.js";
import { withImpersonationMeta } from "../../../utils/impersonation.js";
import { makeId } from "./_util.js";

export const adminCustomerRoutes = Router();

// Customer data stays out of the audit entry: it records who acted and what kind of change.
/** @param {any} req @param {string} action @param {Record<string, unknown>} meta */
function auditCustomers(req, action, meta) {
  return AuditRepo.log({
    id: makeId(), business_id: req.tenantId, actor_type: "STAFF", actor_id: req.staff.id, action,
    ip: req.ip ?? null, ua: req.get?.("user-agent") ?? null, meta: withImpersonationMeta(meta, req.staff)
  });
}

adminCustomerRoutes.get(
  "/admin/customers.csv",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("customer_export"),
  asyncRoute(async (req, res) => {
    const rows = await CustomerRepo.listByBusiness(req.tenantId, 5000);
    const columns = ["id", "phone", "name", "created_at", "last_visit_at", "points", "lifetime_points"];
    const csv = toCSV(rows, columns);
    // Recorded before any data leaves: without an audit entry nothing is sent.
    await auditCustomers(req, "customers.export", { format: "csv", rows: rows.length, columns });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"customers.csv\"");
    return res.send(csv);
  })
);


// The directory is a basic owner operation; export retains its existing plan gate.
import {z} from 'zod';
import {csrfProtect} from '../../../middleware/csrf.js';
import {CustomerDirectoryRepo} from '../../repositories/customer-directory-repository.js';
const Name = z.string().trim().min(1).max(120).refine(value => !/[\u0000-\u001f\u007f]/u.test(value));
const Query = z.object({
  q: z.string().trim().max(120).default(''),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const Empty = z.object({}).strict();
const Profile = z.object({name: Name, previous_name: z.string().max(120).nullable()}).strict();
const Id = z.guid();
const invalid = res => res.status(400).json({error:'Revisa el nombre, la búsqueda y el número de página.',code:'VALIDATION_ERROR'});
export function createCustomerDirectoryRouter(repo = CustomerDirectoryRepo) {
  const router = Router();
  router.use('/admin/customers', requireStaff, requireOwner, tenantContext, (_req, res, next) => {res.set('Cache-Control', 'no-store'); next();});
  router.get('/admin/customers', asyncRoute(async (req, res) => {
    const query = Query.safeParse(req.query);
    if (!query.success) return invalid(res);
    return res.json({ok:true, ...await repo.list({businessId:req.tenantId, ...query.data})});
  }));
  router.get('/admin/customers/:id', asyncRoute(async (req, res) => {
    if (!Id.safeParse(req.params.id).success || !Empty.safeParse(req.query).success) return invalid(res);
    const customer = await repo.get({businessId:req.tenantId,customerId:req.params.id});
    if (!customer) return res.status(404).json({error:'No encontramos este cliente en tu negocio.'});
    return res.json({ok:true,customer});
  }));
  router.patch('/admin/customers/:id', csrfProtect, asyncRoute(async (req, res) => {
    const body = Profile.safeParse(req.body);
    if (!body.success || !Id.safeParse(req.params.id).success || !Empty.safeParse(req.query).success) return invalid(res);
    // The new name and its audit entry commit together.
    const customer = await withTransaction(async () => {
      const updated = await repo.updateName({businessId:req.tenantId,customerId:req.params.id,name:body.data.name,previousName:body.data.previous_name});
      await auditCustomers(req, 'customer.profile.update', {customer_id:req.params.id, fields:['name']});
      return updated;
    });
    return res.json({ok:true,customer});
  }));
  return router;
}
adminCustomerRoutes.use(createCustomerDirectoryRouter());
