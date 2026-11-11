const keys = ['staff_id', 'source_group', 'branch_id', 'start', 'end'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const activitySourceLabels = { staff: 'Equipo identificado', pos: 'Caja o integración', orders: 'Pedidos', unmapped: 'Sin persona identificada', other: 'Otros orígenes' };
export function readActivityFilters(search) {
  const params = new URLSearchParams(search), result = {};
  for (const key of ['staff_id', 'branch_id']) if (uuid.test(params.get(key) || '')) result[key] = params.get(key).toLowerCase();
  if (Object.hasOwn(activitySourceLabels, params.get('source_group'))) result.source_group = params.get('source_group');
  const start = params.get('start'), end = params.get('end');
  if (start && end && Number.isFinite(Date.parse(start)) && Date.parse(end) > Date.parse(start) && Date.parse(end) - Date.parse(start) <= 93 * 86400000) {
    result.start = new Date(start).toISOString(); result.end = new Date(end).toISOString();
  }
  return result;
}
export function activityHistoryHref(data, filters = {}, currentUrl = location.href) {
  const url = new URL(currentUrl);
  for (const key of keys) url.searchParams.delete(key);
  url.searchParams.set('start', data.period.start); url.searchParams.set('end', data.period.end);
  if (data.branch_id) url.searchParams.set('branch_id', data.branch_id);
  for (const key of ['staff_id', 'source_group']) if (filters[key]) url.searchParams.set(key, filters[key]);
  url.hash = 'movimientos';
  return `${url.pathname}${url.search}${url.hash}`;
}
export function activityFiltersHref(filters, currentUrl = location.href) {
  const url = new URL(currentUrl);
  for (const key of keys) {
    url.searchParams.delete(key);
    if (filters[key]) url.searchParams.set(key, filters[key]);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
export function clearActivityFilters(currentUrl = location.href) { return activityFiltersHref({}, currentUrl); }
