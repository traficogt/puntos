import type {AlertRow, AnomaliesResponse, AuditDetail, AuditEvent, BackgroundJob, CertificationArchiveResponse, CertificationDay, CertificationResponse, LedgerCorrection, PaymentEvent, ReconciliationResponse} from './owner-operations-model';

// Synthetic, browser-only preview for the operations screens (background jobs and recalculation, pending
// payments, alerts, ledger anomalies/reconciliation/certification/corrections, audit log). No request here
// reaches a PF API; edits last until reload. Shapes follow the server routes under src/app/routes.
const uuid = (value: number) => `77777777-7777-4777-8777-${String(value).padStart(12, '0')}`;
const businessId = '11111111-1111-4111-8111-111111111111';
const demoOwner = 'demo-owner', otherOwner = uuid(61), cashier = uuid(91);
const customerA = uuid(41), customerB = uuid(42);
type Body = Record<string, unknown>;
const fail = (message: string, status: number) => Object.assign(new Error(message), {status});
const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const limitOf = (url: URL, fallback: number, max = 200) => Math.max(1, Math.min(max, Number(url.searchParams.get('limit') || fallback) || fallback));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (date: Date) => date.toISOString().slice(0, 10);
const byDateDesc = <T extends {created_at: string}>(rows: T[]) => [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

export function createOwnerOperationsDemoApi(now = () => new Date('2026-11-10T18:00:00Z')) {
  let sequence = 500;
  const jobs: BackgroundJob[] = [
    {id: uuid(1), job_type: 'analytics.calculate', status: 'DONE', attempts: 1, created_at: '2026-11-10T06:00:00Z', started_at: '2026-11-10T06:00:02Z', completed_at: '2026-11-10T06:00:09Z', error: null},
    {id: uuid(2), job_type: 'ledger.reconcile', status: 'DONE', attempts: 1, created_at: '2026-11-10T05:10:00Z', started_at: '2026-11-10T05:10:01Z', completed_at: '2026-11-10T05:10:41Z', error: null},
    {id: uuid(3), job_type: 'pos.sync', status: 'FAILED', attempts: 3, created_at: '2026-11-09T22:15:00Z', started_at: '2026-11-09T22:15:03Z', completed_at: null, error: 'La caja no respondió a tiempo (30 s). Se reintentará en la próxima ventana.'},
    {id: uuid(4), job_type: 'lifecycle.dispatch', status: 'DONE', attempts: 1, created_at: '2026-11-09T15:00:00Z', started_at: '2026-11-09T15:00:01Z', completed_at: '2026-11-09T15:00:12Z', error: null},
    {id: uuid(5), job_type: 'wallet.push', status: 'DONE', attempts: 1, created_at: '2026-11-08T17:30:00Z', started_at: '2026-11-08T17:30:02Z', completed_at: '2026-11-08T17:30:05Z', error: null},
  ];
  // Each poll of a job queued in the preview advances it: PENDING → RUNNING → DONE.
  const polls = new Map<string, number>();
  const payments: PaymentEvent[] = [
    {id: uuid(11), provider: 'recurrente', provider_event_id: 'evt_48213', event_type: 'payment.approved', status: 'PENDING_MAPPING', reason: 'missing_customer_mapping', error: null, amount_q: '185.00', currency: 'GTQ', customer_phone: null, customer_id: null, created_at: '2026-11-10T16:42:00Z'},
    {id: uuid(12), provider: 'recurrente', provider_event_id: 'evt_48190', event_type: 'payment.approved', status: 'PENDING_MAPPING', reason: 'customer_not_found', error: 'Customer not found', amount_q: '62.50', currency: 'GTQ', customer_phone: '55559876', customer_id: null, created_at: '2026-11-10T12:05:00Z'},
    {id: uuid(13), provider: 'recurrente', provider_event_id: 'evt_48102', event_type: 'payment.approved', status: 'APPLIED', reason: null, error: null, amount_q: '120.00', currency: 'GTQ', customer_phone: '55551234', customer_id: uuid(31), created_at: '2026-11-09T19:20:00Z'},
    {id: uuid(14), provider: 'recurrente', provider_event_id: 'evt_48077', event_type: 'payment.approved', status: 'FAILED', reason: 'award_failed', error: 'El monto supera el máximo por transacción.', amount_q: '2400.00', currency: 'GTQ', customer_phone: '55550000', customer_id: null, created_at: '2026-11-09T11:40:00Z'},
  ];
  const corrections: LedgerCorrection[] = [
    {id: uuid(71), customer_id: customerA, status: 'PENDING', reason: 'Descuadre detectado en la conciliación del 10 de noviembre; el cliente reporta 380 puntos.', requested_by_staff_id: otherOwner, resolved_by_staff_id: null, source_run_id: uuid(51), source_finding_id: null, requested_stored_points: 420, requested_expected_points: 380, requested_stored_pending_points: 0, requested_expected_pending_points: 0, requested_stored_lifetime_points: 1260, requested_expected_lifetime_points: 1220, resolution_meta: null, created_at: '2026-11-10T08:30:00Z', resolved_at: null},
    {id: uuid(72), customer_id: customerB, status: 'APPLIED', reason: 'Reversa duplicada en caja el 7 de noviembre.', requested_by_staff_id: otherOwner, resolved_by_staff_id: demoOwner, source_run_id: uuid(53), source_finding_id: null, requested_stored_points: 95, requested_expected_points: 110, requested_stored_pending_points: 20, requested_expected_pending_points: 20, requested_stored_lifetime_points: 640, requested_expected_lifetime_points: 655, resolution_meta: null, created_at: '2026-11-08T10:00:00Z', resolved_at: '2026-11-08T12:15:00Z'},
  ];
  const reconciliation: ReconciliationResponse = {
    latest_run: {id: uuid(51), started_at: '2026-11-10T05:10:00Z', completed_at: '2026-11-10T05:10:41Z', status: 'COMPLETED', checked_customers: 184, mismatched_customers: 2, repaired_customers: 1, scope: 'business'},
    recent_runs: [
      {id: uuid(51), started_at: '2026-11-10T05:10:00Z', completed_at: '2026-11-10T05:10:41Z', status: 'COMPLETED', checked_customers: 184, mismatched_customers: 2, repaired_customers: 1, scope: 'business'},
      {id: uuid(52), started_at: '2026-11-09T05:10:00Z', completed_at: '2026-11-09T05:10:38Z', status: 'COMPLETED', checked_customers: 181, mismatched_customers: 0, repaired_customers: 0, scope: 'business'},
      {id: uuid(53), started_at: '2026-11-08T05:10:00Z', completed_at: '2026-11-08T05:10:40Z', status: 'COMPLETED', checked_customers: 179, mismatched_customers: 1, repaired_customers: 1, scope: 'business'},
    ],
    latest_findings: [
      {customer_id: customerA, stored_points: 420, expected_points: 380, stored_pending_points: 0, expected_pending_points: 0, stored_lifetime_points: 1260, expected_lifetime_points: 1220, delta_points: 40, delta_pending_points: 0, delta_lifetime_points: 40, repaired: false, created_at: '2026-11-10T05:10:30Z'},
      {customer_id: customerB, stored_points: 95, expected_points: 110, stored_pending_points: 20, expected_pending_points: 20, stored_lifetime_points: 640, expected_lifetime_points: 655, delta_points: -15, delta_pending_points: 0, delta_lifetime_points: -15, repaired: true, created_at: '2026-11-10T05:10:31Z'},
    ],
  };
  const events: AuditEvent[] = [
    {id: uuid(81), created_at: '2026-11-10T16:45:00Z', actor_type: 'STAFF', actor_id: cashier, action: 'award.create', meta: {transaction_id: uuid(101), points: 185}, actor_name: 'Lucía Pérez', actor_email: 'lucia@ejemplo.invalid'},
    {id: uuid(82), created_at: '2026-11-10T15:20:00Z', actor_type: 'STAFF', actor_id: demoOwner, action: 'program.update', meta: {fields: ['award_guard']}, actor_name: 'Propietario demo', actor_email: 'propietario@ejemplo.invalid'},
    {id: uuid(83), created_at: '2026-11-10T11:02:00Z', actor_type: 'STAFF', actor_id: cashier, action: 'reward.redeem', meta: {redemption_id: uuid(102)}, actor_name: 'Lucía Pérez', actor_email: 'lucia@ejemplo.invalid'},
    {id: uuid(84), created_at: '2026-11-09T18:30:00Z', actor_type: 'STAFF', actor_id: cashier, action: 'award.refund', meta: {transaction_id: uuid(101), reversal_transaction_id: uuid(103), reason: 'Devolución en caja'}, actor_name: 'Lucía Pérez', actor_email: 'lucia@ejemplo.invalid'},
    {id: uuid(85), created_at: '2026-11-09T09:15:00Z', actor_type: 'STAFF', actor_id: demoOwner, action: 'branding.update', meta: {impersonated_by_super_admin_email: 'soporte@puntosfieles.com', fields: ['primary_color']}, actor_name: 'Propietario demo', actor_email: 'propietario@ejemplo.invalid'},
    {id: uuid(86), created_at: '2026-11-08T17:05:00Z', actor_type: 'STAFF', actor_id: demoOwner, action: 'gift_card.issue', meta: {gift_card_id: uuid(104), gift_card_tx_id: uuid(105)}, actor_name: 'Propietario demo', actor_email: 'propietario@ejemplo.invalid'},
    {id: uuid(87), created_at: '2026-11-07T09:00:00Z', actor_type: 'PLATFORM', actor_id: null, action: 'platform.plan.update', meta: {}, actor_name: 'Plataforma', actor_email: null},
    {id: uuid(88), created_at: '2026-11-06T06:00:00Z', actor_type: 'SYSTEM', actor_id: null, action: 'ledger.reconciliation.completed', meta: {run_id: uuid(53)}, actor_name: null, actor_email: null},
  ];
  const linkedRecords = (event: AuditEvent): NonNullable<AuditDetail['linked']> => {
    const meta = event.meta ?? {}, linked: NonNullable<AuditDetail['linked']> = {};
    if (meta.transaction_id) linked.transaction = {id: String(meta.transaction_id), customer_name: 'Carlos Méndez', customer_phone: '55551234', source: 'manual', status: 'POSTED', points: 185, reversal_reason: null};
    if (meta.reversal_transaction_id) linked.reversal_transaction = {id: String(meta.reversal_transaction_id), customer_name: 'Carlos Méndez', customer_phone: '55551234', source: 'reversal', status: 'POSTED', points: -185, reversal_reason: 'Devolución en caja'};
    if (meta.redemption_id) linked.redemption = {id: String(meta.redemption_id), code: 'CJ-4F2A', reward_name: 'Café de la casa', customer_name: 'Ana López', customer_phone: '55554321', points_cost: 100};
    if (meta.gift_card_id) linked.gift_card = {code: 'GC-DEMO-0002', balance_q: 100, status: 'ACTIVE'};
    if (meta.gift_card_tx_id) linked.gift_card_transaction = {tx_type: 'ISSUE', amount_q: 100, balance_after_q: 100};
    return linked;
  };

  const pendingCorrections = () => corrections.filter(row => row.status === 'PENDING').length;
  const alerts = (): AlertRow[] => byDateDesc<AlertRow>([
    {id: uuid(21), created_at: '2026-11-09T20:40:00Z', severity: 'HIGH', alert_type: 'suspicious_award', details: ['suspicious_amount']},
    ...jobs.filter(job => job.status === 'FAILED').map(job => ({id: job.id, created_at: job.created_at ?? now().toISOString(), severity: 'MEDIUM', alert_type: 'job_failed', details: {job_type: job.job_type, error: job.error}})),
    {id: uuid(22), created_at: '2026-11-08T09:12:00Z', severity: 'MEDIUM', alert_type: 'webhook_delivery_failed', details: {event: 'redemption.completed', last_error: 'HTTP 503', attempts: 5, endpoint: 'https://erp.ejemplo.invalid/puntos'}},
    ...payments.filter(event => event.status === 'FAILED' || event.status === 'PENDING_MAPPING').map(event => ({id: event.id, created_at: event.created_at, severity: event.status === 'FAILED' ? 'MEDIUM' : 'LOW', alert_type: 'payment_webhook_issue', details: {status: event.status, reason: event.reason, error: event.error, provider: event.provider}})),
  ]);
  const anomalies = (): AnomaliesResponse => ({
    summary: {negative_balance_count: 1, reversals_24h: 2, replay_events_24h: 3, pending_corrections_count: pendingCorrections(), latest_reconciliation_mismatches: 2},
    replay_breakdown: [{action: 'award.replay', count: 2}, {action: 'reward.redeem.replay', count: 1}],
    top_refund_actors: [{actor_name: 'Lucía Pérez', actor_id: cashier, reversal_count: 2}],
    negative_balances: [{id: uuid(31), name: 'Carlos Méndez', phone: '55551234', points: -40}],
  });
  const certification = (url: URL): CertificationResponse => {
    const today = now();
    const to = DATE.test(url.searchParams.get('to') ?? '') ? String(url.searchParams.get('to')) : day(today);
    const from = DATE.test(url.searchParams.get('from') ?? '') ? String(url.searchParams.get('from')) : day(new Date(today.getTime() - 29 * 86400000));
    const rows: CertificationDay[] = [];
    for (let cursor = new Date(`${from}T00:00:00Z`), index = 0; day(cursor) <= to && index < 31; cursor = new Date(cursor.getTime() + 86400000), index += 1) {
      rows.push({date: day(cursor), points_issued: 180 + ((index * 37) % 140), points_redeemed: 60 + ((index * 23) % 90), points_reversed: index % 5 === 0 ? 15 : 0, points_expired: index % 9 === 0 ? 30 : 0, adjustment_points: index % 11 === 0 ? -10 : 0, gift_cards_issued_q: index % 6 === 0 ? 50 : 0, gift_cards_redeemed_q: index % 8 === 0 ? 25 : 0, replay_events: index % 7 === 0 ? 1 : 0});
    }
    const sum = (key: keyof Omit<CertificationDay, 'date'>) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
    const summary = {points_issued: sum('points_issued'), points_redeemed: sum('points_redeemed'), points_reversed: sum('points_reversed'), points_expired: sum('points_expired'), adjustment_points: sum('adjustment_points'), gift_cards_issued_q: sum('gift_cards_issued_q'), gift_cards_redeemed_q: sum('gift_cards_redeemed_q'), replay_events: sum('replay_events'), pending_corrections_count: pendingCorrections(), negative_balance_count: 1, latest_reconciliation_mismatches: 2, latest_reconciliation_completed_at: '2026-11-10T05:10:41Z'};
    const status = summary.pending_corrections_count > 0 || summary.negative_balance_count > 0 || summary.latest_reconciliation_mismatches > 0 ? 'REVIEW_REQUIRED' : 'OK';
    return {ok: true, business: {id: businessId, name: 'Café Jacaranda · demo', slug: 'cafe-jacaranda-demo'}, generated_at: today.toISOString(), period: {from, to}, certification_status: status, summary, daily_rows: rows};
  };
  const archive = (): CertificationArchiveResponse => ({retention_days: 30, available_days: ['2026-11-09', '2026-11-08', '2026-11-07'].map(date => ({date, certification_status: date === '2026-11-08' ? 'OK' : 'REVIEW_REQUIRED', period: {from: day(new Date(new Date(`${date}T00:00:00Z`).getTime() - 29 * 86400000)), to: date}, generated_at: `${date}T06:05:00Z`, json_url: `/api/admin/analytics/ledger-certification/archive/${date}`, csv_url: `/api/admin/analytics/ledger-certification/archive/${date}.csv`}))});

  return (url: URL, options: RequestInit = {}): unknown => {
    const path = url.pathname, method = options.method || 'GET';
    const body: Body = typeof options.body === 'string' && options.body ? JSON.parse(options.body) : {};
    if (path === '/api/admin/analytics/calculate' && method === 'POST') {
      const job: BackgroundJob = {id: uuid(++sequence), job_type: 'analytics.calculate', status: 'PENDING', attempts: 0, created_at: now().toISOString(), started_at: null, completed_at: null, error: null};
      jobs.unshift(job);
      return {ok: true, message: 'Recalculo de analitica en cola', job: {id: job.id, status: job.status, created_at: job.created_at}};
    }
    if (path === '/api/admin/jobs' && method === 'GET') return {ok: true, jobs: jobs.slice(0, limitOf(url, 20, 100))};
    const jobMatch = path.match(/^\/api\/admin\/jobs\/([^/]+)$/);
    if (jobMatch && method === 'GET') {
      const job = jobs.find(row => row.id === jobMatch[1]);
      if (!job) throw fail('Tarea no encontrada', 404);
      if (job.status === 'PENDING' || job.status === 'RUNNING') {
        const count = (polls.get(job.id) ?? 0) + 1;
        polls.set(job.id, count);
        if (count === 1) {job.status = 'RUNNING'; job.started_at = now().toISOString();}
        else {job.status = 'DONE'; job.attempts = 1; job.completed_at = now().toISOString();}
      }
      return {ok: true, job};
    }
    if (path === '/api/admin/payment-webhooks' && method === 'GET') {
      const status = (url.searchParams.get('status') || '').toUpperCase();
      return {ok: true, events: byDateDesc(payments.filter(event => !status || event.status === status)).slice(0, limitOf(url, 50))};
    }
    const resolveMatch = path.match(/^\/api\/admin\/payment-webhooks\/([^/]+)\/resolve$/);
    if (resolveMatch && method === 'POST') {
      const event = payments.find(row => row.id === resolveMatch[1]);
      if (!event) throw fail('Evento de pago no encontrado', 404);
      const phone = text(body.customerPhone).trim(), customerId = text(body.customerId).trim();
      if (!phone && !customerId) throw fail('customerId or customerPhone is required', 400);
      if (phone && phone.length < 6) throw fail('customerPhone: String must contain at least 6 character(s)', 400);
      if (event.status === 'APPLIED') throw fail('Este pago ya fue asignado a un cliente.', 409);
      event.status = 'APPLIED'; event.reason = null; event.error = null;
      event.customer_phone = phone || event.customer_phone; event.customer_id = customerId || uuid(++sequence);
      return {ok: true, eventId: event.id, transactionId: uuid(++sequence), customerId: event.customer_id};
    }
    if (path === '/api/admin/alerts' && method === 'GET') return {ok: true, alerts: alerts().slice(0, limitOf(url, 50))};
    if (path === '/api/admin/analytics/anomalies' && method === 'GET') return {ok: true, ...anomalies()};
    if (path === '/api/admin/analytics/ledger-reconciliation' && method === 'GET') return {ok: true, ...reconciliation};
    if (path === '/api/admin/analytics/ledger-certification/archive' && method === 'GET') return {ok: true, generated_at: now().toISOString(), business_id: businessId, ...archive()};
    if (path === '/api/admin/analytics/ledger-certification' && method === 'GET') return certification(url);
    if (path === '/api/admin/analytics/ledger-corrections') {
      if (method === 'POST') {
        const customerId = text(body.customerId).trim(), reason = text(body.reason).trim();
        if (!UUID.test(customerId) || reason.length < 8 || reason.length > 500) throw fail('Indica el identificador del cliente y una razón de 8 a 500 caracteres.', 400);
        const finding = reconciliation.latest_findings.find(row => row.customer_id === customerId);
        const correction: LedgerCorrection = {id: uuid(++sequence), customer_id: customerId, status: 'PENDING', reason, requested_by_staff_id: demoOwner, resolved_by_staff_id: null, source_run_id: finding ? reconciliation.latest_run?.id ?? null : null, source_finding_id: null, requested_stored_points: finding?.stored_points ?? 100, requested_expected_points: finding?.expected_points ?? 100, requested_stored_pending_points: finding?.stored_pending_points ?? 0, requested_expected_pending_points: finding?.expected_pending_points ?? 0, requested_stored_lifetime_points: finding?.stored_lifetime_points ?? 100, requested_expected_lifetime_points: finding?.expected_lifetime_points ?? 100, resolution_meta: null, created_at: now().toISOString(), resolved_at: null};
        corrections.unshift(correction);
        return {ok: true, correction};
      }
      return {ok: true, corrections: corrections.slice(0, limitOf(url, 50))};
    }
    const correctionMatch = path.match(/^\/api\/admin\/analytics\/ledger-corrections\/([^/]+)\/(apply|reject)$/);
    if (correctionMatch && method === 'POST') {
      const correction = corrections.find(row => row.id === correctionMatch[1]);
      if (!correction) throw fail('Corrección no encontrada', 404);
      if (correction.status !== 'PENDING') throw fail('Esta corrección ya fue resuelta', 409);
      if (correctionMatch[2] === 'reject') {
        const reason = text(body.reason).trim();
        if (reason.length < 8 || reason.length > 500) throw fail('La razón del rechazo debe tener entre 8 y 500 caracteres.', 400);
        correction.resolution_meta = {reason};
      }
      // The real service requires a second owner; the preview has one account, so it lets the same person resolve.
      correction.status = correctionMatch[2] === 'apply' ? 'APPLIED' : 'REJECTED';
      correction.resolved_by_staff_id = demoOwner; correction.resolved_at = now().toISOString();
      return {ok: true, correction};
    }
    if (path === '/api/admin/audit' && method === 'GET') {
      const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '';
      const impersonated = ['1', 'true'].includes(url.searchParams.get('impersonated_only') || '');
      const rows = byDateDesc(events).filter(event => (!from || event.created_at.slice(0, 10) >= from.slice(0, 10)) && (!to || event.created_at.slice(0, 10) <= to.slice(0, 10)) && (!impersonated || Boolean(event.meta?.impersonated_by_super_admin_email)));
      return {ok: true, events: rows.slice(0, limitOf(url, 50))};
    }
    const auditMatch = path.match(/^\/api\/admin\/audit\/([^/]+)$/);
    if (auditMatch && method === 'GET') {
      const event = events.find(row => row.id === auditMatch[1]);
      if (!event) throw fail('Evento de auditoría no encontrado', 404);
      return {ok: true, event, linked: linkedRecords(event)};
    }
    return undefined;
  };
}
const ownerOperationsDemo = createOwnerOperationsDemoApi();
export function demoOwnerOperations(url: URL, options: RequestInit = {}) {return ownerOperationsDemo(url, options);}
