export const sourceHealthReasons = {
  source_initial_sync: 'La conexión todavía no ha confirmado una ventana completa de datos.',
  source_stale: 'La información supera el plazo de sincronización configurado por el negocio.',
  source_incomplete: 'La conexión informa registros o una ventana pendientes de sincronizar.',
  source_errors: 'La conexión informa errores que pueden dejar compras fuera del análisis.',
  source_time_invalid: 'Las fechas recibidas no permiten comprobar la vigencia de los datos.'
};
export function sourceHealth(sources, now = new Date()) {
  if (!Array.isArray(sources)) return [];
  return sources.slice(0,100).filter(s => s && s.enabled === true).map(s => {
    const h = s.last_heartbeat, coverage = Date.parse(h?.coverage_through), received = Date.parse(h?.received_at);
    const minutes = Number(s.expected_minutes);
    let reason = null;
    if (!h) reason = 'source_initial_sync';
    else if (!Number.isFinite(coverage) || !Number.isFinite(received) || !Number.isInteger(minutes)
      || minutes < 5 || minutes > 10080 || coverage > received + 300000 || received > now.getTime()+300000) reason = 'source_time_invalid';
    else if (Number(h.errors)>0 || h.status==='error') reason = 'source_errors';
    else if (h.status!=='complete' || Number(h.pending)>0) reason = 'source_incomplete';
    else if (now.getTime()-coverage > minutes*60000) reason = 'source_stale';
    return {id:s.id, source:s.source, label:s.label, branch_id:s.branch_id??null,
      expected_minutes:minutes, state:reason?'blocked':'ready', reason,
      summary:reason?sourceHealthReasons[reason]:'La conexión declaró una ventana completa dentro del plazo configurado.',
      coverage_through:Number.isFinite(coverage)?new Date(coverage).toISOString():null,
      received_at:Number.isFinite(received)?new Date(received).toISOString():null,
      evidence:'integration_reported'};
  });
}
