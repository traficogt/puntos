import { normalizePhone } from "../../../utils/phone.js";
import { isLedgerAmount } from "../../../utils/ledger-limits.js";
import crypto from "node:crypto";

// Official contract: https://developer.loyverse.com/docs/API-Reference__v1.0.yaml
const API_BASE = "https://api.loyverse.com/v1.0";
const PAGE_LIMIT = 100;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const RECEIPT_NOT_FOUND = Symbol("receipt_not_found");

function validId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function validateCredentials(accessToken, storeId) {
  if (typeof accessToken !== "string" || !accessToken.trim() || accessToken.length > 4096 || /\s/.test(accessToken)) {
    throw new Error("El token de acceso de Loyverse no es válido. Revísalo y vuelve a conectar.");
  }
  if (storeId != null && storeId !== "" && !validId(storeId)) {
    throw new Error("El identificador de tienda de Loyverse no es válido.");
  }
}

/** @param {{ accessToken: string, fetchImpl: Function }} auth */
async function requestJson(auth, path, params = {}, allowNotFound = false) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await auth.fetchImpl(url.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${auth.accessToken}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new Error("No se pudo consultar Loyverse. Reintenta la sincronización cuando haya conexión.");
  }
  if (!response?.ok) {
    await response?.body?.cancel().catch(() => {});
    if (allowNotFound && response?.status === 404) return RECEIPT_NOT_FOUND;
    if (response?.status === 401 || response?.status === 403) {
      throw new Error("Loyverse rechazó el acceso. Revisa el token y los permisos de lectura de comercio, tiendas, recibos y clientes.");
    }
    if (response?.status === 429) {
      throw new Error("Loyverse alcanzó su límite de consultas. Espera y vuelve a sincronizar.");
    }
    throw new Error("Loyverse no pudo completar la consulta. Reintenta la sincronización.");
  }
  try {
    if (Number(response.headers?.get("content-length")) > MAX_RESPONSE_BYTES) throw new Error("oversized");
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          throw new Error("oversized");
        }
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
    } finally {
      reader.releaseLock();
    }
  } catch {
    await response?.body?.cancel().catch(() => {});
    throw new Error("Loyverse devolvió una respuesta inválida o que supera el límite de tamaño. Reintenta la sincronización.");
  }
}

/**
 * Validate the account before storing a token or trusting its currency.
 * @param {{ accessToken: string, storeId?: string|null, fetchImpl?: Function, region?: any }} args
 */
export async function verifyLoyverseConnection({ accessToken, storeId = null, fetchImpl = globalThis.fetch, region = {currency:"GTQ",minorUnits:2,country:"GT"} }) {
  validateCredentials(accessToken, storeId);
  const auth = { accessToken, fetchImpl, region };
  const profile = await requestJson(auth, "/merchant/");
  if (!validId(profile?.id)) throw new Error("Loyverse no devolvió un identificador válido de comercio.");
  if (profile.currency?.code !== region.currency || profile.currency?.decimal_places !== region.minorUnits) {
    throw new Error(`La moneda del comercio de Loyverse debe ser ${region.currency} con ${region.minorUnits} decimales.`);
  }
  if (storeId) {
    const store = await requestJson(auth, `/stores/${encodeURIComponent(storeId)}`);
    if (store?.id !== storeId || store.deleted_at) {
      throw new Error("La tienda no está disponible en este comercio de Loyverse. Revisa su identificador.");
    }
  }
  return {
    merchantId: profile.id,
    merchantName: typeof profile.business_name === "string" ? profile.business_name.slice(0, 200) : "Loyverse",
    currency: region.currency,
    storeId: storeId || null
  };
}

function timestamp(value) {
  if (!(value instanceof Date) && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value))) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function validMoney(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 100;
}

function receiptIssue(receipt, code, message) {
  return { saleId: validId(receipt?.receipt_number) ? receipt.receipt_number : "", code, message };
}

