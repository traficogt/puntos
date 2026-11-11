import { audiencePresets, validateAudience } from './audience-model.js';

// Synthetic purchases have a consistent age and amount. Period totals change
// independently from all-time purchase history, just as the real preview does.
const rows = Array.from({ length: 36 }, (_, index) => ({
  id: `demo-audience-customer-${index + 1}`, name: `Cliente de ejemplo ${index + 1}`,
  purchases: Array.from({ length: index % 8 }, (_, purchase) => ({ days: index * 3 + purchase * 2, amount_q: 125 })),
  joined_days: index * 5, points_balance: index * 20, marketing_opt_in: index % 3 !== 0
}));
const segments = [{ id: 'demo-audience-frequent', name: 'Clientes frecuentes · ejemplo', version: 1, definition: audiencePresets.frequent.definition(), archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
const requests = new Map();
const problem = (message, status = 400) => Object.assign(new Error(message), { status });
function groupMatch(customer, group) {
  const matches = group.rules.map(rule => {
    const value = customer[rule.field];
    return value !== null && value !== undefined && (rule.operator === 'eq' ? value === rule.value : rule.operator === 'gte' ? value >= rule.value : value <= rule.value);
  });
  return group.match === 'all' ? matches.every(Boolean) : matches.some(Boolean);
}
export function demoAudiencePreview(definition, limit = 10) {
  const error = validateAudience(definition);
  if (error) throw problem(error);
  const customers = rows.map(({ purchases, ...customer }) => {
    const recent = purchases.filter(purchase => purchase.days <= definition.window_days);
    return { ...customer, purchase_count: recent.length, spend_q: recent.reduce((sum, purchase) => sum + purchase.amount_q, 0),
      has_purchase: purchases.length > 0, last_purchase_days: purchases.length ? purchases[0].days : null };
  }).filter(customer => groupMatch(customer, definition.include) && (!definition.exclude.rules.length || !groupMatch(customer, definition.exclude)))
    .sort((left, right) => left.id.localeCompare(right.id));
  return { total: customers.length, contactable_count: customers.filter(customer => customer.marketing_opt_in).length, customers: customers.slice(0, limit), generated_at: new Date().toISOString() };
}
export function demoAudienceSnapshot(id, version, limit, { minimum = 10, maximum = 200 } = {}) {
  const segment = segments.find(value => value.id === id);
  if (!segment) throw problem('No se encontró esta audiencia.', 404);
  if (segment.archived || segment.version !== version) throw problem('La audiencia está archivada o cambió. Revisa su versión antes de crear la campaña.', 409);
  if (!Number.isInteger(limit) || limit < minimum || limit > maximum) throw problem('Selecciona entre 10 y 200 clientes.');
  const preview = demoAudiencePreview(segment.definition, limit);
  if (!preview.total) throw problem('No hay clientes que coincidan.');
  return { member_count: preview.customers.length, snapshot: {
    segment_id: segment.id, segment_version: segment.version, name: segment.name, definition: structuredClone(segment.definition),
    cutoff: preview.generated_at, generated_at: preview.generated_at, total: preview.total,
    contactable_count: preview.contactable_count, selected_contactable_count: preview.customers.filter(customer => customer.marketing_opt_in).length,
    selected_count: preview.customers.length, limit, overflow_count: Math.max(0, preview.total - preview.customers.length), selection_order: 'customer_id_asc'
  } };
}
export function demoAudiences(url, options = {}) {
  const suffix = url.pathname.replace('/api/admin/audiences', ''), method = options.method || 'GET', body = JSON.parse(options.body || '{}');
  if (!suffix && method === 'GET') return structuredClone({ segments, total: segments.length });
  if (suffix === '/preview' && method === 'POST') {
    const limit = body.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw problem('La muestra debe tener entre 1 y 20 clientes.');
    return demoAudiencePreview(body.definition, limit);
  }
  const validation = validateAudience(body.definition);
  if (validation || !body.name?.trim() || body.name.trim().length > 100) throw problem(validation || 'Revisa el nombre de la audiencia.');
  if (!suffix && method === 'POST') {
    if (!body.request_id) throw problem('La solicitud necesita un identificador.');
    const old = requests.get(body.request_id);
    if (old) {
      if (old.signature !== JSON.stringify(body)) throw problem('Solicitud ya usada con otros datos.', 409);
      return structuredClone({ segment: old.segment });
    }
    if (segments.length >= 100) throw problem('Este negocio ya tiene 100 audiencias guardadas. Reutiliza o edita una existente.', 409);
    const segment = { id: crypto.randomUUID(), name: body.name.trim(), version: 1, definition: structuredClone(body.definition), archived: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    segments.unshift(segment); requests.set(body.request_id, { signature: JSON.stringify(body), segment: structuredClone(segment) });
    return structuredClone({ segment });
  }
  const segment = segments.find(value => `/${value.id}` === suffix);
  if (!segment || method !== 'PUT') throw problem('Audiencia no encontrada.', 404);
  if (!Number.isInteger(body.version) || typeof body.archived !== 'boolean') throw problem('Revisa la versión y el estado de la audiencia.');
  if (segment.version !== body.version) throw problem('La audiencia cambió en otra sesión. Recárgala antes de guardar.', 409);
  Object.assign(segment, { name: body.name.trim(), definition: structuredClone(body.definition), archived: body.archived, version: segment.version + 1, updated_at: new Date().toISOString() });
  return structuredClone({ segment });
}
