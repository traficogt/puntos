import { Router } from 'express';
import { z } from 'zod';
import { requireStaff, requireOwner } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { requirePlanFeature } from '../../middleware/plan-feature.js';
import { asyncRoute } from '../../middleware/common.js';
import * as services from '../services/activation-insights-service.js';
const query = z.object({ branch_id: z.guid().transform(value => value.toLowerCase()).optional() }).strict();
const empty = z.object({}).strict();
export function createActivationInsightsRoutes(deps = {}) {
  const router = Router(), service = { ...services, ...deps }, base = '/admin/activation-insights';
  router.use(base, (_req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); next(); }, requireStaff, tenantContext, requireOwner, requirePlanFeature('analytics'));
  for (const { path, read } of [{ path: 'reward-exposure', read: service.getRewardExposure }, { path: 'staff-activity', read: service.getStaffActivity }]) {
    router.get(`${base}/${path}`, asyncRoute(async (req, res) => {
      const parsed = query.safeParse(req.query);
      if (!parsed.success || Number(req.get('Content-Length') || 0) > 0 || req.get('Transfer-Encoding') || !empty.safeParse(req.body ?? {}).success) return res.status(400).json({ error: 'Revisa la sucursal solicitada. Esta consulta no acepta cuerpo.', code: 'VALIDATION_ERROR' });
      try { return res.json(await read({ businessId: req.tenantId, branchId: parsed.data.branch_id ?? null })); }
      catch (error) {
        if (error?.statusCode && error.statusCode < 500) throw error;
        return res.status(503).json({ error: 'No se pudo consultar este resumen. Vuelve a intentar.', code: 'ACTIVATION_INSIGHTS_UNAVAILABLE' });
      }
    }));
  }
  return router;
}
export const activationInsightsRoutes = createActivationInsightsRoutes();
