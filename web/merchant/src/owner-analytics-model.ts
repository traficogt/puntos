// Analytics suite (wave 15a): server contracts and the derivations the views render.
// Pure module: no React, no transport, so the unit tests run under node --test.
//
// Contracts mirror src/app/routes/analytics/dashboard.js, churn.js, cohorts.js,
// redemptions.js, src/app/routes/admin/insights.js (/admin/roi) and
// src/app/routes/admin/billing.js (iva.csv). NUMERIC and bigint columns arrive as strings.

export type Numeric = number | string | null | undefined;

export interface AnalyticsSummary {
  total_customers: Numeric;
  new_customers_30d: Numeric;
  total_points_issued: Numeric;
  avg_points_per_customer: Numeric;
  high_churn_risk_count: Numeric;
  avg_customer_spend: Numeric;
  avg_purchase_frequency: Numeric;
}
export interface RfmSegmentRow {segment: string; count: Numeric}
export interface ActivityRow {date: string; active_customers: Numeric; transactions: Numeric; revenue: Numeric}
export interface BranchPerformanceRow {
  branch_id: string;
  branch_name: string;
  branch_code: string | null;
  tx_30d: Numeric;
  revenue_30d: Numeric;
  active_customers_30d: Numeric;
  redemptions_30d: Numeric;
  avg_ticket_30d: Numeric;
}
export interface DashboardResponse {
  ok: boolean;
  summary: AnalyticsSummary;
  rfm_distribution: RfmSegmentRow[];
  recent_activity: ActivityRow[];
  branch_performance: BranchPerformanceRow[];
  branch_id: string | null;
}
export interface ChurnCustomer {
  id: string;
  name: string | null;
  phone: string;
  churn_risk_score: Numeric;
  days_since_last_purchase: Numeric;
  total_spend: Numeric;
  total_visits: Numeric;
  last_purchase_at: string | null;
}
export interface ChurnResponse {ok: boolean; customers: ChurnCustomer[]; threshold: number; branch_id: string | null; count: number}
/** One (cohort, month offset) cell as GET /api/admin/analytics/cohorts returns it. */
export interface CohortRow {
  cohort_name: string;
  cohort_date: string;
  cohort_size: Numeric;
  month_number: Numeric;
  active_customers: Numeric;
  retention_rate: Numeric;
  revenue: Numeric;
}
export interface CohortsResponse {ok: boolean; cohorts: CohortRow[]}
export interface RoiFigures {
  revenue_current_q: Numeric;
  revenue_previous_q: Numeric;
  revenue_growth_pct: Numeric;
  tx_current: Numeric;
  tx_previous: Numeric;
  tx_growth_pct: Numeric;
  customers_total: Numeric;
  customers_active: Numeric;
  repeat_rate_pct: Numeric;
  redemptions: Numeric;
  redemption_rate_pct: Numeric;
}
export interface RoiResponse {ok: boolean; days: number; roi: RoiFigures}
export interface RewardOption {id: string; name: string; points_cost: Numeric; active: boolean}
export interface RewardRedemptionRow {
  id: string;
  created_at: string;
  status: string;
  code: string;
  points_cost: Numeric;
  customer_name: string | null;
  customer_phone: string;
  linked_points_total: Numeric;
  linked_transaction_count: Numeric;
}
export interface RewardRedemptionsResponse {
  ok: boolean;
  reward: {id: string; name: string; description: string | null; points_cost: Numeric; active: boolean; stock: Numeric};
  summary: {recent_redemption_count: number; mismatch_count: number};
  recent_redemptions: RewardRedemptionRow[];
}
export interface LinkedTransaction {
  id: string;
  created_at: string;
  source: string;
  status: string;
  amount_q: Numeric;
  points: Numeric;
  original_transaction_id: string | null;
  reversed_transaction_id: string | null;
  reversal_reason: string | null;
  meta?: Record<string, unknown> | null;
}
export interface RedemptionDetail {
  id: string;
  created_at: string;
  status: string;
  code: string;
  points_cost: Numeric;
  customer_id: string;
  reward_id: string;
  staff_user_id: string | null;
  customer_name: string | null;
  customer_phone: string;
  reward_name: string;
  reward_description: string | null;
  staff_name: string | null;
}
export interface RedemptionDetailResponse {
  ok: boolean;
  redemption: RedemptionDetail;
  ledger: {expected_points_total: number; linked_points_total: number; delta_points: number; linked_transaction_count: number; consistent: boolean};
  transactions: LinkedTransaction[];
}
/** One day of gross recorded sales, before the IVA split (the server's IvaDayRow). */
export interface IvaDayRow {fecha: string; transacciones: number; monto_bruto_q: number | string}

