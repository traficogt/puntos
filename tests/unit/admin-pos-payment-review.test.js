import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { posOutcome, receiptProblem, reviewReceiptText, reviewSummaryText, walkInText } from "../../public/admin-dashboard/modules/pos-integration.js";

const data = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository module path only.
const operationsSource = await fs.readFile(new URL("../../public/admin-dashboard/modules/analytics/operations.js", import.meta.url), "utf8");
const { correctedAmount, invalidAmountEvents } = await import(data(operationsSource.replace('"/lib.js"', JSON.stringify(data("export const regionalMoney=value=>String(value);")))));

test("walk-in Loyverse sales are summarized apart from errors", () => {
  // The sync counts receipts without a customer among `errors`.
  const result = { errors: 3, issues: [
    { saleId: "a", code: "missing_customer", message: "Asocia un cliente con teléfono al recibo en Loyverse para identificarlo en Puntos." },
    { saleId: "b", code: "missing_customer", message: "Asocia un cliente con teléfono al recibo en Loyverse para identificarlo en Puntos." },
    { saleId: "c", code: "SALE_404", message: "El cliente no está registrado en este negocio." },
    { saleId: "d", code: "refund", message: "Las devoluciones no generan puntos." }
  ] };
  const outcome = posOutcome(result, result.issues);
  assert.equal(outcome.walkIns, 2);
  assert.equal(outcome.errors, 1);
  assert.deepEqual(outcome.issues.map(issue => issue.saleId), ["c", "d"]);
  assert.equal(walkInText(2), "2 ventas sin cliente asociado en Loyverse. No suman puntos ni se reintentan.");
  assert.equal(walkInText(1), "1 venta sin cliente asociado en Loyverse. No suma puntos ni se reintenta.");
});

test("preview rows subtract walk-ins only when they were counted as errors", () => {
  const rows = [{ code: "missing_customer", status: "error" }, { code: "missing_customer", status: "ignored" }, { code: "invalid_amount", status: "error" }];
  assert.deepEqual(posOutcome({ errors: 2 }, rows).errors, 1);
  assert.equal(posOutcome({ errors: 2 }, rows).walkIns, 2);
  assert.equal(posOutcome({ errors: 0 }, undefined).errors, 0);
});

test("review receipts explain the problem and why automatic retries stopped", () => {
  const region = { locale: "es-GT", timezone: "America/Guatemala" };
  assert.match(reviewReceiptText({ sale_id: "1-1001", code: "unverified_payment", reason: "not_retryable", attempts: 0, first_seen_at: "2026-11-09T17:00:00.000Z" }, region),
    /^Recibo 1-1001 \(detectado el 9\/11\/2026, 11:00\s?a\.\s?m\.\): Los pagos no confirman el total del recibo\. Pasó a revisión porque un reintento no lo corrige\.$/);
  assert.equal(reviewReceiptText({ sale_id: "1-1002", code: "SALE_404", reason: "retry_limit", attempts: 20 }, region),
    "Recibo 1-1002: El cliente no está registrado en PF con ese teléfono. Pasó a revisión porque se agotaron los reintentos (20 intentos o 7 días). Intentos: 20.");
  assert.equal(reviewReceiptText({ sale_id: null, code: "unknown_code", reason: "other" }), "Recibo sin número: Requiere revisión.");
  assert.equal(receiptProblem("toString"), "Requiere revisión", "inherited names are not labels");
  assert.equal(reviewSummaryText(0), "");
  assert.match(reviewSummaryText(1), /^1 recibo ya no se reintenta automáticamente y no sumó puntos\. Revísalos en Loyverse/);
  assert.match(reviewSummaryText(100), /Se muestran los 100 más recientes\.$/);
});

test("only approved payments that failed for an invalid amount offer a corrected-amount assignment", () => {
  const events = [
    { id: "1", status: "FAILED", reason: "invalid_amount", event_type: "payment.approved" },
    { id: "2", status: "FAILED", reason: "award_failed", event_type: "payment.approved" },
    { id: "3", status: "FAILED", reason: "invalid_amount", event_type: "payment.refunded" },
    { id: "4", status: "PENDING_MAPPING", reason: "missing_customer_mapping", event_type: "payment.approved" }
  ];
  assert.deepEqual(invalidAmountEvents(events).map(event => event.id), ["1"]);
  assert.deepEqual(invalidAmountEvents(undefined), []);
  for (const valid of ["48.5", " 48.50 ", "0", "12345678.99"]) assert.equal(correctedAmount(valid), valid.trim(), valid);
  for (const invalid of ["", "48,50", "-1", "1.234", "abc", "123456789", "1e3"]) assert.equal(correctedAmount(invalid), null, invalid);
});