function inspectReceipt(receipt, storeId) {
  const issue = (code, message) => receiptIssue(receipt, code, message);
  if (!receipt || typeof receipt !== "object" || !validId(receipt.receipt_number)) {
    return issue("invalid_receipt", "El recibo no tiene un número válido. Revísalo en Loyverse.");
  }
  if (receipt.receipt_type === "REFUND" || receipt.refund_for) {
    return issue("refund", "Las devoluciones no generan puntos. Revisa cualquier ajuste pendiente en Puntos.");
  }
  if (receipt.cancelled_at) return issue("cancelled", "El recibo está anulado y no genera puntos.");
  if (receipt.receipt_type !== "SALE") {
    return issue("unsupported_receipt", "El recibo no es una venta reconocida de Loyverse. Revisa su tipo.");
  }
  if (!validId(receipt.store_id) || (storeId && receipt.store_id !== storeId)) {
    return issue("store_mismatch", "El recibo no corresponde a la tienda seleccionada o no indica una tienda válida.");
  }
  if (!validMoney(receipt.total_money)) {
    return issue("invalid_amount", "El total del recibo debe ser un número válido y no negativo en la moneda del comercio.");
  }
  // The API defines total_money as paid money. Reconcile explicit payments as
  // an additional guard against incomplete or undocumented receipt shapes.
  const payments = receipt.payments;
  if (!Array.isArray(payments) || !payments.length || payments.some((payment) => !validId(payment?.payment_type_id) || !validMoney(payment?.money_amount))) {
    return issue("unverified_payment", "No se pudo confirmar el pago completo del recibo. Revisa sus pagos en Loyverse.");
  }
  const paid = payments.reduce((sum, payment) => sum + payment.money_amount, 0);
  if (!Number.isFinite(paid) || Math.abs(paid - receipt.total_money) > 0.000001) {
    return issue("unverified_payment", "Los pagos no coinciden con el total del recibo. Revisa sus pagos en Loyverse.");
  }
  if (!timestamp(receipt.receipt_date ?? receipt.created_at)) {
    return issue("invalid_date", "El recibo no indica una fecha válida de venta. Revísala en Loyverse.");
  }
  if (!validId(receipt.customer_id)) {
    return issue("missing_customer", "Asocia un cliente con teléfono al recibo en Loyverse para identificarlo en Puntos.");
  }
  if (!Array.isArray(receipt.line_items) || !receipt.line_items.length || receipt.line_items.some((line) => typeof line?.quantity !== "number" || !Number.isFinite(line.quantity) || line.quantity <= 0)) {
    return issue("invalid_items", "El recibo contiene cantidades de artículos inválidas. Revísalas en Loyverse.");
  }
  return null;
}

function normalizeReceipt(receipt, merchantId, customer, region) {
  if (!customer || customer.deleted_at) {
    return { issue: receiptIssue(receipt, "customer_not_found", "El cliente no está disponible en Loyverse. Revisa el cliente asociado al recibo.") };
  }
  if (typeof customer.phone_number !== "string" || !customer.phone_number.trim()) {
    return { issue: receiptIssue(receipt, "missing_phone", "Agrega un teléfono al cliente en Loyverse que coincida con su registro en Puntos.") };
  }
  const phone = normalizePhone(customer.phone_number,region.country);
  if (!/^[+\d\s().-]+$/.test(customer.phone_number) || !/^\d{8,15}$/.test(phone)) {
    return { issue: receiptIssue(receipt, "invalid_phone", "El teléfono del cliente no es válido. Corrígelo en Loyverse antes de volver a importar.") };
  }
  const quantity = receipt.line_items.reduce((sum, line) => sum + line.quantity, 0);
  // Weight-based sales are valid, but fractional units cannot earn item rewards.
  const items = receipt.line_items.every((line) => Number.isSafeInteger(line.quantity)) && Number.isSafeInteger(quantity) ? quantity : 0;
  return {
    sale: {
      saleId: receipt.receipt_number,
      source: `loyverse:${merchantId}:${receipt.store_id}`,
      customerPhone: phone,
      amountQ: receipt.total_money,
      currency: region.currency,
      visits: 1,
      items,
      occurredAt: timestamp(receipt.receipt_date ?? receipt.created_at)
    }
  };
}

