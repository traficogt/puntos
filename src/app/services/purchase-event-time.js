import { dateTimeSchema } from '../../utils/date-time-schema.js';
import { badRequest, conflict } from '../../utils/http-error.js';

const timestamp = dateTimeSchema({ offset: true });

// Missing timestamps remain missing: the ledger's immutable created_at is the
// authoritative receipt time. A client clock is evidence, not a verified POS clock.
export function normalizePurchaseOccurredAt(value, now = new Date()) {
  if (value == null) return null;
  if (!timestamp.safeParse(value).success) throw badRequest('La fecha de compra debe ser una fecha ISO válida con zona horaria.');
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds > now.getTime()) throw badRequest('La fecha de compra no puede ser futura.');
  return new Date(milliseconds).toISOString();
}

export function purchaseEventTime(value, source, now = new Date()) {
  const occurredAt = normalizePurchaseOccurredAt(value, now);
  if (!occurredAt) return { occurredAt: null, source: 'server_recorded' };
  if (!['pos_receipt', 'order_receipt', 'client_reported'].includes(source)) throw badRequest('Origen de fecha de compra inválido.');
  return { occurredAt, source };
}

// Legacy senders may continue omitting time. Replays never enrich or rewrite an
// existing transaction; a changed explicit timestamp on recorded evidence fails.
export function assertPurchaseTimeReplay(transaction, occurredAt) {
  if (occurredAt && transaction.purchase_occurred_at && Date.parse(transaction.purchase_occurred_at) !== Date.parse(occurredAt)) {
    throw conflict('El ID de venta ya se recibió con otra fecha de compra.');
  }
}
