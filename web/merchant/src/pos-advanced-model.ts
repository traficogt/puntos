// Contracts and pure helpers for the POS connection tools that lived in the vanilla dashboard's
// "Conexiones" panel (retired 2026-11-25): Loyverse credentials, CSV preview/import, Loyverse
// preview/sync and the API key. Shapes mirror src/app/services/pos-integration-service.js.

export interface PosLoyverseStatus {configured?: boolean; merchant_id?: string | null; merchant_name?: string | null; store_id?: string | null}
export interface PosSyncIssue {row?: number | null; saleId?: string; code?: string; message?: string}
export interface PosLastSync {at?: string; completed_at?: string; timestamp?: string; started_at?: string; error?: string; status?: string; message?: string; awarded?: number; duplicates?: number; ignored?: number; errors?: number; pending?: number; result?: {awarded?: number; duplicates?: number}; issues?: PosSyncIssue[]}
export interface PosIntegrationStatus {enabled: boolean; mode: string; automatic: boolean; has_api_key?: boolean; api_key_masked?: string | null; loyverse?: PosLoyverseStatus | null; last_sync?: PosLastSync | null}
export interface PosPreviewRow {row: number | null; saleId: string; customerPhone: string; amountQ: number | null; points: number; status: string; code: string; message: string}
export interface PosPreviewSummary {total: number; ready: number; errors: number; ignored: number; duplicates: number}
export interface PosPreview {ok?: boolean; headers?: string[]; rows?: PosPreviewRow[]; summary?: PosPreviewSummary; has_more?: boolean}
export interface PosApplyResult {awarded?: number; duplicates?: number; errors?: number; ignored?: number; issues?: PosSyncIssue[]; has_more?: boolean}

export type CsvColumnKey = 'saleId' | 'customerPhone' | 'amountQ' | 'status' | 'items' | 'occurredAt';
export const csvColumns: Array<{key: CsvColumnKey; label: string; required: boolean}> = [
  {key: 'saleId', label: 'ID de la venta', required: true},
  {key: 'customerPhone', label: 'Teléfono del cliente', required: true},
  {key: 'amountQ', label: 'Importe pagado', required: true},
  {key: 'status', label: 'Estado de pago', required: false},
  {key: 'items', label: 'Cantidad de artículos', required: false},
  {key: 'occurredAt', label: 'Fecha y hora', required: false},
];
export type CsvAmountUnit = 'major' | 'minor';
export interface CsvMapping {source: string; columns: Partial<Record<CsvColumnKey, string>>; amountUnit: CsvAmountUnit; assumePaid: boolean}
export const emptyCsvMapping: CsvMapping = {source: '', columns: {}, amountUnit: 'major', assumePaid: false};
/** Same bound the vanilla panel enforced: about 100 sales. */
export const CSV_MAX_BYTES = 200 * 1024;

const count = (value: unknown) => Math.max(0, Number(value) || 0);

