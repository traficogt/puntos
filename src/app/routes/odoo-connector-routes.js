import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { asyncRoute } from '../../middleware/common.js';

const packageUrl = new URL('../../../integrations/odoo/dist/pf_pos_connector-18.0.3.0.0.zip', import.meta.url);

/** Public static software distribution: contains no tenant settings or credentials. */
export function createOdooConnectorRoutes() {
  const router = Router();
  router.get('/public/integrations/odoo/18/pf_pos_connector.zip', asyncRoute(async (_req, res) => {
    // Fixed repository asset; no user input contributes to the filesystem path.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const bytes = await readFile(packageUrl);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="pf_pos_connector-18.0.3.0.0.zip"',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'X-Content-SHA256': sha256,
      ETag: `"${sha256}"`
    });
    res.send(bytes);
  }));
  return router;
}

export const odooConnectorRoutes = createOdooConnectorRoutes();
