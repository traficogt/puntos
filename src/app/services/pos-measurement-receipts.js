import { dbQuery } from '../database.js';
import { normalizePurchaseOccurredAt } from './purchase-event-time.js';

// Deliberately excludes phone, customer ID, amounts and original request bodies.
export function posMeasurementReceipt(input, status = 'unmatched') {
  const saleId = typeof input?.saleId === 'string' ? input.saleId.trim() : '';
  const source = typeof (input?.source ?? 'api') === 'string' ? (input.source ?? 'api').trim() : '';
  if (!saleId || saleId.length > 200 || /[\u0000-\u001f\u007f]/u.test(saleId) || !source || !/^[\p{L}\p{N} ._:-]{1,180}$/u.test(source)) return null;
  let occurredAt = null;
  try { occurredAt = normalizePurchaseOccurredAt(input.occurredAt); } catch { /* Rejected timestamp is never promoted into evidence. */ }
  return { source, saleId, occurredAt, status, transactionId: null };
}

export async function recordPosMeasurementReceipts(businessId, receipts, query = dbQuery) {
  if (!receipts.length) return;
  const unique = [...new Map(receipts.map(receipt => [JSON.stringify([receipt.source, receipt.saleId]), receipt])).values()];
  await query(`INSERT INTO pos_measurement_receipts(business_id,source,sale_id,occurred_at,status,transaction_id)
    SELECT $1::uuid,r.source,r."saleId",r."occurredAt",r.status,r."transactionId"
    FROM jsonb_to_recordset($2::jsonb) AS r(source text,"saleId" text,"occurredAt" timestamptz,status text,"transactionId" uuid)
    ON CONFLICT(business_id,source,sale_id) DO UPDATE SET last_seen_at=clock_timestamp(),
      status=CASE WHEN pos_measurement_receipts.status='matched' THEN 'matched' ELSE EXCLUDED.status END,
      transaction_id=COALESCE(pos_measurement_receipts.transaction_id,EXCLUDED.transaction_id)`, [businessId, JSON.stringify(unique)]);
}
