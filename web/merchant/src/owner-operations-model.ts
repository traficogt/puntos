// Contracts and pure helpers for the operations screens ported from the vanilla analytics tab
// (formerly the vanilla dashboard analytics tab): background jobs, pending payments, the alerts center, the
// points ledger (anomalies, reconciliation, certification, corrections) and the audit log.
// Interfaces mirror the server rows; NUMERIC/COUNT columns may arrive as strings.

export type Numeric = number | string | null | undefined;
export const whole = (value: Numeric) => Math.trunc(Number(value) || 0);

// GET /api/admin/jobs, GET /api/admin/jobs/:id (analytics plan feature).
export interface BackgroundJob {id: string; job_type: string; status: string; attempts?: Numeric; created_at: string | null; started_at?: string | null; completed_at?: string | null; error?: string | null}
export interface CalculateResponse {ok: boolean; message?: string; job?: {id: string; status: string; created_at?: string | null} | null}
const jobTypes: Record<string, string> = {'analytics.calculate': 'Recálculo de analítica', 'ledger.reconcile': 'Conciliación de saldos', 'ledger.certify': 'Certificación del libro', 'lifecycle.dispatch': 'Envío de automatizaciones', 'pos.sync': 'Importación de ventas', 'wallet.push': 'Actualización de pases Wallet'};
export const jobTypeLabel = (type: string) => jobTypes[type] ?? type;
export function jobStatus(status: string | null | undefined): {label: string; color: string} {
  switch (status) {
    case 'DONE': return {label: 'Completado', color: 'green'};
    case 'FAILED': return {label: 'Falló', color: 'red'};
    case 'RUNNING': return {label: 'En proceso', color: 'blue'};
    case 'PENDING': return {label: 'En cola', color: 'gray'};
    default: return {label: status || 'Sin estado', color: 'gray'};
  }
}
export type JobPollOutcome = {state: 'done' | 'timeout'} | {state: 'failed'; error: string};
/** Mirrors the vanilla recalculation loop: up to `attempts` reads of GET /api/admin/jobs/:id, `delayMs` apart. */
export async function pollJob(read: (jobId: string) => Promise<{job?: Pick<BackgroundJob, 'status' | 'error'> | null}>, jobId: string, {attempts = 20, delayMs = 1500, wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), onProgress = (_attempt: number, _status: string) => {}} = {}): Promise<JobPollOutcome> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await wait(delayMs);
    const job = (await read(jobId)).job;
    const status = job?.status ?? '';
    onProgress(attempt, status);
    if (status === 'DONE') return {state: 'done'};
    if (status === 'FAILED') return {state: 'failed', error: job?.error || 'Falló el trabajo de analítica'};
  }
  return {state: 'timeout'};
}

// GET /api/admin/payment-webhooks?status=PENDING_MAPPING, POST /api/admin/payment-webhooks/:id/resolve.
export interface PaymentEvent {id: string; provider: string; provider_event_id: string; event_type?: string | null; status: string; reason?: string | null; error?: string | null; amount_q: Numeric; currency?: string | null; customer_phone?: string | null; customer_id?: string | null; created_at: string}
export interface ResolvePaymentResponse {ok: boolean; eventId: string; transactionId?: string | null; customerId?: string | null}
export function phoneIssue(phone: string): string | null {
  const value = phone.trim();
  if (!value) return 'Escribe el teléfono del cliente.';
  if (value.replace(/\D/g, '').length < 6) return 'El teléfono debe tener al menos 6 dígitos.';
  return null;
}

// GET /api/admin/alerts (owner; the vanilla tab required the analytics plan feature).
export interface AlertRow {id: string; created_at: string; severity: string; alert_type: string; details?: unknown}
const alertTypes: Record<string, string> = {suspicious_award: 'Compra marcada como sospechosa', job_failed: 'Trabajo en segundo plano fallido', webhook_delivery_failed: 'Webhook sin entregar', payment_webhook_issue: 'Pago sin asignar o fallido'};
export const alertTypeLabel = (type: string) => alertTypes[type] ?? type;
export function severity(value: string): {label: string; color: string} {
  if (value === 'HIGH') return {label: 'Alta', color: 'red'};
  if (value === 'MEDIUM') return {label: 'Media', color: 'orange'};
  if (value === 'LOW') return {label: 'Baja', color: 'gray'};
  return {label: value || '—', color: 'gray'};
}
/** Flattens the per-type JSON the server attaches to an alert into one readable line. */
export function alertDetail(details: unknown): string {
  if (details == null || details === '') return '—';
  if (Array.isArray(details)) return details.length ? details.map(item => String(item)).join(', ') : '—';
  if (typeof details === 'object') {
    const parts = Object.entries(details as Record<string, unknown>).filter(([, value]) => value != null && value !== '').map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    return parts.length ? parts.join(' · ') : '—';
  }
  return String(details);
}

