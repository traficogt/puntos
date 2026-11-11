import {REGIONAL_CURRENCY_CODES} from '../../../public/regional-catalog.js';
import {assertRegionAmount} from './regional-settings.js';
import crypto from "node:crypto";
import { z } from "zod";
import { isLedgerAmount } from "../../utils/ledger-limits.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/http-error.js";
import { dbQuery, withTransaction } from "../database.js";
import { posEventId } from "./pos/common.js";
import { refundAwardTransactionWithClient } from "./loyalty-ops-service.js";

const receiptId = z.string().trim().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f]/u.test(value));
const RefundSchema = z.object({
  refundId: receiptId,
  originalSaleId: receiptId,
  source: z.string().trim().min(1).max(180).regex(/^[\p{L}\p{N} ._:-]+$/u),
  amountQ: z.number().refine(isLedgerAmount),
  currency: z.string().refine(value=>REGIONAL_CURRENCY_CODES.includes(value),'Moneda no admitida'),
  scope: z.enum(["full", "partial", "unknown"]).default("unknown")
}).strict().refine(value => value.refundId !== value.originalSaleId);

export function normalizePosRefund(input, business = {}) {
  const parsed = RefundSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Indica ID de devolución, ID de venta original, mismo origen, importe con hasta dos decimales y la moneda del negocio. No envíes datos del cliente.");
  assertRegionAmount(parsed.data.amountQ,parsed.data.currency,business);
  return parsed.data;
}

export function posRefundFingerprint(input, business = {}) {
  const value = normalizePosRefund(input,business);
  return crypto.createHash("sha256").update(JSON.stringify([value.source, value.refundId, value.originalSaleId, value.amountQ, value.currency, value.scope])).digest("hex");
}

const messages = {
  awaiting_reconciliation: "Recibo guardado. Falta comprobar la venta original y sus puntos.",
  full_refund: "Devolución completa conciliada con una reversión comprobada en el historial de puntos.",
  already_reversed: "La venta ya tenía una reversión comprobada. No se descontaron puntos otra vez.",
  original_not_found: "No se encontró la venta en PF con este ID y origen. Importa o corrige la venta original en la caja y reintenta.",
  ambiguous_original: "La evidencia de la venta no coincide con su registro de puntos. Revisa ambos recibos y el historial antes de ajustar.",
  partial_refund: "Devolución parcial: requiere revisión del recibo y del historial de puntos. PF no calcula puntos proporcionales ni debe anularse toda la venta para resolver este caso. Reintentar no cambia el importe recibido.",
  scope_unverified: "No se pudo acreditar que se devolvieron todos los artículos e importes. Revisa el recibo original y la declaración de devolución completa con tu proveedor. PF no ha ajustado puntos.",
  amount_mismatch: "El importe devuelto no acredita una devolución completa de esta venta. Revisa los importes en la caja; PF no ha ajustado puntos.",
  customer_unavailable: "El cliente original ya no está disponible. Revisa el historial; no se asociará la devolución a otro teléfono.",
  insufficient_balance: "El saldo no alcanza para revertir la compra y sus beneficios con la política actual. Revisa el historial y los canjes antes de reintentar.",
  original_unavailable: "El estado de la venta no permite una reversión automática comprobable. Revisa su historial.",
  retryable_error: "No se completó el ajuste. El recibo sigue guardado; vuelve a intentar. Si persiste, solicita revisión del historial."
};

function publicReceipt(row) {
  if (!row) return null;
  const { fingerprint: _fingerprint, native_evidence_hash: _nativeEvidence, business_id: _businessId, ...result } = row;
  return { ...result, amount_q: Number(row.amount_q), message: messages[row.reason] ?? messages.retryable_error };
}