// Official Receipt schema: receipt_type=REFUND, refund_for points to the original
// sale, and total_money/payments are positive returned amounts. No phone lookup.
// https://developer.loyverse.com/docs/#tag/Receipts
function normalizeRefundReceipt(receipt, merchantId, storeId, region) {
  const issue = message => ({ issue: receiptIssue(receipt, "invalid_refund", message) });
  if (!validId(receipt.receipt_number) || !validId(receipt.refund_for) || receipt.refund_for === receipt.receipt_number) return issue("La devolución no identifica un recibo original válido. Revisa refund_for en Loyverse.");
  if (receipt.cancelled_at) return issue("La devolución está anulada en Loyverse. Revisa ambos recibos y cualquier reversión previa en PF.");
  if (!validId(receipt.store_id) || (storeId && receipt.store_id !== storeId)) return issue("La devolución no corresponde a la tienda seleccionada.");
  if (!isLedgerAmount(receipt.total_money)) return issue("El importe devuelto debe usar la moneda del comercio con la precisión configurada.");
  if (!Array.isArray(receipt.payments) || !receipt.payments.length || receipt.payments.some(payment => !validId(payment?.payment_type_id) || !isLedgerAmount(payment?.money_amount))) return issue("No se pudieron verificar los pagos de la devolución en Loyverse.");
  if (Math.abs(receipt.payments.reduce((sum, payment) => sum + payment.money_amount, 0) - receipt.total_money) > 0.000001) return issue("Los pagos no coinciden con el importe devuelto en Loyverse.");
  if (!timestamp(receipt.receipt_date ?? receipt.created_at)) return issue("La devolución no tiene una fecha válida en Loyverse.");
  const lines = Array.isArray(receipt.line_items) ? receipt.line_items.map(line => [line?.item_id ?? null, line?.variant_id ?? null, line?.quantity ?? null]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : null;
  const nativeEvidence = crypto.createHash("sha256").update(JSON.stringify(lines)).digest("hex");
  return { refund: { refundId: receipt.receipt_number, originalSaleId: receipt.refund_for, source: `loyverse:${merchantId}:${receipt.store_id}`, amountQ: receipt.total_money, currency: region.currency, scope: "unknown", nativeEvidence } };
}

function receiptQuantities(receipt) {
  if (!Array.isArray(receipt?.line_items) || !receipt.line_items.length) return null;
  const quantities = new Map();
  for (const line of receipt.line_items) {
    if (!validId(line?.item_id) || !validId(line?.variant_id) || typeof line.quantity !== "number" || !Number.isFinite(line.quantity) || line.quantity <= 0) return null;
    // Exact fixed precision comparison; unsupported precision remains unverified.
    const units = line.quantity * 1000000;
    if (!Number.isSafeInteger(units)) return null;
    const key = JSON.stringify([line.item_id, line.variant_id]);
    const total = (quantities.get(key) ?? 0) + units;
    if (!Number.isSafeInteger(total)) return null;
    quantities.set(key, total);
  }
  return quantities;
}

function refundScope(receipt, original) {
  if (original?.receipt_number !== receipt.refund_for || original.receipt_type !== "SALE" || original.refund_for || original.cancelled_at || original.store_id !== receipt.store_id || !isLedgerAmount(original.total_money) || original.total_money <= 0) return "unknown";
  const sold = receiptQuantities(original), returned = receiptQuantities(receipt);
  if (!sold || !returned) return "unknown";
  for (const [key, units] of returned) if (!sold.has(key) || units > sold.get(key)) return "unknown";
  if (receipt.total_money > original.total_money) return "unknown";
  return sold.size === returned.size && [...sold].every(([key, units]) => returned.get(key) === units) && receipt.total_money === original.total_money ? "full" : "partial";
}

/**
 * Read exactly one bounded receipt page. API failures throw before callers can
 * advance the cursor; permanently ineligible receipts return actionable issues.
 * @param {{ accessToken: string, merchantId: string, storeId?: string|null, since: string|Date, until: string|Date, cursor?: string|null, fetchImpl?: Function, region?: any }} args
 */
export async function fetchLoyverseSales({ accessToken, merchantId, storeId = null, since, until, cursor = null, fetchImpl = globalThis.fetch, region = {currency:"GTQ",minorUnits:2,country:"GT"} }) {
  validateCredentials(accessToken, storeId);
  if (!validId(merchantId)) throw new Error("El identificador del comercio de Loyverse no es válido.");
  const start = timestamp(since);
  const end = timestamp(until);
  if (!start || !end || start > end) throw new Error("El período de consulta de Loyverse debe tener fechas válidas y ordenadas.");
  if (cursor != null && (typeof cursor !== "string" || cursor.length > 4096)) throw new Error("El cursor de Loyverse no es válido.");
  const account = await verifyLoyverseConnection({ accessToken, storeId, fetchImpl, region });
  if (account.merchantId !== merchantId) throw new Error("El token de Loyverse corresponde a otro comercio. Vuelve a conectar el comercio correcto.");
  const auth = { accessToken, fetchImpl, region };
  const page = await requestJson(auth, "/receipts", {
    updated_at_min: start, updated_at_max: end, limit: PAGE_LIMIT, store_id: storeId, cursor
  });
  if (!Array.isArray(page?.receipts) || page.receipts.length > PAGE_LIMIT) throw new Error("Loyverse devolvió una respuesta de recibos inválida o que supera el límite.");
  const nextCursor = page.cursor == null || page.cursor === "" ? null : page.cursor;
  if (nextCursor !== null && (typeof nextCursor !== "string" || nextCursor.length > 4096 || nextCursor === cursor)) {
    throw new Error("Loyverse devolvió un cursor inválido. Reintenta la sincronización.");
  }
  return { ...await normalizeReceiptPage(page.receipts, merchantId, storeId, auth), nextCursor };
}

async function normalizeReceiptPage(receipts, merchantId, storeId, auth) {
  const refunds = [], refundIssues = [];
  const refundReceipts = [];
  const salesReceipts = [];
  for (const receipt of receipts) {
    if (receipt?.receipt_type === "REFUND") {
      const normalized = normalizeRefundReceipt(receipt, merchantId, storeId, auth.region);
      if (normalized.issue) refundIssues.push(normalized.issue);
      else { refunds.push(normalized.refund); refundReceipts.push(receipt); }
    } else salesReceipts.push(receipt);
  }
  const originals = new Map();
  const originalIds = [...new Set(refunds.map(refund => refund.originalSaleId))];
  // Bounded, read-only original receipt lookups. Provider failures retain the
  // scan position; missing originals are accepted with unknown scope for review.
  for (let index = 0; index < originalIds.length; index += 5) {
    await Promise.all(originalIds.slice(index, index + 5).map(async originalId => {
      const original = receipts.find(receipt => receipt?.receipt_number === originalId && receipt.receipt_type === "SALE")
        ?? await requestJson(auth, `/receipts/${encodeURIComponent(originalId)}`, {}, true);
      if (original !== RECEIPT_NOT_FOUND && original?.receipt_number !== originalId) throw new Error("Loyverse devolvió un recibo original que no corresponde a la devolución.");
      originals.set(originalId, original === RECEIPT_NOT_FOUND ? null : original);
    }));
  }
  refunds.forEach((refund, index) => { refund.scope = refundScope(refundReceipts[index], originals.get(refund.originalSaleId)); });
  const inspected = salesReceipts.map((receipt) => ({ receipt, issue: inspectReceipt(receipt, storeId) }));
  const customerIds = [...new Set(inspected.filter(({ issue }) => !issue).map(({ receipt }) => receipt.customer_id))];
  const customers = new Map();
  if (customerIds.length) {
    const pageOfCustomers = await requestJson(auth, "/customers", { customer_ids: customerIds.join(","), limit: PAGE_LIMIT });
    if (!Array.isArray(pageOfCustomers?.customers) || pageOfCustomers.customers.length > PAGE_LIMIT || pageOfCustomers.cursor) {
      throw new Error("Loyverse devolvió una respuesta de clientes incompleta. Reintenta la sincronización.");
    }
    for (const customer of pageOfCustomers.customers) {
      if (!validId(customer?.id) || customers.has(customer.id)) throw new Error("Loyverse devolvió una respuesta de clientes inválida.");
      customers.set(customer.id, customer);
    }
  }
  const sales = [];
  const issues = [...refundIssues];
  for (const { receipt, issue } of inspected) {
    if (issue) {
      issues.push(issue);
      continue;
    }
    const normalized = normalizeReceipt(receipt, merchantId, customers.get(receipt.customer_id), auth.region);
    if (normalized.issue) issues.push(normalized.issue);
    else sales.push(normalized.sale);
  }
  return { sales, issues, ...(refunds.length ? { refunds } : {}) };
}

/**
 * Refresh failed receipts even when only their customer data has changed.
 * Official GET /receipts/{receipt_number}; 404 is terminal, other failures retry.
 * @param {{ accessToken: string, merchantId: string, storeId?: string|null, receiptIds: string[], fetchImpl?: Function, region?: any }} args
 */
export async function fetchLoyverseSalesByReceiptIds({ accessToken, merchantId, storeId = null, receiptIds, fetchImpl = globalThis.fetch, region = {currency:"GTQ",minorUnits:2,country:"GT"} }) {
  validateCredentials(accessToken, storeId);
  if (!validId(merchantId)) throw new Error("El identificador del comercio de Loyverse no es válido.");
  if (!Array.isArray(receiptIds) || receiptIds.length > 25 || receiptIds.some((id) => !validId(id))) {
    throw new Error("La recuperación de Loyverse admite hasta 25 identificadores de recibos válidos.");
  }
  const ids = [...new Set(receiptIds)];
  if (!ids.length) return { sales: [], issues: [] };
  const account = await verifyLoyverseConnection({ accessToken, storeId, fetchImpl, region });
  if (account.merchantId !== merchantId) throw new Error("El token de Loyverse corresponde a otro comercio. Vuelve a conectar el comercio correcto.");
  const auth = { accessToken, fetchImpl, region };
  const receipts = [], issues = [];
  // Five concurrent reads bound both request pressure and slow-account latency.
  for (let index = 0; index < ids.length; index += 5) {
    const batch = ids.slice(index, index + 5);
    const results = await Promise.all(batch.map(async (id) => {
      const record = await requestJson(auth, `/receipts/${encodeURIComponent(id)}`, {}, true);
      if (record === RECEIPT_NOT_FOUND) return { missing: id };
      if (!record || record.receipt_number !== id) throw new Error("Loyverse devolvió una respuesta que no corresponde al recibo solicitado.");
      return { record };
    }));
    for (const { record, missing } of results) {
      if (missing) issues.push({ saleId: missing, code: "receipt_not_found", message: "El recibo ya no está disponible en Loyverse. Revisa su eliminación; no se generaron puntos." });
      else receipts.push(record);
    }
  }
  const normalized = await normalizeReceiptPage(receipts, merchantId, storeId, auth);
  return { ...normalized, issues: [...issues, ...normalized.issues] };
}
