export const STATUS_COMPONENTS = Object.freeze([
  { id: 'sitio', name: 'Sitio web', detail: 'La página principal responde desde una comprobación externa.' },
  { id: 'acceso', name: 'Acceso a la aplicación', detail: 'La pantalla de ingreso del equipo está disponible.' },
  { id: 'sistema', name: 'Conexión con el sistema', detail: 'La API puede consultar su base de datos. No realiza compras ni canjes de prueba.' },
  { id: 'ayuda', name: 'Centro de ayuda', detail: 'Las instrucciones de uso se pueden consultar.' },
  { id: 'soporte', name: 'Formulario de soporte', detail: 'El formulario puede obtener su configuración. No realiza un envío de prueba ni comprueba la entrega de correo.' }
]);
export const STATUS_MAX_AGE_MS = 20 * 60 * 1000;

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}
function fresh(value, now) {
  const date = validDate(value);
  return Boolean(date && Number.isFinite(now) && now - Date.parse(date) >= -60000 && now - Date.parse(date) <= STATUS_MAX_AGE_MS);
}
export function safeIncidentUrl(value) {
  return typeof value === 'string' && /^https:\/\/github\.com\/traficogt\/puntos-estado\/issues\/[1-9]\d*$/.test(value) ? value : null;
}
export function projectStatus(snapshot, now = Date.now()) {
  const data = snapshot?.version === 1 ? snapshot : {};
  const records = Array.isArray(data.components) ? data.components : [];
  const components = STATUS_COMPONENTS.map(definition => {
    const matches = records.filter(row => row?.id === definition.id);
    const record = matches.length === 1 ? matches[0] : {};
    const checkedAt = validDate(record.checkedAt);
    const known = ['up', 'down', 'degraded'].includes(record.state) && fresh(checkedAt, now);
    return { ...definition, state: known ? record.state : 'unknown', checkedAt };
  });
  const state = components.some(row => row.state === 'down') ? 'down'
    : components.some(row => row.state === 'degraded') ? 'degraded'
      : components.some(row => row.state === 'unknown') ? 'unknown' : 'up';
  const incidents = (Array.isArray(data.incidents) ? data.incidents : []).slice(0, 50).filter(row => row && typeof row === 'object').map(row => ({
    title: String(row.title || 'Incidencia del servicio').slice(0, 180),
    body: String(row.body || '').slice(0, 1800),
    url: safeIncidentUrl(row.url),
    state: row.state === 'closed' ? 'closed' : 'open',
    maintenance: row.maintenance === true,
    openedAt: validDate(row.openedAt), closedAt: validDate(row.closedAt),
    updates: (Array.isArray(row.updates) ? row.updates : []).slice(-5).map(update => ({
      body: String(update?.body || '').slice(0, 1200), at: validDate(update?.at)
    }))
  }));
  return { state, components, incidents, generatedAt: validDate(data.generatedAt),
    startedAt: validDate(data.startedAt), incidentsFresh: fresh(data.incidentsCheckedAt, now) };
}
