// Synthetic evidence only. No provider, customer, or operation is touched.
export function demoOperations() {
  const now = Date.now(), ago = minutes => new Date(now - minutes * 60000).toISOString();
  const metric = (key, label, value) => ({ key, label, value });
  const messageMetrics = values => [
    ['queued', 'En cola'], ['processing', 'En proceso'], ['accepted', 'Aceptados por el proveedor'],
    ['failed', 'Fallidos'], ['uncertain', 'Resultado incierto'], ['suppressed', 'Suprimidos'],
    ['stale', 'Vencidos o con más de una hora de retraso'], ['stale_queue', 'En cola con más de una hora de retraso'],
    ['stale_processing', 'En proceso con plazo de confirmación vencido'], ['expired', 'Mensajes vencidos pendientes de cierre']
  ].map(([key, label]) => metric(key, label, values[key] ?? 0));
  const sections = [
    {id:'owner_brief',title:'Resumen semanal del propietario',state:'needs_attention',summary:'Ejemplo: un resumen tiene resultado incierto. Revisa el historial antes de reenviar. La aceptación del proveedor no acredita entrega ni lectura.',last_observed_at:ago(90),metrics:[metric('failed','Fallidos',0),metric('uncertain','Resultado incierto',1),metric('accepted','Aceptados por el proveedor',3),metric('queued','En cola',0)],reasons:[{code:'owner_brief_delivery_review',label:'Consulta el historial; no se reenvían resultados inciertos desde este diagnóstico.'}],action:{label:'Revisar resumen semanal',href:'#automatizaciones'}},
    {
      id: 'pos', title: 'Conexión de caja', state: 'needs_attention',
      summary: 'Ejemplo: la última importación terminó, pero hay ventas y una devolución pendientes. La configuración registrada no prueba una conexión actual.',
      last_observed_at: ago(12),
      metrics: [metric('pending_receipts', 'Ventas pendientes de revisar', 2), metric('last_sync_errors', 'Errores de la última importación', 0), metric('last_completed_at', 'Última ventana completada', ago(12)), metric('pending_refunds', 'Devoluciones pendientes de conciliación', 1), metric('reconciled_refunds', 'Devoluciones conciliadas', 4)],
      reasons: [{ code: 'pending_receipts', label: 'Ventas pendientes de revisar.', count: 2 }, { code: 'refund_partial_refund', label: 'Devolución parcial: revisa el recibo y los puntos; PF no calcula una reversión proporcional.', count: 1 }],
      action: { label: 'Revisar conexión de caja', href: '#conectar-caja' }
    },
    {
      id: 'messaging', title: 'Mensajes de campañas y automatizaciones', state: 'needs_attention',
      summary: 'Ejemplo: hay mensajes de automatizaciones con resultado incierto o confirmación vencida. En proceso significa que todavía no hay un resultado confirmado. La aceptación por el proveedor no confirma la entrega.',
      last_observed_at: ago(30),
      metrics: messageMetrics({ queued: 7, processing: 1, accepted: 48, uncertain: 1, stale: 1, stale_processing: 1 }),
      reasons: [{ code: 'uncertain', label: 'Resultado incierto: comprueba el proveedor antes de decidir; PF no reenvía automáticamente.', count: 1 }, { code: 'stale_processing', label: 'Plazo de confirmación vencido: el envío puede haber ocurrido. Revisa el proveedor antes de reenviar.', count: 1 }],
      sources: [
        { id: 'growth', title: 'Campañas', href: '#ofertas', metrics: messageMetrics({ queued: 7, accepted: 40 }), last_observed_at: ago(40) },
        { id: 'lifecycle', title: 'Automatizaciones', href: '#automatizaciones', metrics: messageMetrics({ processing: 1, accepted: 8, uncertain: 1, stale: 1, stale_processing: 1 }), last_observed_at: ago(30) }
      ],
      action: { label: 'Revisar campañas', href: '#recuperar-clientes' }
    },
    {
      id: 'apple_wallet', title: 'Apple Wallet', state: 'configured',
      summary: 'Ejemplo: configuración local habilitada y registros de pases. Estos registros no confirman emisión completada ni instalación; compruébalas en un dispositivo.',
      last_observed_at: ago(10),
      metrics: [metric('registered', 'Registros de pases', 34), metric('pending', 'Actualizaciones pendientes', 1), metric('failed', 'Actualizaciones con intentos fallidos', 0), metric('stale', 'Actualizaciones con más de una hora de retraso', 0)],
      reasons: [], action: { label: 'Registrar prueba de Wallet', href: '#piloto' }
    },
    {
      id: 'google_wallet', title: 'Google Wallet', state: 'unknown',
      summary: 'Ejemplo: no se pudo determinar la configuración actual del proveedor. Tampoco hay registros de pases para este negocio.',
      last_observed_at: null,
      metrics: [metric('registered', 'Registros de pases', 0), metric('pending', 'Actualizaciones pendientes', 0), metric('failed', 'Actualizaciones con intentos fallidos', 0), metric('stale', 'Actualizaciones con más de una hora de retraso', 0)],
      reasons: [], action: { label: 'Revisar alta de clientes', href: '#preparar' }
    },
    {
      id: 'economics', title: 'Costos de recompensas', state: 'needs_attention',
      summary: 'Ejemplo: falta el costo de una recompensa y hay canjes históricos con costo desconocido. Desconocido no equivale a Q0; editar un costo no cambia el historial.',
      last_observed_at: ago(60),
      metrics: [metric('active_rewards', 'Recompensas activas y vigentes', 3), metric('missing_reward_costs', 'Recompensas activas sin costo actual', 1), metric('completed_redemptions', 'Canjes completados en el historial', 7), metric('costed_redemptions', 'Canjes con costo conocido al completarse', 5), metric('unknown_cost_redemptions', 'Canjes con costo desconocido', 2), metric('missing_cost_snapshots', 'Canjes sin registro histórico de costo', 1), metric('unknown_snapshot_costs', 'Canjes registrados con costo desconocido', 1), metric('cost_coverage_pct', 'Cobertura de costos de canjes (%)', 71.43)],
      reasons: [{ code: 'missing_reward_costs', label: 'Recompensas activas sin costo actual: registra tu costo para futuros canjes.', count: 1 }, { code: 'missing_cost_snapshots', label: 'Canjes completados sin registro histórico de costo; su costo permanece desconocido.', count: 1 }, { code: 'unknown_snapshot_costs', label: 'Canjes cuyo costo no se conocía al completarse; su registro histórico permanece desconocido.', count: 1 }],
      action: { label: 'Revisar costos', href: '#costos' }
    }
  ];
  return {
    generated_at: new Date(now).toISOString(), sections,
    summary: { attention_count: 4, setup_count: 0, configured_count: 1, healthy_count: 0, unknown_count: 1, not_in_plan_count: 0 },
    next_actions: [
      { id: 'pos_refunds', section_id: 'pos', priority: 10, label: 'Revisar devoluciones de caja', href: '#conectar-caja', reason: 'Una devolución parcial guardada requiere revisar el recibo y los puntos.' },
      { id: 'pos_import', section_id: 'pos', priority: 20, label: 'Revisar importación de ventas', href: '#conectar-caja', reason: 'Dos ventas siguen pendientes de revisión.' },
      {id:'owner_brief_history',section_id:'owner_brief',priority:25,label:'Revisar el resumen semanal',href:'#automatizaciones',reason:'Un envío tiene resultado incierto; consulta el historial antes de reenviar.'},
      { id: 'lifecycle_messages', section_id: 'messaging', priority: 30, label: 'Revisar mensajes de automatizaciones', href: '#automatizaciones', reason: 'Comprueba los resultados inciertos antes de decidir sobre nuevos envíos.' },
      { id: 'reward_costs', section_id: 'economics', priority: 40, label: 'Completar costos de recompensas', href: '#costos', reason: 'Una recompensa activa aún no tiene costo para futuros canjes.' },
      { id: 'historical_costs', section_id: 'economics', priority: 50, label: 'Revisar cobertura histórica de costos', href: '#costos', reason: 'Dos canjes conservan un costo desconocido; editar el costo actual no modifica ese historial.' },
      { id: 'google_wallet_setup', section_id: 'google_wallet', priority: 80, label: 'Revisar alta de clientes', href: '#preparar', reason: 'Confirma la configuración si usarás Google Wallet en tu piloto.' }
    ]
  };
}