export const num = (value: Numeric): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
/** Distinguishes "the server sent nothing" from zero, for readings that must say "sin lectura". */
export const maybe = (value: Numeric): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
export const dayOf = (value: string | Date) => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);

export interface ExecutiveMetrics {
  totalCustomers: number;
  activeCustomers: number | null;
  newCustomers: number;
  purchaseFrequency: number;
  retentionRate: number | null;
  recordedSales: number | null;
  salesGrowth: number | null;
  txGrowth: number | null;
  redemptionRate: number | null;
  riskCount: number;
}
export interface ExecutiveInput {
  summary: AnalyticsSummary | null | undefined;
  roi: RoiFigures | null | undefined;
  branchPerformance: BranchPerformanceRow[] | null | undefined;
  branchId: string | null;
  riskCount: number;
}
/**
 * Mirrors the vanilla executive summary: inside a branch the active customers and sales come from
 * that branch's 30-day row; for the whole business they come from /api/admin/roi. The "retention"
 * reading is active customers over the measured base, not a cohort measurement.
 */
export function executiveMetrics({summary, roi, branchPerformance, branchId, riskCount}: ExecutiveInput): ExecutiveMetrics {
  const branchRow = branchId && Array.isArray(branchPerformance) && branchPerformance.length ? branchPerformance[0] : null;
  const totalCustomers = num(summary?.total_customers);
  const activeCustomers = branchId ? num(branchRow?.active_customers_30d) : maybe(roi?.customers_active);
  const recordedSales = branchId ? num(branchRow?.revenue_30d) : maybe(roi?.revenue_current_q);
  let retentionRate: number | null = null;
  if (branchId) retentionRate = totalCustomers > 0 && activeCustomers !== null ? (activeCustomers / totalCustomers) * 100 : null;
  else if (maybe(roi?.repeat_rate_pct) !== null) retentionRate = maybe(roi?.repeat_rate_pct);
  else if (totalCustomers > 0 && activeCustomers !== null) retentionRate = (activeCustomers / totalCustomers) * 100;
  return {
    totalCustomers,
    activeCustomers,
    newCustomers: num(summary?.new_customers_30d),
    purchaseFrequency: num(summary?.avg_purchase_frequency),
    retentionRate,
    recordedSales,
    salesGrowth: maybe(roi?.revenue_growth_pct),
    txGrowth: maybe(roi?.tx_growth_pct),
    redemptionRate: maybe(roi?.redemption_rate_pct),
    riskCount,
  };
}

export interface Formatters {count: (value: number | null) => string; percent: (value: number | null) => string; signedPercent: (value: number | null) => string}
export function formatters(locale = 'es-GT'): Formatters {
  const whole = new Intl.NumberFormat(locale, {maximumFractionDigits: 0});
  const one = new Intl.NumberFormat(locale, {minimumFractionDigits: 1, maximumFractionDigits: 1});
  return {
    count: value => (value === null ? '—' : whole.format(value)),
    percent: value => (value === null ? '—' : `${one.format(value)}%`),
    signedPercent: value => (value === null ? '—' : `${value > 0 ? '+' : ''}${one.format(value)}%`),
  };
}