// Commit acceptance independently so failures cannot discard an upstream refund.
export async function enqueuePosRefund(businessId, input, { origin = "api", nativeEvidence = null } = {}) {
  return withTransaction(async client => {
  const business=(await client.query("SELECT program_json FROM businesses WHERE id=$1 FOR SHARE",[businessId])).rows[0];
  if(!business)throw notFound("Negocio no encontrado.");
  const data = normalizePosRefund(input,business);
  if (!["api", "loyverse"].includes(origin)) throw badRequest("Origen de devolución inválido.");
  if (origin === "api" && data.source.startsWith("loyverse:")) throw badRequest("El origen Loyverse se recibe desde la conexión verificada de Loyverse.");
  if (origin === "loyverse" && (typeof nativeEvidence !== "string" || !/^[a-f0-9]{64}$/.test(nativeEvidence))) throw badRequest("La devolución nativa requiere evidencia de sus artículos.");
  // API scope is an immutable adapter assertion. Native scope is derived from
  // a separately read original; its evidence may improve without changing the
  // immutable refund ID, reference, amount or returned item quantities.
  const fingerprint = origin === "api" ? posRefundFingerprint(data,business) : crypto.createHash("sha256").update(JSON.stringify([posRefundFingerprint({ ...data, scope: "unknown" },business), nativeEvidence])).digest("hex");
    const inserted = await client.query(`INSERT INTO pos_refund_receipts(id,business_id,source,refund_id,original_sale_id,amount_q,currency,origin,fingerprint,scope,native_evidence_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(business_id,source,refund_id) DO NOTHING RETURNING *`,
    [crypto.randomUUID(), businessId, data.source, data.refundId, data.originalSaleId, data.amountQ, data.currency, origin, fingerprint, data.scope, origin === "loyverse" ? nativeEvidence : null]);
    let row = inserted.rows[0] ?? (await client.query("SELECT * FROM pos_refund_receipts WHERE business_id=$1 AND source=$2 AND refund_id=$3 FOR UPDATE", [businessId, data.source, data.refundId])).rows[0];
    if (!row || row.fingerprint !== fingerprint || row.origin !== origin) throw conflict("Este ID de devolución ya se recibió con otros datos. Conserva el recibo original y revisa el envío de la caja.");
    if (origin === "loyverse" && row.status === "pending" && row.scope !== data.scope) {
      row = (await client.query("UPDATE pos_refund_receipts SET scope=$3,reason='awaiting_reconciliation',updated_at=now() WHERE business_id=$1 AND id=$2 RETURNING *", [businessId, row.id, data.scope])).rows[0];
    }
    return { ok: true, refund: publicReceipt(row), replay: !inserted.rows.length };
  });
}

export async function reconcilePosRefund(businessId, refundId, { staff = null, automatic = false } = {}) {
  if (!z.guid().safeParse(refundId).success) throw badRequest("Identificador de conciliación inválido.");
  return withTransaction(async client => {
    const queued = await client.query("SELECT * FROM pos_refund_receipts WHERE business_id=$1 AND id=$2 FOR UPDATE", [businessId, refundId]);
    const receipt = queued.rows[0];
    if (!receipt) throw notFound("Devolución no encontrada.");
    if (receipt.status === "reconciled") return { ok: true, refund: publicReceipt(receipt), replay: true };
    if (automatic && ["partial_refund", "scope_unverified", "amount_mismatch", "ambiguous_original", "customer_unavailable", "original_unavailable"].includes(receipt.reason)) return { ok: true, refund: publicReceipt(receipt), replay: true };
    // Queue row -> refund request advisory lock -> original ledger row -> balance.
    // Keep the same request/ledger/balance order as existing manual full refunds.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [String(businessId), String(receipt.id)]);
    // No customer/balance lock is acquired ahead of the original transaction.
    const original = await client.query(`SELECT * FROM transactions WHERE business_id=$1 AND source='external'
      AND meta->>'external_event_id'=$2 FOR UPDATE`, [businessId, posEventId({ source: receipt.source, saleId: receipt.original_sale_id })]);
    const tx = original.rows[0];
    let reason = null, reversalId = null;
    if (!tx) reason = "original_not_found";
    else if (original.rows.length !== 1 || tx.meta?.pos_sale?.source !== receipt.source || tx.meta?.pos_sale?.saleId !== receipt.original_sale_id || Number(tx.meta?.pos_sale?.amountQ) !== Number(tx.amount_q) || (tx.meta?.pos_sale?.currency || "GTQ") !== receipt.currency || tx.type !== "PURCHASE" || tx.original_transaction_id) reason = "ambiguous_original";
    else if (Number(receipt.amount_q) <= 0 || Number(receipt.amount_q) > Number(tx.amount_q)) reason = "amount_mismatch";
    else if (Number(receipt.amount_q) < Number(tx.amount_q) || receipt.scope === "partial") reason = "partial_refund";
    else if (receipt.scope !== "full") reason = "scope_unverified";
    else if (tx.status === "REVERSED") {
      const reversed = await client.query(`SELECT id FROM transactions WHERE business_id=$1 AND id=$2 AND original_transaction_id=$3 AND customer_id=$4 AND source='reversal' AND status='POSTED'`, [businessId, tx.reversed_transaction_id, tx.id, tx.customer_id]);
      if (reversed.rows.length === 1) { reason = "already_reversed"; reversalId = reversed.rows[0].id; }
      else reason = "original_unavailable";
    } else if (!["POSTED", "PENDING"].includes(tx.status) || tx.reversed_transaction_id || tx.expired_at) reason = "original_unavailable";
    else {
      const customer = await client.query("SELECT id FROM customers WHERE business_id=$1 AND id=$2 AND deleted_at IS NULL", [businessId, tx.customer_id]);
      if (!customer.rows.length) reason = "customer_unavailable";
      else {
        await client.query("SAVEPOINT pos_refund_ledger");
        try {
          const result = await refundAwardTransactionWithClient(client, {
            staff: staff ? { ...staff, business_id: businessId } : { id: null, business_id: businessId },
            transactionId: tx.id, requestId: receipt.id,
            reason: `POS ${receipt.source}: ${receipt.refund_id}`
          });
          reversalId = result.reversalTransactionId;
          reason = "full_refund";
          await client.query("RELEASE SAVEPOINT pos_refund_ledger");
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT pos_refund_ledger");
          await client.query("RELEASE SAVEPOINT pos_refund_ledger");
          reason = error.statusCode === 409 && /negative balance/i.test(error.message) ? "insufficient_balance" : "retryable_error";
        }
      }
    }
    const updated = await client.query(`UPDATE pos_refund_receipts SET status=$3,reason=$4,original_transaction_id=$5,
      reversal_transaction_id=$6,attempts=attempts+1,last_attempt_at=now(),updated_at=now(),reconciled_at=CASE WHEN $6::uuid IS NULL THEN NULL ELSE now() END
      WHERE business_id=$1 AND id=$2 RETURNING *`, [businessId, refundId, reversalId ? "reconciled" : "pending", reason, tx?.id ?? null, reversalId]);
    return { ok: true, refund: publicReceipt(updated.rows[0]), replay: false };
  });
}

