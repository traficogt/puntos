import { Router } from 'express';
import { z } from 'zod';
import { requireStaff, requireOwner } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { asyncRoute } from '../../middleware/common.js';
import { listTransactionHistory, getTransactionExplanation, listRejectedAttempts, movementKinds, transactionHistoryFilters, validHistoryInterval } from '../services/transaction-explanation-service.js';

const empty = z.object({}).strict();
const query = z.object({ limit: z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().min(1).max(50)).optional().prefault('25'), cursor: z.string().min(1).max(400).optional(), kind: z.string().refine(value => movementKinds.includes(value)).optional().default('all') }).merge(transactionHistoryFilters).strict().refine(validHistoryInterval);
function noStore(_req,res,next) { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); next(); }
function hasBody(req) { return Number(req.get('Content-Length') || 0) > 0 || req.get('Transfer-Encoding') || !empty.safeParse(req.body ?? {}).success; }
function invalid(res) { return res.status(400).json({ error: 'Revisa el ID, los filtros y la página solicitada. Esta consulta no acepta cuerpo.', code: 'VALIDATION_ERROR' }); }
async function respond(res, fn) {
  try { return res.json(await fn()); }
  catch (error) {
    if (error?.statusCode && error.statusCode < 500) throw error;
    return res.status(503).json({ error: 'No se pudo consultar el historial. Vuelve a intentar.', code: 'TRANSACTION_HISTORY_UNAVAILABLE' });
  }
}
export function createTransactionExplanationRoutes(deps = {}) {
  const router = Router(), guards = [noStore,requireStaff,requireOwner,tenantContext];
  router.get('/admin/transaction-rejections', ...guards, asyncRoute(async(req,res)=>{
    if(!empty.safeParse(req.query).success||hasBody(req))return invalid(res);
    return respond(res,()=>(deps.listRejectedAttempts??listRejectedAttempts)({businessId:req.tenantId}));
  }));
  router.get('/admin/transaction-history', ...guards, asyncRoute(async (req,res) => {
    const parsed = query.safeParse(req.query);
    if (!parsed.success || hasBody(req)) return invalid(res);
    return respond(res, () => (deps.listTransactionHistory ?? listTransactionHistory)({ businessId: req.tenantId, ...parsed.data }));
  }));
  router.get('/admin/transaction-history/:id', ...guards, asyncRoute(async (req,res) => {
    if (!z.guid().safeParse(req.params.id).success || !empty.safeParse(req.query).success || hasBody(req)) return invalid(res);
    return respond(res, () => (deps.getTransactionExplanation ?? getTransactionExplanation)({ businessId: req.tenantId, id: req.params.id }));
  }));
  return router;
}
export const transactionExplanationRoutes = createTransactionExplanationRoutes();