/** One factual sentence; every reading names its source window and says "sin lectura" when absent. */
export function executiveNarrative(scopeLabel: string, metrics: ExecutiveMetrics, branchId: string | null, format = formatters()): string {
  const base = metrics.retentionRate === null ? 'sin lectura de la base medida' : `${format.percent(metrics.retentionRate)} de la base medida`;
  const sales =
    metrics.salesGrowth === null
      ? 'sin ventas comparables en los 30 días previos'
      : `ventas registradas ${format.signedPercent(metrics.salesGrowth)} frente a los 30 días previos${branchId ? ' (referencia global)' : ''}`;
  return `${scopeLabel || 'Todo el negocio'} tiene ${format.count(metrics.activeCustomers)} clientes activos en 30 días (${base}), sumó ${format.count(metrics.newCustomers)} nuevos y ${sales}; hoy hay ${format.count(metrics.riskCount)} clientes en riesgo alto.`;
}

/** Up to three suggestions derived from the readings. They are prompts, not measured effects. */
export function suggestedActions(metrics: ExecutiveMetrics, branchId: string | null, format = formatters()): string[] {
  const actions: string[] = [];
  if (metrics.riskCount > 0) actions.push(`Prepara un recordatorio de regreso para los ${format.count(metrics.riskCount)} clientes con mayor riesgo antes del próximo corte.`);
  if (metrics.retentionRate !== null && metrics.retentionRate < 45) actions.push('Refuerza la segunda compra con una recompensa simple y un recordatorio al equipo en caja.');
  else if (metrics.salesGrowth !== null && metrics.salesGrowth < 0) actions.push(`Revisa incentivos y ticket promedio${branchId ? ' como referencia global' : ''}; las ventas registradas vienen por debajo del período previo.`);
  else actions.push('Mantén la operación actual y revisa recurrencia y riesgo en el siguiente refresco.');
  return actions.slice(0, 3);
}

export const rfmSegmentOrder = ['Champions', 'Loyal', 'At Risk', 'Lost'] as const;
export type RfmSegmentKey = (typeof rfmSegmentOrder)[number];
export const rfmSegmentLabels: Record<RfmSegmentKey, {label: string; range: string}> = {
  Champions: {label: 'Campeones', range: 'puntaje 12 a 15'},
  Loyal: {label: 'Leales', range: 'puntaje 9 a 11'},
  'At Risk': {label: 'En riesgo', range: 'puntaje 6 a 8'},
  Lost: {label: 'Perdidos', range: 'puntaje 3 a 5'},
};
export interface RfmSegment {key: string; label: string; range: string; count: number; sharePct: number}
/** The four segments in a fixed order, with zero rows for segments the server omitted. */
export function rfmSegments(rows: RfmSegmentRow[] | null | undefined): RfmSegment[] {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) counts.set(String(row.segment), (counts.get(String(row.segment)) ?? 0) + num(row.count));
  const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
  const known = rfmSegmentOrder.map(key => ({key, label: rfmSegmentLabels[key].label, range: rfmSegmentLabels[key].range, count: counts.get(key) ?? 0}));
  const extra = Array.from(counts.entries()).filter(([key]) => !(rfmSegmentOrder as readonly string[]).includes(key)).map(([key, count]) => ({key, label: key, range: '', count}));
  return [...known, ...extra].map(segment => ({...segment, sharePct: total > 0 ? Math.round((segment.count / total) * 1000) / 10 : 0}));
}
export const rfmTotal = (segments: RfmSegment[]) => segments.reduce((sum, segment) => sum + segment.count, 0);