// GET /api/admin/analytics/anomalies.
export interface AnomaliesResponse {summary: {negative_balance_count: Numeric; reversals_24h: Numeric; replay_events_24h: Numeric; pending_corrections_count: Numeric; latest_reconciliation_mismatches: Numeric}; replay_breakdown: {action: string; count: Numeric}[]; top_refund_actors: {actor_name: string | null; actor_id?: string | null; reversal_count: Numeric}[]; negative_balances: {id: string; name: string | null; phone: string | null; points: Numeric}[]}
export const anomaliesRelevant = (data: AnomaliesResponse) => (data.replay_breakdown?.length ?? 0) > 0 || (data.top_refund_actors?.length ?? 0) > 0 || (data.negative_balances?.length ?? 0) > 0;

// GET /api/admin/analytics/ledger-reconciliation.
export interface ReconciliationRun {id: string; started_at?: string | null; completed_at: string | null; status: string; checked_customers: Numeric; mismatched_customers: Numeric; repaired_customers: Numeric; scope?: unknown}
export interface ReconciliationFinding {customer_id: string; stored_points: Numeric; expected_points: Numeric; stored_pending_points: Numeric; expected_pending_points: Numeric; stored_lifetime_points: Numeric; expected_lifetime_points: Numeric; delta_points?: Numeric; delta_pending_points?: Numeric; delta_lifetime_points?: Numeric; repaired: boolean; created_at?: string}
export interface ReconciliationResponse {latest_run: ReconciliationRun | null; recent_runs: ReconciliationRun[]; latest_findings: ReconciliationFinding[]}

// GET /api/admin/analytics/ledger-certification(.csv)?from&to, GET …/ledger-certification/archive.
export interface CertificationSummary {points_issued: Numeric; points_redeemed: Numeric; points_reversed: Numeric; points_expired: Numeric; adjustment_points: Numeric; gift_cards_issued_q: Numeric; gift_cards_redeemed_q: Numeric; replay_events?: Numeric; pending_corrections_count: Numeric; negative_balance_count: Numeric; latest_reconciliation_mismatches: Numeric; latest_reconciliation_completed_at: string | null}
export interface CertificationDay {date: string; points_issued: Numeric; points_redeemed: Numeric; points_reversed: Numeric; points_expired: Numeric; adjustment_points: Numeric; gift_cards_issued_q: Numeric; gift_cards_redeemed_q: Numeric; replay_events: Numeric}
export interface CertificationResponse {ok?: boolean; business?: {id?: string; name?: string; slug?: string} | null; generated_at?: string; period: {from: string; to: string}; certification_status: string; summary: CertificationSummary; daily_rows: CertificationDay[]}
export interface CertificationArchiveDay {date: string; certification_status?: string; period?: {from?: string; to?: string} | null; generated_at?: string | null; json_url: string; csv_url: string}
export interface CertificationArchiveResponse {retention_days: Numeric; available_days: CertificationArchiveDay[]}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Calendar date (yyyy-mm-dd) of `date` in the business timezone. */
export function isoDate(date: Date, timeZone: string) {
  try {return new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);}
  catch {return date.toISOString().slice(0, 10);}
}
/** The vanilla default: the last 30 days including today. */
export function defaultCertificationPeriod(now: Date, timeZone: string) {
  return {from: isoDate(new Date(now.getTime() - 29 * 86400000), timeZone), to: isoDate(now, timeZone)};
}
export function periodIssue(from: string, to: string): string | null {
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return 'Usa fechas completas (año-mes-día).';
  if (from && to && from > to) return 'La fecha inicial debe ser anterior o igual a la final.';
  return null;
}
export function certificationQuery(from: string, to: string) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const query = params.toString();
  return query ? `?${query}` : '';
}
export const certificationStatusLabel = (status: string) => status === 'OK' ? {label: 'Sin observaciones', color: 'green'} : status === 'REVIEW_REQUIRED' ? {label: 'Requiere revisión', color: 'orange'} : {label: status || 'Sin estado', color: 'gray'};

