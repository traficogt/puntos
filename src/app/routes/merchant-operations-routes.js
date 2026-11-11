import { Router } from 'express';
import { z } from 'zod';
import { requireStaff, requireOwner } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { asyncRoute } from '../../middleware/common.js';
import { getOperationsHealth } from '../services/merchant-operations-service.js';

const Empty = z.object({}).strict();
function noStore(_req, res, next) { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); next(); }

export function createMerchantOperationsRoutes(deps = {}) {
  const router = Router();
  router.get('/admin/operations-health', noStore, requireStaff, requireOwner, tenantContext, asyncRoute(async (req, res) => {
    if (!Empty.safeParse(req.query).success || Number(req.get('Content-Length') || 0) > 0 || req.get('Transfer-Encoding') || !Empty.safeParse(req.body ?? {}).success) {
      return res.status(400).json({ error: 'Esta consulta no acepta parámetros ni cuerpo.', code: 'VALIDATION_ERROR' });
    }
    try {
      return res.json(await (deps.getOperationsHealth ?? getOperationsHealth)({ businessId: req.tenantId }));
    } catch (error) {
      if (error?.statusCode && error.statusCode < 500) throw error;
      // The dashboard must fail visibly without returning database/provider details.
      return res.status(503).json({ error: 'No se pudo cargar el estado operativo. Vuelve a intentar.', code: 'OPERATIONS_UNAVAILABLE' });
    }
  }));
  return router;
}

export const merchantOperationsRoutes = createMerchantOperationsRoutes();