export interface TrendRow {date: string; revenue: number; transactions: number; active_customers: number}
/** Oldest first, one row per day, as the chart and its table read it. */
export function trendRows(rows: ActivityRow[] | null | undefined): TrendRow[] {
  return (rows ?? [])
    .map(row => ({date: dayOf(row.date), revenue: num(row.revenue), transactions: num(row.transactions), active_customers: num(row.active_customers)}))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface BenchmarkRow {date: string; branch: number; global: number; sharePct: number}
/** Branch sales next to the whole business for the latest `limit` days with activity on either side. */
export function benchmarkRows(branchRows: ActivityRow[] | null | undefined, globalRows: ActivityRow[] | null | undefined, limit = 10): BenchmarkRow[] {
  if (!branchRows?.length || !globalRows?.length) return [];
  const byDay = (rows: ActivityRow[]) => new Map(rows.map(row => [dayOf(row.date), num(row.revenue)] as const));
  const branch = byDay(branchRows), global = byDay(globalRows);
  return Array.from(new Set([...branch.keys(), ...global.keys()]))
    .sort()
    .slice(-limit)
    .map(date => {
      const branchRevenue = branch.get(date) ?? 0, globalRevenue = global.get(date) ?? 0;
      return {date, branch: branchRevenue, global: globalRevenue, sharePct: globalRevenue > 0 ? Math.round((branchRevenue / globalRevenue) * 100) : 0};
    });
}

export interface CohortCell {month: number; rate: number; active: number; pending: boolean}
export interface CohortLine {name: string; size: number; cells: CohortCell[]}
export interface CohortMatrix {months: number[]; cohorts: CohortLine[]}
const MONTH = /^(\d{4})-(\d{2})$/;
function cohortMonthStart(row: CohortRow): number | null {
  const named = MONTH.exec(String(row.cohort_name || ''));
  if (named) return Date.UTC(Number(named[1]), Number(named[2]) - 1, 1);
  const parsed = new Date(row.cohort_date);
  return Number.isFinite(parsed.getTime()) ? Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1) : null;
}
/**
 * Pivots the (cohort, month) rows into one line per cohort, newest first, keeping month offsets
 * 0..maxMonth. A month that has not started yet is `pending`: the server reports it as 0 % because
 * nobody can have returned yet, which is not the same as nobody returning.
 */
export function cohortMatrix(rows: CohortRow[] | null | undefined, {maxMonth = 6, now = new Date()}: {maxMonth?: number; now?: Date} = {}): CohortMatrix {
  const lines = new Map<string, {name: string; size: number; start: number | null; order: number; cells: Map<number, CohortCell>}>();
  for (const row of rows ?? []) {
    const month = num(row.month_number);
    if (!Number.isInteger(month) || month < 0 || month > maxMonth) continue;
    const name = String(row.cohort_name || dayOf(row.cohort_date).slice(0, 7));
    const start = cohortMonthStart(row);
    const line = lines.get(name) ?? {name, size: num(row.cohort_size), start, order: start ?? -lines.size, cells: new Map<number, CohortCell>()};
    const monthStart = start === null ? null : new Date(start);
    const pending = monthStart !== null && Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + month, 1) > now.getTime();
    line.cells.set(month, {month, rate: num(row.retention_rate), active: num(row.active_customers), pending});
    lines.set(name, line);
  }
  const months = Array.from(new Set(Array.from(lines.values()).flatMap(line => Array.from(line.cells.keys())))).sort((a, b) => a - b);
  const cohorts = Array.from(lines.values())
    .sort((a, b) => b.order - a.order || b.name.localeCompare(a.name))
    .map(line => ({name: line.name, size: line.size, cells: months.map(month => line.cells.get(month) ?? {month, rate: 0, active: 0, pending: true})}));
  return {months, cohorts};
}

/** The server's own consistency rule: exactly one linked movement equal to minus the reward's cost. */
export const redemptionConsistent = (row: Pick<RewardRedemptionRow, 'points_cost' | 'linked_points_total' | 'linked_transaction_count'>) =>
  num(row.linked_points_total) === -num(row.points_cost) && num(row.linked_transaction_count) === 1;

