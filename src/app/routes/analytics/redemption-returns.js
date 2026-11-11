import { Router } from 'express';
import { z } from 'zod';
import { requireOwner } from '../../../middleware/auth.js';
import { asyncRoute } from '../../../middleware/common.js';
import { getRedemptionReturns } from '../../services/redemption-return-service.js';

export const analyticsRedemptionReturnRoutes = Router();
const ReturnQuery = z.object({
  days: z.enum(['7', '30', '90']).default('90').transform(Number),
  branch_id: z.guid().transform(value => value.toLowerCase()).optional()
}).strict();

// The containing analytics router applies staff, tenant and plan gates first.
analyticsRedemptionReturnRoutes.get('/admin/analytics/redemption-returns', requireOwner, asyncRoute(async (req, res) => {
  const parsed = ReturnQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Selecciona 7, 30 o 90 días y una sucursal válida.', code: 'VALIDATION_ERROR' });
  }
  const result = await getRedemptionReturns({
    businessId: req.tenantId,
    branchId: parsed.data.branch_id ?? null,
    days: parsed.data.days
  });
  res.set('Cache-Control', 'private, no-store');
  return res.json(result);
}));