// GET/POST /api/admin/analytics/ledger-corrections, POST …/:id/apply, POST …/:id/reject.
export interface LedgerCorrection {id: string; customer_id: string; status: string; reason: string; requested_by_staff_id?: string | null; resolved_by_staff_id?: string | null; source_run_id?: string | null; source_finding_id?: string | null; requested_stored_points?: Numeric; requested_expected_points?: Numeric; requested_stored_pending_points?: Numeric; requested_expected_pending_points?: Numeric; requested_stored_lifetime_points?: Numeric; requested_expected_lifetime_points?: Numeric; resolution_meta?: unknown; created_at?: string; resolved_at?: string | null}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value.trim());
export function reasonIssue(reason: string, what = 'La razón'): string | null {
  const length = reason.trim().length;
  if (length < 8) return `${what} debe tener al menos 8 caracteres.`;
  if (length > 500) return `${what} admite hasta 500 caracteres.`;
  return null;
}
export function correctionIssue(customerId: string, reason: string): string | null {
  if (!isUuid(customerId)) return 'Indica el identificador del cliente (36 caracteres, como aparece en la conciliación).';
  return reasonIssue(reason, 'La razón de la corrección');
}
export const correctionStatus = (status: string) => status === 'PENDING' ? {label: 'Pendiente', color: 'orange'} : status === 'APPLIED' ? {label: 'Aplicada', color: 'green'} : status === 'REJECTED' ? {label: 'Rechazada', color: 'gray'} : {label: status, color: 'gray'};
export const shortId = (value: string | null | undefined) => String(value ?? '').slice(0, 8);

// GET /api/admin/audit?limit&from&to&impersonated_only, GET /api/admin/audit/:id, GET /api/admin/audit.csv.
export interface AuditEvent {id: string; created_at: string; actor_type: string; actor_id?: string | null; action: string; meta?: Record<string, unknown> | null; actor_name?: string | null; actor_email?: string | null}
export interface AuditLinkedTransaction {id: string; customer_name?: string | null; customer_phone?: string | null; source?: string; status?: string; points?: Numeric; reversal_reason?: string | null}
export interface AuditLinkedRedemption {id?: string; code: string; reward_name: string; customer_name?: string | null; customer_phone?: string | null; points_cost?: Numeric}
export interface AuditLinkedGiftCard {code: string; balance_q?: Numeric; status?: string}
export interface AuditLinkedGiftCardTransaction {tx_type: string; amount_q?: Numeric; balance_after_q?: Numeric}
export interface AuditDetail {event: AuditEvent; linked?: {transaction?: AuditLinkedTransaction | null; reversal_transaction?: AuditLinkedTransaction | null; redemption?: AuditLinkedRedemption | null; gift_card?: AuditLinkedGiftCard | null; gift_card_transaction?: AuditLinkedGiftCardTransaction | null}}
export interface AuditFilters {from: string; to: string; impersonatedOnly: boolean}
export function auditQuery(filters: AuditFilters, limit: number) {
  const params = new URLSearchParams({limit: String(limit)});
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.impersonatedOnly) params.set('impersonated_only', '1');
  return `?${params.toString()}`;
}
export function auditScope(filters: AuditFilters, formatDate: (value: string) => string) {
  let range = 'eventos recientes';
  if (filters.from && filters.to) range = `del ${formatDate(filters.from)} al ${formatDate(filters.to)}`;
  else if (filters.from) range = `desde ${formatDate(filters.from)}`;
  else if (filters.to) range = `hasta ${formatDate(filters.to)}`;
  return `Vista actual: ${range} · ${filters.impersonatedOnly ? 'solo acciones en impersonación.' : 'todos los eventos visibles.'}`;
}
export const auditActor = (event: Pick<AuditEvent, 'actor_name' | 'actor_email' | 'actor_type'>) => event.actor_name || event.actor_email || event.actor_type || 'sistema';
export const impersonatedBy = (event: Pick<AuditEvent, 'meta'>) => {const value = event.meta?.impersonated_by_super_admin_email; return typeof value === 'string' && value ? value : null;};
export const inspectable = (event: Pick<AuditEvent, 'meta'>) => ['transaction_id', 'reversal_transaction_id', 'redemption_id', 'gift_card_id', 'gift_card_tx_id'].some(key => Boolean(event.meta?.[key]));
