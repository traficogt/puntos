import { Router } from 'express';
import { requireOwner, requireStaff } from '../../../middleware/auth.js';
import { tenantContext } from '../../../middleware/tenant.js';
import { csrfProtect } from '../../../middleware/csrf.js';
import { asyncRoute } from '../../../middleware/common.js';
import { migrationTemplate } from '../../services/customer-migration-csv.js';
import * as migration from '../../services/customer-migration-service.js';

/** @param {{staffAuth?: import('express').RequestHandler, service?: Pick<typeof migration,'previewCustomerMigration'|'commitCustomerMigration'|'listCustomerMigrations'>}} [deps] */
export function createCustomerMigrationRoutes({ staffAuth = requireStaff, service = migration } = {}) {
  const router = Router();
  const base = '/admin/customer-migrations';
  router.use(base, (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); }, staffAuth, requireOwner, tenantContext);
  router.use(base, (req, res, next) => {
    if (!req.tenantId) return res.status(401).json({ error: 'Falta el negocio de tu sesión.' });
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'Esta acción usa el negocio de tu sesión, sin filtros adicionales.' });
    next();
  });
  router.get(base, asyncRoute(async (req, res) => res.json(await service.listCustomerMigrations({ businessId: req.tenantId }))));
  router.get(`${base}/template`, (_req, res) => res.type('text/csv; charset=utf-8')
    .set('Content-Disposition', 'attachment; filename="plantilla-clientes-pf.csv"').send('\uFEFF' + migrationTemplate));
  router.post(`${base}/preview`, csrfProtect, asyncRoute(async (req, res) => {
    const parsed = migration.migrationPreviewSchema.safeParse(req.body);
    if (!req.is('application/json') || !parsed.success) return res.status(400).json({ error: 'Revisa el archivo y las columnas seleccionadas.' });
    return res.json(await service.previewCustomerMigration({ businessId: req.tenantId, csv: parsed.data.csv, columns: parsed.data.columns, existingPolicy: parsed.data.existing_policy,source:parsed.data.source }));
  }));
  router.post(`${base}/commit`, csrfProtect, asyncRoute(async (req, res) => {
    const parsed = migration.migrationCommitSchema.safeParse(req.body);
    if (!req.is('application/json') || !parsed.success) return res.status(400).json({ error: 'Revisa los datos del lote y confirma el saldo inicial.' });
    const value = parsed.data;
    return res.status(201).json(await service.commitCustomerMigration({ businessId: req.tenantId, staffId: req.staff.id,
      requestId: value.request_id, label: value.label, csv: value.csv, columns: value.columns, existingPolicy: value.existing_policy,
      confirmed: value.confirmed,source:value.source, ip: req.ip, ua: req.get('user-agent') || null, impersonated_by: req.staff.impersonated_by || null }));
  }));
  return router;
}

export const customerMigrationRoutes = createCustomerMigrationRoutes();
