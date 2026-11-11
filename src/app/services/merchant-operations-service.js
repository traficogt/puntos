import { dbQuery } from '../database.js';
import { BusinessRepo } from '../repositories/business-repository.js';
import { PlanConfigService } from './plan-config-service.js';
import { hasPlanFeature } from '../../utils/plan.js';
import { notFound } from '../../utils/http-error.js';

const HOUR = 60 * 60 * 1000;
const TITLES = { pos: 'Conexión de caja', messaging: 'Mensajes de campañas y automatizaciones', apple_wallet: 'Apple Wallet', google_wallet: 'Google Wallet', economics: 'Costos de recompensas', owner_brief: 'Resumen semanal del propietario' };
const ACTIONS = {
  owner_brief: {label:'Revisar resumen semanal',href:'#automatizaciones'},
  pos: { label: 'Revisar conexión de caja', href: '#conectar-caja' },
  messaging: { label: 'Revisar campañas', href: '#recuperar-clientes' },
  apple_wallet: { label: 'Revisar alta de clientes', href: '#preparar' },
  google_wallet: { label: 'Revisar alta de clientes', href: '#preparar' },
  economics: { label: 'Revisar costos', href: '#costos' }
};

function timestamp(value) {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function count(value) { return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0; }
function metric(key, label, value) { return { key, label, value }; }
function section(id, state, summary, lastObservedAt = null, metrics = [], reasons = []) {
  return { id, title: TITLES[id], state, summary, last_observed_at: timestamp(lastObservedAt), metrics, reasons, action: ACTIONS[id] };
}
function locked(id) {
  return { ...section(id, 'not_in_plan', 'Esta función no está incluida en tu plan actual.'), action: { label: 'Revisar mi plan', href: '/administracion/?seccion=plan' } };
}
function readinessState(ready) { return ready === true ? 'configured' : ready === false ? 'not_configured' : 'unknown'; }

async function providerReadiness({ includeMessaging, includeOwnerBrief }) {
  // Reuse the providers' local readiness checks. Wallet settings are loaded once
  // by its existing runtime; diagnostics neither load credentials themselves nor
  // send requests. Only boolean readiness crosses this boundary.
  const { walletSettings } = await import('./native-wallet/runtime.js');
  let messaging = null;
  if (includeMessaging || includeOwnerBrief) {
    const { marketingProviderReady } = await import('./messaging-service.js');
    messaging = marketingProviderReady();
  }
  const ownerEmail=includeOwnerBrief?(await import('./owner-brief-email-service.js')).ownerBriefEmailReady():null;
  return {
    owner_brief_email: ownerEmail,
    messaging,
    apple_wallet: walletSettings.apple?.ready,
    google_wallet: walletSettings.google?.ready
  };
}

const REFUND_REASONS = {
  awaiting_reconciliation: 'Falta comprobar la venta original y sus puntos.',
  original_not_found: 'Venta original no encontrada: revisa el ID y origen de la venta.',
  ambiguous_original: 'La venta y su historial de puntos no coinciden.',
  partial_refund: 'Devolución parcial: revisa el recibo y los puntos; PF no calcula una reversión proporcional.',
  scope_unverified: 'No se ha comprobado que la devolución sea completa.',
  amount_mismatch: 'El importe no acredita una devolución completa.',
  customer_unavailable: 'El cliente original ya no está disponible; revisa el historial.',
  insufficient_balance: 'Saldo insuficiente para revertir la compra y sus beneficios.',
  original_unavailable: 'El estado de la venta impide una reversión automática comprobable.',
  retryable_error: 'El recibo sigue guardado; revisa el historial antes de reintentar.',
  other: 'Devolución pendiente con motivo por revisar en la caja.'
};
function latest(...values) { return values.map(timestamp).filter(Boolean).sort().at(-1) ?? null; }
function reason(code, label, value) { return { code, label, ...(value === undefined ? {} : { count: count(value) }) }; }
function posHealth(business, now, refunds = []) {
  const program = business.program_json ?? {};
  const pos = program.pos_integration ?? {};
  const sync = pos.last_sync ?? {};
  const mode = ['api', 'csv', 'loyverse'].includes(pos.mode) ? pos.mode : 'api';
  const hasSecret = value => typeof value === 'string' && value.length > 0 && !value.startsWith('enc:');
  const configured = pos.enabled === true && program.external_awards?.enabled === true
    && (mode !== 'api' || hasSecret(program.external_awards?.api_key))
    && (mode !== 'loyverse' || hasSecret(pos.loyverse?.access_token));
  const completed = timestamp(pos.last_completed_at);
  const observed = latest(timestamp(sync.at) ?? completed, ...refunds.map(row => row.last_observed_at));
  const pendingRefunds = refunds.reduce((sum, row) => sum + count(row.pending), 0);
  const reconciledRefunds = refunds.reduce((sum, row) => sum + count(row.reconciled), 0);
  const pending = Math.max(Array.isArray(pos.pending_receipts) ? pos.pending_receipts.length : 0, count(sync.pending));
  const errors = count(sync.errors);
  // A recent partial poll does not prove that the whole import window completed.
  // Manual CSV/API connections have no scheduled completion deadline.
  const reference = completed ?? timestamp(pos.connected_at);
  const stale = configured && mode === 'loyverse' && pos.automatic === true
    && reference !== null && now.getTime() - Date.parse(reference) > 24 * HOUR;
  const attention = pendingRefunds > 0 || pending > 0 || errors > 0 || ['error', 'attention'].includes(sync.status) || sync.has_more === true || stale;
  const state = attention ? 'needs_attention' : configured ? 'configured' : 'not_configured';
  let summary = configured
    ? 'La configuración está registrada; no confirma una conexión en vivo.'
    : 'La conexión de caja está desactivada o su configuración está incompleta.';
  if (stale) summary += ' La importación automática lleva más de 24 horas sin una ventana completada. Revisa la conexión y las ventas pendientes.';
  else if (pending || errors || ['error', 'attention'].includes(sync.status) || sync.has_more === true) summary += ' Hay errores, ventas o una ventana de importación pendientes de revisar.';
  if (pendingRefunds > 0) summary += ' Hay devoluciones guardadas pendientes de conciliación; una importación reciente no las resuelve.';
  const reasons = [];
  if (pending) reasons.push(reason('pending_receipts', 'Ventas pendientes de revisar.', pending));
  if (errors) reasons.push(reason('sync_errors', 'Errores en la última importación.', errors));
  if (['error', 'attention'].includes(sync.status) && !errors) reasons.push(reason('sync_attention', 'La última importación requiere revisión.'));
  if (sync.has_more === true) reasons.push(reason('incomplete_import', 'La ventana de importación aún no se ha completado.'));
  if (stale) reasons.push(reason('stalled_import', 'Más de 24 horas sin una ventana automática completada.'));
  for (const row of refunds) if (count(row.pending)) {
    const code = Object.hasOwn(REFUND_REASONS, row.reason) ? row.reason : 'other';
    reasons.push(reason(`refund_${code}`, REFUND_REASONS[code], row.pending));
  }
  return section('pos', state, summary, observed, [
    metric('pending_receipts', 'Ventas pendientes de revisar', pending),
    metric('last_sync_errors', 'Errores de la última importación', errors),
    metric('last_completed_at', 'Última ventana completada', completed),
    metric('pending_refunds', 'Devoluciones pendientes de conciliación', pendingRefunds),
    metric('reconciled_refunds', 'Devoluciones conciliadas', reconciledRefunds)
  ], reasons);
}

const MESSAGE_LABELS = {
  queued: 'En cola', processing: 'En proceso', accepted: 'Aceptados por el proveedor',
  failed: 'Fallidos', uncertain: 'Resultado incierto', suppressed: 'Suprimidos',
  stale: 'Vencidos o con más de una hora de retraso',
  stale_queue: 'En cola con más de una hora de retraso',
  stale_processing: 'En proceso con plazo de confirmación vencido', expired: 'Mensajes vencidos pendientes de cierre'
};
const messageCounts = row => Object.fromEntries(['total', ...Object.keys(MESSAGE_LABELS)].map(key => [key, count(row?.[key])]));
const messageMetrics = counts => Object.entries(MESSAGE_LABELS).map(([key, label]) => metric(key, label, counts[key]));
function messageReasons(counts) {
  return [
    ['failed', 'Mensajes fallidos: revisa el proveedor y los intentos registrados.'],
    ['uncertain', 'Resultado incierto: comprueba el proveedor antes de decidir; PF no reenvía automáticamente.'],
    ['stale_queue', 'Mensajes en cola con más de una hora de retraso.'],
    ['stale_processing', 'Plazo de confirmación vencido: el envío puede haber ocurrido. Revisa el proveedor antes de reenviar.'],
    ['expired', 'Mensajes cuya vigencia terminó y siguen pendientes de cierre.']
  ].filter(([key]) => counts[key] > 0).map(([key, label]) => reason(key, label, counts[key]));
}
function messageHealth(rows = [], ready = null) {
  const sources = [{ id: 'growth', title: 'Campañas', href: '#ofertas' }, { id: 'lifecycle', title: 'Automatizaciones', href: '#automatizaciones' }].map(source => {
    const row = rows.find(value => value.source === source.id) ?? {};
    const counts = messageCounts(row);
    return { ...source, counts, metrics: messageMetrics(counts), last_observed_at: timestamp(row.last_observed_at) };
  });
  const counts = messageCounts({});
  for (const source of sources) for (const key of Object.keys(counts)) counts[key] += source.counts[key];
  const attention = counts.failed > 0 || counts.uncertain > 0 || counts.stale > 0;
  let summary = ready === true
    ? 'Hay un proveedor habilitado con la configuración local necesaria; no confirma una conexión actual.'
    : ready === false
      ? 'No hay un proveedor de mensajería habilitado con la configuración local necesaria.'
      : 'No se pudo determinar la configuración actual del proveedor de mensajería.';
  if (counts.total === 0) summary += ' No hay actividad registrada.';
  if (attention) summary += ' Hay mensajes fallidos, inciertos o pendientes fuera de plazo.';
  if (counts.processing) summary += ' En proceso significa que todavía no hay un resultado confirmado; no reenvíes sin revisar.';
  summary += ' La aceptación por el proveedor no confirma la entrega.';
  return { ...section('messaging', attention ? 'needs_attention' : readinessState(ready), summary,
    latest(...sources.map(source => source.last_observed_at)), messageMetrics(counts), messageReasons(counts)),
    sources: sources.map(({ counts: _counts, ...source }) => source) };
}

function walletHealth(provider, row = {}, ready = null) {
  const registered = count(row.registered), pending = count(row.pending), failed = count(row.failed), stale = count(row.stale);
  const attention = failed > 0 || stale > 0;
  let summary = ready === true
    ? 'El proveedor está habilitado con la configuración local necesaria; no confirma una conexión actual.'
    : ready === false
      ? 'El proveedor está desactivado o falta completar su configuración local.'
      : 'No se pudo determinar la configuración actual del proveedor.';
  if (registered === 0) summary += ' No hay registros de pases.';
  if (attention) summary += ' Hay actualizaciones fallidas o con más de una hora de retraso.';
  else if (pending > 0) summary += ' Hay actualizaciones pendientes.';
  summary += ' Los registros de pases no confirman una emisión completada ni su instalación en un dispositivo.';
  const reasons = [];
  if (failed) reasons.push(reason('failed_updates', 'Actualizaciones pendientes con intentos fallidos.', failed));
  if (stale) reasons.push(reason('stale_updates', 'Actualizaciones pendientes con más de una hora de retraso.', stale));
  return section(`${provider}_wallet`, attention ? 'needs_attention' : readinessState(ready), summary, row.last_observed_at, [
    metric('registered', 'Registros de pases', registered),
    metric('pending', 'Actualizaciones pendientes', pending),
    metric('failed', 'Actualizaciones con intentos fallidos', failed),
    metric('stale', 'Actualizaciones con más de una hora de retraso', stale)
  ], reasons);
}

function economicsHealth(row = {}) {
  const active = count(row.active_rewards), missing = count(row.missing_reward_costs);
  const completed = count(row.completed_redemptions), costed = count(row.costed_redemptions);
  const absent = count(row.missing_cost_snapshots), unknownSnapshots = count(row.unknown_snapshot_costs);
  const unknown = absent + unknownSnapshots;
  const reasons = [];
  if (missing) reasons.push(reason('missing_reward_costs', 'Recompensas activas sin costo actual: registra tu costo para futuros canjes.', missing));
  if (absent) reasons.push(reason('missing_cost_snapshots', 'Canjes completados sin registro histórico de costo; su costo permanece desconocido.', absent));
  if (unknownSnapshots) reasons.push(reason('unknown_snapshot_costs', 'Canjes cuyo costo no se conocía al completarse; su registro histórico permanece desconocido.', unknownSnapshots));
  const state = reasons.length ? 'needs_attention' : active || completed ? 'healthy' : 'unknown';
  let summary = state === 'healthy' ? 'Los costos observados tienen cobertura completa.'
    : state === 'unknown' ? 'No hay recompensas activas ni canjes completados para evaluar costos.'
      : 'Faltan costos actuales o históricos para evaluar el costo de las recompensas.';
  summary += ' Un costo desconocido no equivale a costo cero. Editar el costo actual no cambia el historial de canjes.';
  return section('economics', state, summary, row.last_observed_at, [
    metric('active_rewards', 'Recompensas activas y vigentes', active),
    metric('missing_reward_costs', 'Recompensas activas sin costo actual', missing),
    metric('completed_redemptions', 'Canjes completados en el historial', completed),
    metric('costed_redemptions', 'Canjes con costo conocido al completarse', costed),
    metric('unknown_cost_redemptions', 'Canjes con costo desconocido', unknown),
    metric('missing_cost_snapshots', 'Canjes sin registro histórico de costo', absent),
    metric('unknown_snapshot_costs', 'Canjes registrados con costo desconocido', unknownSnapshots),
    metric('cost_coverage_pct', 'Cobertura de costos de canjes (%)', completed ? Math.round(10000 * costed / completed) / 100 : null)
  ], reasons);
}
function nextActions(sections) {
  const actions = [];
  const add = (section, id, priority, label, href, reason) => actions.push({ id, section_id: section.id, priority, label, href, reason });
  for (const section of sections) {
    if (section.state === 'not_in_plan') continue;
    const values = Object.fromEntries(section.metrics.map(item => [item.key, item.value]));
    if (section.id === 'pos') {
      if (values.pending_refunds) add(section, 'pos_refunds', 10, 'Revisar devoluciones de caja', '#conectar-caja', `${values.pending_refunds} devoluciones guardadas aún requieren conciliación.`);
      if (section.reasons.some(item => !item.code.startsWith('refund_'))) add(section, 'pos_import', 20, 'Revisar importación de ventas', '#conectar-caja', 'Hay ventas, errores o una ventana de importación pendientes de revisión.');
    } else if (section.id === 'messaging') {
      for (const source of section.sources ?? []) {
        const counts = Object.fromEntries(source.metrics.map(item => [item.key, item.value]));
        if (counts.failed || counts.uncertain || counts.stale) add(section, `${source.id}_messages`, 30, `Revisar mensajes de ${source.title.toLowerCase()}`, source.href, 'Revisa los fallos y resultados inciertos antes de decidir sobre nuevos envíos.');
      }
    } else if (section.id === 'owner_brief') {
      if(section.state==='needs_attention')add(section,'owner_brief_history',25,'Revisar el resumen semanal','#automatizaciones','Hay envíos fallidos, inciertos o vencidos; revisa su historial antes de decidir sobre otro envío.');
    } else if (section.id === 'economics') {
      if (values.missing_reward_costs) add(section, 'reward_costs', 40, 'Completar costos de recompensas', '#costos', `${values.missing_reward_costs} recompensas activas aún no tienen costo para futuros canjes.`);
      if (values.unknown_cost_redemptions) add(section, 'historical_costs', 50, 'Revisar cobertura histórica de costos', '#costos', 'Los costos históricos desconocidos no se completan al editar los costos actuales.');
    } else if (section.state === 'needs_attention') add(section, `${section.id}_updates`, 35, `Revisar ${section.title}`, '#preparar', 'Hay actualizaciones pendientes con fallos o retrasos; comprueba el proveedor.');
    if (section.state === 'not_configured' || section.state === 'unknown') add(section, `${section.id}_setup`, 80,
      section.id === 'economics' ? 'Preparar recompensas y costos' : section.action.label, section.id === 'economics' ? '#preparar' : section.action.href,
      section.id === 'economics' ? 'Necesitas recompensas o canjes para evaluar la cobertura.' : 'La configuración está incompleta o no se pudo confirmar; revisa si usarás esta función en tu piloto.');
  }
  return actions.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}
function sectionSummary(sections) {
  const states = { needs_attention: 'attention_count', not_configured: 'setup_count', configured: 'configured_count', healthy: 'healthy_count', unknown: 'unknown_count', not_in_plan: 'not_in_plan_count' };
  const summary = Object.fromEntries(Object.values(states).map(key => [key, 0]));
  for (const section of sections) summary[states[section.state]]++;
  return summary;
}

// Every result is a bounded aggregate of this tenant's persisted evidence.
// Missing tables/permissions are errors, never empty queues. Reads do not repair
// messages/refunds, contact providers, or backfill immutable historical costs.
export function createMerchantOperationsService(deps = {}) {
  const query = deps.query ?? dbQuery;
  const getBusiness = deps.getBusiness ?? (id => BusinessRepo.getById(id));
  const getFeatureOverrides = deps.getFeatureOverrides ?? (() => PlanConfigService.getPlanFeatureOverrides());
  const getProviderReadiness = deps.getProviderReadiness ?? providerReadiness;
  async function getOperationsHealth({ businessId, now = new Date() }) {
    const business = await getBusiness(businessId);
    if (!business || String(business.id) !== String(businessId)) throw notFound('Negocio no encontrado.');
    const overrides = await getFeatureOverrides();
    const allowed = feature => hasPlanFeature(business.plan, feature, overrides);
    const includeMessaging = ['campaign_rules', 'lifecycle_automation', 'analytics'].every(allowed);
    const includeOwnerBrief=['analytics','lifecycle_automation'].every(allowed);
    const readiness = await getProviderReadiness({ includeMessaging, includeOwnerBrief });
    let pos = locked('pos');
    if (allowed('external_awards')) {
      const { rows } = await query(`SELECT CASE WHEN reason=ANY($2::text[]) THEN reason ELSE 'other' END AS reason,
        count(*) FILTER(WHERE status='pending')::int AS pending,
        count(*) FILTER(WHERE status='reconciled')::int AS reconciled, max(updated_at) AS last_observed_at
        FROM pos_refund_receipts WHERE business_id=$1 GROUP BY 1`, [businessId, Object.keys(REFUND_REASONS)]);
      pos = posHealth(business, now, rows);
    }
    let messaging = locked('messaging');
    if (includeMessaging) {
      const { rows } = await query(`WITH messages AS (
        SELECT 'growth' AS source,status,next_attempt_at,lease_until,updated_at,NULL::timestamptz AS expires_at
          FROM growth_message_outbox WHERE business_id=$1
        UNION ALL
        SELECT 'lifecycle' AS source,status,next_attempt_at,lease_until,updated_at,expires_at
          FROM lifecycle_message_outbox WHERE business_id=$1
      ), observed AS (SELECT *,
        (status IN ('queued','failed') AND next_attempt_at < $2::timestamptz - interval '1 hour') AS stale_queue,
        (status='processing' AND (lease_until <= $2::timestamptz OR (lease_until IS NULL AND updated_at < $2::timestamptz - interval '1 hour'))) AS stale_processing,
        (status IN ('queued','failed') AND expires_at <= $2::timestamptz) AS expired FROM messages)
      SELECT source,count(*)::int AS total,
        count(*) FILTER(WHERE status='queued')::int AS queued,
        count(*) FILTER(WHERE status='processing')::int AS processing,
        count(*) FILTER(WHERE status='accepted')::int AS accepted,
        count(*) FILTER(WHERE status='failed')::int AS failed,
        count(*) FILTER(WHERE status='uncertain')::int AS uncertain,
        count(*) FILTER(WHERE status='suppressed')::int AS suppressed,
        count(*) FILTER(WHERE stale_queue OR stale_processing OR expired)::int AS stale,
        count(*) FILTER(WHERE stale_queue)::int AS stale_queue,
        count(*) FILTER(WHERE stale_processing)::int AS stale_processing,
        count(*) FILTER(WHERE expired)::int AS expired,
        max(updated_at) AS last_observed_at FROM observed GROUP BY source`, [businessId, now.toISOString()]);
      messaging = messageHealth(rows, readiness?.messaging);
    }
    // Records are created before issuance/savePass can fail, and do not prove installation.
    const { rows } = await query(`SELECT provider, count(*)::int AS registered,
      count(*) FILTER (WHERE revision>synced_revision)::int AS pending,
      count(*) FILTER (WHERE revision>synced_revision AND attempts>0)::int AS failed,
      count(*) FILTER (WHERE revision>synced_revision AND next_attempt_at < $2::timestamptz - interval '1 hour')::int AS stale,
      max(updated_at) AS last_observed_at
      FROM native_wallet_passes WHERE business_id=$1 GROUP BY provider`, [businessId, now.toISOString()]);
    let economics = locked('economics');
    if (allowed('analytics')) {
      const result = await query(`WITH current_costs AS (
        SELECT count(*)::int AS active_rewards,
          count(*) FILTER(WHERE c.unit_cost_q IS NULL)::int AS missing_reward_costs,
          max(c.updated_at) AS last_cost_at
        FROM rewards r LEFT JOIN reward_unit_costs c ON c.business_id=$1 AND c.reward_id=r.id
        WHERE r.business_id=$1 AND r.active=true AND (r.valid_until IS NULL OR r.valid_until>$2::timestamptz)
      ), historical_costs AS (
        SELECT count(*)::int AS completed_redemptions, count(s.unit_cost_q)::int AS costed_redemptions,
          count(*) FILTER(WHERE s.redemption_id IS NULL)::int AS missing_cost_snapshots,
          count(*) FILTER(WHERE s.redemption_id IS NOT NULL AND s.unit_cost_q IS NULL)::int AS unknown_snapshot_costs,
          max(COALESCE(s.redeemed_at,r.redeemed_at,r.created_at)) AS last_redemption_at
        FROM redemptions r
        JOIN customers customer ON customer.id=r.customer_id AND customer.business_id=$1
        JOIN rewards reward ON reward.id=r.reward_id AND reward.business_id=$1
        LEFT JOIN redemption_cost_snapshots s ON s.business_id=$1 AND s.redemption_id=r.id
        WHERE r.business_id=$1 AND r.status='REDEEMED'
      ) SELECT c.*,h.*,GREATEST(c.last_cost_at,h.last_redemption_at) AS last_observed_at
        FROM current_costs c CROSS JOIN historical_costs h`, [businessId, now.toISOString()]);
      economics = economicsHealth(result.rows[0]);
    }
    let ownerBrief=locked('owner_brief');
    if(includeOwnerBrief){
      const stored=business.program_json?.weekly_owner_brief??{},channel=stored.channel??(stored.owner_id?'phone':'email');
      const brief=(await query(`SELECT count(*)::int AS total,
       count(*) FILTER(WHERE status='failed')::int AS failed,count(*) FILTER(WHERE status='uncertain')::int AS uncertain,
       count(*) FILTER(WHERE status='accepted')::int AS accepted,count(*) FILTER(WHERE status='queued')::int AS queued,
       count(*) FILTER(WHERE status='processing' AND (lease_until<=$2 OR (lease_until IS NULL AND updated_at<$2::timestamptz-interval '1 hour')))::int AS stale_processing,
       count(*) FILTER(WHERE status IN('queued','failed') AND expires_at<=$2)::int AS expired,
       max(updated_at) AS last_observed_at,
       EXISTS(SELECT 1 FROM staff_users s WHERE s.business_id=$1 AND s.id::text=$3 AND s.role='OWNER' AND s.active AND
        CASE WHEN $4='email' THEN lower(trim(s.email))=$5 AND lower(trim(s.verified_email))=$5 AND s.email_verified_at IS NOT NULL
        ELSE regexp_replace(COALESCE(s.phone,''),'[^0-9]','','g')=$5 END) AS destination_ready
       FROM weekly_owner_briefs WHERE business_id=$1`,[businessId,now.toISOString(),stored.owner_id??null,channel,stored.destination??null])).rows[0]??{};
      const enabled=stored.settings?.enabled===true,provider=channel==='email'?readiness?.owner_brief_email:readiness?.messaging;
      const attention=['failed','uncertain','stale_processing','expired'].some(k=>count(brief[k])>0);
      const state=attention?'needs_attention':!enabled||provider===false||!brief.destination_ready?'not_configured':provider===true?'configured':'unknown';
      const metrics=[['failed','Fallidos'],['uncertain','Resultado incierto'],['accepted','Aceptados por el proveedor'],['queued','En cola'],['stale_processing','Procesamiento sin confirmación vigente'],['expired','Pendientes fuera de plazo']].map(([key,label])=>metric(key,label,count(brief[key])));
      const reasons=attention?[{code:'owner_brief_delivery_review',label:'Consulta el historial; no se reenvían resultados inciertos desde este diagnóstico.'}]:[];
      ownerBrief={...section('owner_brief',state,`${enabled?'Resumen activado.':'Resumen desactivado; requiere activación expresa.'} Canal: ${channel==='email'?'correo':'teléfono'}. La aceptación del proveedor no acredita entrega ni lectura.`,brief.last_observed_at,metrics,reasons)};
    }
    const sections = [pos, messaging,
      walletHealth('apple', rows.find(row => row.provider === 'apple'), readiness?.apple_wallet),
      walletHealth('google', rows.find(row => row.provider === 'google'), readiness?.google_wallet), economics, ownerBrief];
    return { generated_at: now.toISOString(), sections, summary: sectionSummary(sections), next_actions: nextActions(sections) };
  }
  return { getOperationsHealth };
}

export const { getOperationsHealth } = createMerchantOperationsService();