export const redemptionStatusLabel = (status: string | null | undefined) => {
  switch (String(status || '').toUpperCase()) {
    case 'REDEEMED': return 'Entregado';
    case 'PENDING': return 'Pendiente';
    case 'CANCELLED': return 'Cancelado';
    case 'REVERSED': return 'Reversado';
    default: return status || '—';
  }
};
export const transactionSourceLabel = (source: string | null | undefined) => {
  switch (String(source || '')) {
    case 'redeem': return 'Canje';
    case 'refund': return 'Reversa';
    case 'pos': return 'Caja';
    case 'manual': return 'Manual';
    case 'api': return 'API';
    default: return source || '—';
  }
};

// ---- IVA export ------------------------------------------------------------------------------
// Prices include the 12 % IVA: the taxable base is bruto / 1.12 rounded once to the centavo (half
// up) and the tax is the remainder, so the three columns of every row add up exactly. This is the
// rule in src/app/routes/admin/billing.js; the demo reproduces it client-side.
export const IVA_COLUMNS = ['fecha', 'transacciones', 'monto_bruto_q', 'base_sin_iva_q', 'iva_12_q'] as const;
export const IVA_FILENAME = 'reporte_iva_gt.csv';
const toMinor = (value: number | string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new RangeError('monto inválido');
  return Math.sign(parsed) * Math.round(Math.abs(parsed) * 100);
};
const fromMinor = (minor: number) => {
  const digits = String(Math.abs(minor)).padStart(3, '0');
  return `${minor < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
};
export interface IvaCsvRow {fecha: string; transacciones: number; monto_bruto_q: string; base_sin_iva_q: string; iva_12_q: string}
export function ivaCsvRows(days: IvaDayRow[]): IvaCsvRow[] {
  return days.map(day => {
    const gross = toMinor(day.monto_bruto_q);
    const net = Math.sign(gross) * Math.floor((Math.abs(gross) * 100 + 56) / 112);
    return {fecha: dayOf(day.fecha), transacciones: Number(day.transacciones) || 0, monto_bruto_q: fromMinor(gross), base_sin_iva_q: fromMinor(net), iva_12_q: fromMinor(gross - net)};
  });
}
const csvCell = (value: string | number) => {
  const text = String(value);
  const safe = /^[\s\u0000]*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};
export function ivaCsv(days: IvaDayRow[]): string {
  const lines = [IVA_COLUMNS.join(',')];
  for (const row of ivaCsvRows(days)) lines.push(IVA_COLUMNS.map(column => csvCell(row[column])).join(','));
  return `${lines.join('\n')}\n`;
}
/** A real calendar day written YYYY-MM-DD (the server accepts that or an ISO date-time). */
export const isIsoDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
export function ivaExportPath(from: string, to: string): string {
  const params = new URLSearchParams();
  if (isIsoDay(from)) params.set('from', from);
  if (isIsoDay(to)) params.set('to', to);
  const query = params.toString();
  return `/api/admin/billing/iva.csv${query ? `?${query}` : ''}`;
}
export function ivaRangeIssue(from: string, to: string): string | null {
  if (from && !isIsoDay(from)) return 'La fecha inicial no es válida.';
  if (to && !isIsoDay(to)) return 'La fecha final no es válida.';
  if (from && to && from > to) return 'La fecha inicial debe ser anterior o igual a la final.';
  return null;
}
/** Reads the download name the server sets (Content-Disposition), falling back to the known name. */
export function attachmentFilename(header: string | null | undefined, fallback = IVA_FILENAME): string {
  if (!header) return fallback;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {return decodeURIComponent(encoded[1].trim()) || fallback;} catch {return fallback;}
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  const name = plain?.[1]?.trim();
  return name && !/[/\\]/.test(name) ? name : fallback;
}
/** YYYY-MM-DD of `date` in the business time zone (en-CA formats dates that way). */
export function isoDateInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
/** Default export range: the current month so far, the period IVA is declared for. */
export function currentMonthRange(now: Date, timeZone: string): {from: string; to: string} {
  const today = isoDateInZone(now, timeZone);
  return {from: `${today.slice(0, 7)}-01`, to: today};
}