export function csvFileIssue(size: number): string | null {
  return size > CSV_MAX_BYTES ? 'El archivo es demasiado grande. Exporta como máximo 100 ventas y 200 KB e inténtalo de nuevo.' : null;
}
/** The server needs a source plus the three required columns and a way to know the sale was paid. */
export function csvMappingReady(csv: string, mapping: CsvMapping): boolean {
  if (!csv || !mapping.source.trim()) return false;
  if (csvColumns.some(column => column.required && !mapping.columns[column.key])) return false;
  return Boolean(mapping.columns.status || mapping.assumePaid);
}
export function csvPreviewPayload(csv: string, mapping: CsvMapping) {
  const columns: Record<string, string> = {};
  for (const column of csvColumns) {
    const header = mapping.columns[column.key];
    if (header) columns[column.key] = header;
  }
  return {csv, source: mapping.source.trim(), columns, amountUnit: mapping.amountUnit, assumePaid: !mapping.columns.status && mapping.assumePaid};
}
/** PUT /api/admin/pos body that saves Loyverse credentials without touching the saved switches. */
export function loyversePayload(integration: PosIntegrationStatus, credentials: {storeId: string; token: string}) {
  const loyverse: {store_id: string; access_token?: string} = {store_id: credentials.storeId.trim()};
  const token = credentials.token.trim();
  if (token) loyverse.access_token = token;
  return {enabled: integration.enabled, mode: 'loyverse' as const, automatic: integration.automatic, loyverse};
}
export function previewSummary(summary: PosPreviewSummary | undefined): string {
  return `Ventas revisadas: ${count(summary?.total)}. Listas: ${count(summary?.ready)}; repetidas: ${count(summary?.duplicates)}; omitidas: ${count(summary?.ignored)}; con errores: ${count(summary?.errors)}. La vista previa no asigna puntos.`;
}
export function resultSummary(result: PosApplyResult | undefined): string {
  return `Ventas con puntos: ${count(result?.awarded)}; repetidas: ${count(result?.duplicates)}; omitidas: ${count(result?.ignored)}; con errores: ${count(result?.errors)}.`;
}
export function issueLine(issue: PosSyncIssue, fallback = 'Venta'): string {
  const subject = issue.saleId || (issue.row ? `Fila ${issue.row}` : fallback);
  return `${subject}: ${issue.message || issue.code || 'Requiere revisión.'}`;
}
export function lastSyncSummary(sync: PosLastSync | null | undefined, locale = 'es-GT'): {text: string; error: boolean} {
  if (!sync) return {text: 'Aún no se han sincronizado ventas.', error: false};
  const date = new Date(sync.at || sync.completed_at || sync.timestamp || sync.started_at || '');
  const when = Number.isNaN(date.getTime()) ? '' : ` · ${date.toLocaleString(locale)}`;
  const error = sync.error || (sync.status === 'error' ? sync.message : '') || '';
  if (error) return {text: `Última sincronización${when}: ${error}`, error: true};
  return {
    text: `Última sincronización${when}. Ventas con puntos: ${count(sync.awarded ?? sync.result?.awarded)}; repetidas: ${count(sync.duplicates ?? sync.result?.duplicates)}; omitidas: ${count(sync.ignored)}; con errores: ${count(sync.errors)}. Pendientes de corregir y reintentar: ${count(sync.pending)}.`,
    error: sync.status === 'error',
  };
}
export function posEndpoint(origin: string, slug: string | null | undefined): string {
  return slug ? `${origin}/api/v1/public/pos/${encodeURIComponent(slug)}/sales` : '';
}
export function saleExample(currency = 'GTQ'): string {
  return JSON.stringify({saleId: 'venta-000123', source: 'mi-pos', customerPhone: '50255551234', amountQ: 75, currency, status: 'paid', items: 2, dryRun: true}, null, 2);
}
export function keyStatus(integration: PosIntegrationStatus): string {
  return integration.has_api_key
    ? `Clave guardada${integration.api_key_masked ? `: ${integration.api_key_masked}` : ''}. Solo se muestra completa al generarla.`
    : 'Aún no hay una clave API. Genera una para conectar tu sistema.';
}
export function loyverseStatus(integration: PosIntegrationStatus): string {
  return integration.loyverse?.merchant_name ? `Cuenta conectada: ${integration.loyverse.merchant_name}.` : 'Guarda un token para verificar tu cuenta de Loyverse.';
}
export function statusLabel(status: string): string {
  return ({ready: 'Lista', duplicate: 'Repetida', ignored: 'Omitida', error: 'Error'} as Record<string, string>)[status] || status;
}
/** Preview, import and key actions need the saved connection to be on, in this mode, with no unsaved switches. */
export function connectionActive(integration: PosIntegrationStatus, mode: string, dirty: boolean): boolean {
  return Boolean(integration.enabled) && integration.mode === mode && !dirty;
}
