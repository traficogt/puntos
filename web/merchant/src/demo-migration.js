import { normalizeCustomerMigration, summarizeCustomerMigration } from '../../../src/app/services/customer-migration-csv.js';

// Synthetic state lives in this page only; this module has no network or persistence API.
const phones = new Set();
const batches = [];
const requests = new Map();
export function demoMigration(url, options = {}) {
  const suffix = url.pathname.replace('/api/admin/customer-migrations', '');
  const method = options.method || 'GET';
  if (!suffix && method === 'GET') return { batches: structuredClone(batches.slice(0, 20)) };
  const body = options.body ? JSON.parse(options.body) : {};
  if (suffix === '/preview' && method === 'POST') return summarizeCustomerMigration(normalizeCustomerMigration(body), phones, body.existing_policy);
  if (suffix === '/commit' && method === 'POST') {
    if (!body.confirmed || !body.request_id || !body.label?.trim() || body.label.trim().length > 100 || !body.columns?.phone) throw new Error('Revisa el lote y confirma el saldo inicial.');
    const signature = JSON.stringify(body);
    const prior = requests.get(body.request_id);
    if (prior) {
      if (prior.signature !== signature) throw new Error('Este lote ya se guardó con otros datos.');
      return structuredClone(prior.result);
    }
    const preview = summarizeCustomerMigration(normalizeCustomerMigration(body), phones, body.existing_policy);
    if (!preview.can_commit) throw new Error('Corrige el archivo o revisa la política de clientes existentes. No se guardó ningún cambio.');
    const batch = {
      id: crypto.randomUUID(), request_id: body.request_id, label: body.label.trim(), existing_policy: body.existing_policy,
      row_count: preview.summary.total, imported_count: preview.summary.new_customers, skipped_count: preview.summary.existing_customers,
      opening_points: preview.summary.opening_points, created_at: new Date().toISOString()
    };
    for (const row of preview.rows) if (row.status === 'new') phones.add(row.phone);
    batches.unshift(batch);
    const result = { batch };
    requests.set(body.request_id, { signature, result });
    return structuredClone(result);
  }
  throw new Error('Acción de importación no disponible en la demostración.');
}
