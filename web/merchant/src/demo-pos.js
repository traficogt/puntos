import { configurationPayload, receiptFromValues } from "./pos-model.js";

// Synthetic state stays in this tab. Credentials and external operations are
// intentionally outside this demo contract.
let integration = { enabled: false, mode: "api", automatic: false, has_api_key: false,
  loyverse: { configured: false, merchant_id: null, merchant_name: null, store_id: null }, last_sync: null };
const unavailable = () => { throw new Error("Esta acción no está disponible en la demostración."); };
const refunds = [
  { id: "11111111-1111-4111-8111-111111111101", source: "caja-ejemplo", refund_id: "DEV-003", original_sale_id: "V-103", amount_q: 25, status: "pending", reason: "partial_refund", original_transaction_id: "movimiento-ejemplo-103", reversal_transaction_id: null, message: "Devolución parcial de ejemplo. Revisa el recibo y el historial; reintentar no calcula puntos proporcionales ni justifica anular toda la compra." },
  { id: "11111111-1111-4111-8111-111111111102", source: "caja-ejemplo", refund_id: "DEV-002", original_sale_id: "V-102", amount_q: 40, status: "pending", reason: "original_not_found", original_transaction_id: null, reversal_transaction_id: null, message: "Ejemplo: la venta original todavía no se importó a PF. Corrige la venta en la caja y vuelve a comprobar." },
  { id: "11111111-1111-4111-8111-111111111103", source: "loyverse:comercio-ejemplo:tienda-ejemplo", refund_id: "DEV-001", original_sale_id: "V-101", amount_q: 60, status: "reconciled", reason: "full_refund", original_transaction_id: "movimiento-ejemplo-101", reversal_transaction_id: "reversion-ejemplo-101", message: "Ejemplo ficticio de devolución completa conciliada. No corresponde a una compra real." }
].map(row => ({ ...row, origin: row.source.startsWith("loyverse:") ? "loyverse" : "api", currency: "GTQ", attempts: 1, created_at: "2026-11-10T12:00:00.000Z", last_attempt_at: "2026-11-10T12:00:00.000Z" }));

export function demoPos(url, options = {}) {
  const method = options.method || "GET";
  const path = url.pathname;
  const body = options.body ? JSON.parse(options.body) : {};
  if (path === "/api/admin/pos/refunds" && method === "GET") {
    const status = url.searchParams.get("status");
    return structuredClone({ ok: true, refunds: refunds.filter(row => !status || row.status === status), summary: { total: 3, pending: 2, reconciled: 1, partial: 1 }, limit: 50 });
  }
  const retry = path.match(/^\/api\/admin\/pos\/refunds\/([^/]+)\/retry$/);
  if (retry && method === "POST") {
    if (Object.keys(body).length) return unavailable();
    const row = refunds.find(row => row.id === retry[1]);
    if (!row) return unavailable();
    return structuredClone({ ok: true, refund: row, replay: true });
  }
  if (path === "/api/admin/pos" && method === "GET")
    return structuredClone({ ok: true, business: { slug: "cafe-jacaranda-demo" }, integration });
  if (path === "/api/admin/pos" && method === "PUT") {
    if (Object.keys(body).some(k => !["mode", "enabled", "automatic"].includes(k))) return unavailable();
    integration = { ...integration, ...configurationPayload(body, integration) };
    return structuredClone({ ok: true, business: { slug: "cafe-jacaranda-demo" }, integration });
  }
  if (path === "/api/admin/pos/preflight" && method === "POST") {
    if (Object.keys(body).some(k => !["saleId", "source", "customerPhone", "amountQ", "items", "currency", "status"].includes(k)) || body.currency !== "GTQ") return unavailable();
    const sale = receiptFromValues(body);
    const digits = sale.customerPhone.replace(/\D/g, "");
    const phone = digits.length === 8 ? `502${digits}` : digits;
    const matched = phone === "50255554444";
    return { ok: true, dryRun: true, headers: [], summary: { total: 1, ready: matched ? 1 : 0, errors: matched ? 0 : 1, ignored: 0, duplicates: 0 }, rows: [{
      row: null, saleId: sale.saleId, customerPhone: phone, amountQ: sale.amountQ,
      points: matched ? Math.ceil(sale.amountQ * 0.1) : 0, status: matched ? "ready" : "error", code: matched ? "" : "SALE_404",
      message: matched ? "Cliente de ejemplo encontrado. No se asignaron puntos." : "No coincide con el teléfono ficticio de esta demostración. Prueba con 55554444.",
    }] };
  }
  return unavailable();
}
