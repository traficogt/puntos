import { projectStatus } from './status-model.js';
const labels = { up: 'Disponible', down: 'Interrupción detectada', degraded: 'Funcionamiento limitado', unknown: 'Sin datos recientes' };
const summary = { up: 'Los servicios comprobados responden.', down: 'Hay una interrupción detectada.', degraded: 'Algunos servicios presentan dificultades.', unknown: 'No hay una comprobación reciente completa.' };
const date = value => value ? new Intl.DateTimeFormat('es-GT', { dateStyle: 'medium', timeStyle: 'short', timeZoneName: undefined }).format(new Date(value)) : 'Sin comprobar';
const element = (tag, text, className) => { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
let snapshot = null;
let failed = false;
let busy = false;

function render() {
  const view = projectStatus(snapshot);
  const heading = document.getElementById('resumen'); heading.textContent = failed ? 'No pudimos actualizar la consulta.' : summary[view.state]; heading.dataset.state = failed ? 'unknown' : view.state;
  document.getElementById('summary-detail').textContent = view.state === 'up' ? 'Este resultado corresponde a las comprobaciones indicadas abajo.' : 'Revisa el servicio afectado y la hora de su última observación.';
  document.getElementById('checked-at').textContent = view.generatedAt ? `Última ejecución del monitor: ${date(view.generatedAt)} · hora de tu dispositivo.` : 'Aún no hay resultados del monitor externo.';
  const note = document.getElementById('fetch-note'); note.hidden = !failed; note.textContent = 'No se pudo obtener información nueva. Esto puede deberse a tu conexión o al servicio de supervisión; por sí solo no confirma una caída de PF. Los resultados anteriores conservan su hora original.';
  const services = document.getElementById('status-services'); services.replaceChildren();
  for (const item of view.components) {
    const row = element('div', '', 'service-row'); const info = element('div'); info.append(element('h3', item.name), element('p', item.detail));
    const last = element('p', 'Comprobado: '); const time = element('time', date(item.checkedAt)); if (item.checkedAt) time.dateTime = item.checkedAt; last.append(time); info.append(last);
    const state = element('span', labels[item.state], 'service-state'); state.dataset.state = item.state; row.append(info, state); services.append(row);
  }
  const incidents = document.getElementById('incidents'); incidents.replaceChildren();
  document.getElementById('incident-note').textContent = !view.incidentsFresh ? 'No hay un registro reciente completo de incidencias. Consulta el historial o vuelve a actualizar.' : view.incidents.length ? 'Incidencias registradas y avisos de mantenimiento. Las horas se muestran en tu zona horaria.' : `No hay incidencias registradas${view.startedAt ? ` desde el inicio de la supervisión, ${date(view.startedAt)}` : ' en el periodo observado'}.`;
  for (const incident of view.incidents) {
    const row = element('article', '', 'incident'); row.append(element('h3', incident.title));
    row.append(element('p', `${incident.maintenance ? 'Mantenimiento' : 'Incidencia'} · ${incident.state === 'closed' ? 'Cerrada' : 'Abierta'} · ${date(incident.openedAt)}${incident.closedAt ? ` · Cerrada: ${date(incident.closedAt)}` : ''}`, 'muted'));
    if (incident.body) row.append(element('p', incident.body));
    if (incident.updates.length) { const details = element('details'); details.append(element('summary', 'Ver actualizaciones')); const list = element('ol', '', 'incident-updates'); for (const update of incident.updates) { const li = element('li'); li.append(element('p', date(update.at), 'muted'), element('p', update.body)); list.append(li); } details.append(list); row.append(details); }
    if (incident.url) { const link = element('a', 'Abrir el registro completo'); link.href = incident.url; link.rel = 'noopener noreferrer'; row.append(link); }
    incidents.append(row);
  }
}
async function refresh() {
  if (busy) return; busy = true;
  const button = document.getElementById('refresh-status'); button.disabled = true; button.textContent = 'Consultando…';
  try {
    const url = new URL(document.body.dataset.statusUrl, location.href); url.searchParams.set('check', String(Math.floor(Date.now() / 60000)));
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Status unavailable');
    const text = await response.text(); if (text.length > 200000) throw new Error('Status response too large');
    const data = JSON.parse(text); if (data.version !== 1 || !Array.isArray(data.components)) throw new Error('Invalid status');
    snapshot = data; failed = false;
  } catch { failed = true; }
  finally { busy = false; button.disabled = false; button.textContent = 'Actualizar'; render(); }
}
document.getElementById('refresh-status').addEventListener('click', refresh);
render(); refresh();
setInterval(() => { render(); if (!document.hidden) refresh(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