export async function ingestPosRefund(business, input) {
  if (business.program_json?.pos_integration?.enabled !== true || business.program_json?.external_awards?.enabled !== true || business.program_json?.pos_integration?.mode !== "api") throw forbidden("Activa la conexión API antes de recibir devoluciones.");
  const queued = await enqueuePosRefund(business.id, input);
  return { ...await reconcilePosRefund(business.id, queued.refund.id, { automatic: true }), replay: queued.replay };
}

export async function retryPendingPosRefunds(businessId) {
  const candidates = await dbQuery(`SELECT id FROM pos_refund_receipts WHERE business_id=$1 AND status='pending'
    AND reason IN('awaiting_reconciliation','original_not_found','retryable_error') AND attempts<10
    AND (last_attempt_at IS NULL OR last_attempt_at<now()-interval '1 minute')
    ORDER BY last_attempt_at ASC NULLS FIRST,created_at ASC LIMIT 25`, [businessId]);
  const outcomes = [];
  for (const receipt of candidates.rows) outcomes.push(await reconcilePosRefund(businessId, receipt.id));
  return outcomes;
}

export async function reconcilePendingRefundsForSale(businessId, sale) {
  const candidates = await dbQuery(`SELECT id FROM pos_refund_receipts WHERE business_id=$1 AND source=$2 AND original_sale_id=$3
    AND status='pending' AND reason IN('awaiting_reconciliation','original_not_found','retryable_error') ORDER BY created_at ASC LIMIT 25`, [businessId, sale.source, sale.saleId]);
  const outcomes = [];
  for (const receipt of candidates.rows) outcomes.push(await reconcilePosRefund(businessId, receipt.id));
  return outcomes;
}

export async function listPosRefunds(businessId, input = {}) {
  const parsed = z.object({ status: z.enum(["pending", "reconciled"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().safeParse(input);
  if (!parsed.success) throw badRequest("Filtro de devoluciones inválido.");
  const result = await dbQuery(`SELECT * FROM pos_refund_receipts WHERE business_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC,id DESC LIMIT $3`, [businessId, parsed.data.status ?? null, parsed.data.limit]);
  const summary = await dbQuery(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='pending')::int AS pending,
    count(*) FILTER(WHERE status='reconciled')::int AS reconciled,count(*) FILTER(WHERE status='pending' AND reason='partial_refund')::int AS partial
    FROM pos_refund_receipts WHERE business_id=$1`, [businessId]);
  return { ok: true, refunds: result.rows.map(publicReceipt), summary: summary.rows[0], limit: parsed.data.limit };
}
