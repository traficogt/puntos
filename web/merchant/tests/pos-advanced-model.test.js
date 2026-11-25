import test from "node:test";
import assert from "node:assert/strict";
import {
  CSV_MAX_BYTES,
  connectionActive,
  csvColumns,
  csvFileIssue,
  csvMappingReady,
  csvPreviewPayload,
  emptyCsvMapping,
  issueLine,
  keyStatus,
  lastSyncSummary,
  loyversePayload,
  loyverseStatus,
  posEndpoint,
  previewSummary,
  resultSummary,
  saleExample,
  statusLabel,
} from "../src/pos-advanced-model.ts";

const integration = { enabled: true, mode: "csv", automatic: false, has_api_key: false, loyverse: { configured: false } };

test("CSV mapping needs a source, the three required columns and a paid signal", () => {
  const csv = "id,tel,monto\n1,55551234,75";
  assert.equal(csvMappingReady(csv, emptyCsvMapping), false);
  const mapping = { source: "caja", columns: { saleId: "id", customerPhone: "tel", amountQ: "monto" }, amountUnit: "major", assumePaid: false };
  assert.equal(csvMappingReady(csv, mapping), false, "no status column and not assumed paid");
  assert.equal(csvMappingReady(csv, { ...mapping, assumePaid: true }), true);
  assert.equal(csvMappingReady(csv, { ...mapping, columns: { ...mapping.columns, status: "estado" } }), true);
  assert.equal(csvMappingReady("", { ...mapping, assumePaid: true }), false, "a file is required");
  assert.equal(csvMappingReady(csv, { ...mapping, source: "  ", assumePaid: true }), false);
  assert.deepEqual(csvColumns.filter(c => c.required).map(c => c.key), ["saleId", "customerPhone", "amountQ"]);
});

test("CSV payload sends only mapped columns and ignores assumePaid when a status column exists", () => {
  const csv = "a,b";
  const payload = csvPreviewPayload(csv, { source: " caja ", columns: { saleId: "a", customerPhone: "b", amountQ: "c", status: "", items: undefined }, amountUnit: "minor", assumePaid: true });
  assert.deepEqual(payload, { csv, source: "caja", columns: { saleId: "a", customerPhone: "b", amountQ: "c" }, amountUnit: "minor", assumePaid: true });
  const withStatus = csvPreviewPayload(csv, { source: "caja", columns: { saleId: "a", customerPhone: "b", amountQ: "c", status: "s" }, amountUnit: "major", assumePaid: true });
  assert.equal(withStatus.assumePaid, false);
  assert.equal(csvFileIssue(CSV_MAX_BYTES), null);
  assert.match(csvFileIssue(CSV_MAX_BYTES + 1), /200 KB/);
});

test("Loyverse payload keeps the saved switches and only sends a token when one was typed", () => {
  const saved = { ...integration, mode: "loyverse", enabled: false, automatic: true };
  assert.deepEqual(loyversePayload(saved, { storeId: " tienda-1 ", token: "" }), { enabled: false, mode: "loyverse", automatic: true, loyverse: { store_id: "tienda-1" } });
  assert.deepEqual(loyversePayload(saved, { storeId: "", token: " tok " }), { enabled: false, mode: "loyverse", automatic: true, loyverse: { store_id: "", access_token: "tok" } });
  assert.equal(loyverseStatus(saved), "Guarda un token para verificar tu cuenta de Loyverse.");
  assert.equal(loyverseStatus({ ...saved, loyverse: { configured: true, merchant_name: "Café Sol" } }), "Cuenta conectada: Café Sol.");
});

test("summaries read the server shapes and never show negative counts", () => {
  assert.equal(previewSummary({ total: 3, ready: 2, errors: 1, ignored: 0, duplicates: 0 }), "Ventas revisadas: 3. Listas: 2; repetidas: 0; omitidas: 0; con errores: 1. La vista previa no asigna puntos.");
  assert.equal(previewSummary(undefined), "Ventas revisadas: 0. Listas: 0; repetidas: 0; omitidas: 0; con errores: 0. La vista previa no asigna puntos.");
  assert.equal(resultSummary({ awarded: 2, duplicates: -4 }), "Ventas con puntos: 2; repetidas: 0; omitidas: 0; con errores: 0.");
  assert.equal(issueLine({ saleId: "V-1", message: "Sin teléfono" }), "V-1: Sin teléfono");
  assert.equal(issueLine({ row: 4, code: "PHONE_INVALID" }), "Fila 4: PHONE_INVALID");
  assert.equal(issueLine({}), "Venta: Requiere revisión.");
  assert.equal(statusLabel("ready"), "Lista");
  assert.equal(statusLabel("weird"), "weird");
});

test("last sync summary distinguishes errors and tolerates the legacy field names", () => {
  assert.deepEqual(lastSyncSummary(null), { text: "Aún no se han sincronizado ventas.", error: false });
  const ok = lastSyncSummary({ completed_at: "2026-11-10T12:00:00.000Z", result: { awarded: 5, duplicates: 1 }, ignored: 2, errors: 0, pending: 1 }, "en-US");
  assert.equal(ok.error, false);
  assert.match(ok.text, /Ventas con puntos: 5; repetidas: 1; omitidas: 2; con errores: 0\. Pendientes de corregir y reintentar: 1\./);
  assert.match(ok.text, /2026|11\/10\/2026/);
  const failed = lastSyncSummary({ status: "error", message: "Token vencido" });
  assert.deepEqual(failed, { text: "Última sincronización: Token vencido", error: true });
});

test("API helpers build the public endpoint, the key status and the sample sale", () => {
  assert.equal(posEndpoint("https://app.example.com", "cafe sol"), "https://app.example.com/api/v1/public/pos/cafe%20sol/sales");
  assert.equal(posEndpoint("https://app.example.com", null), "");
  assert.equal(keyStatus(integration), "Aún no hay una clave API. Genera una para conectar tu sistema.");
  assert.equal(keyStatus({ ...integration, has_api_key: true, api_key_masked: "ab…cd" }), "Clave guardada: ab…cd. Solo se muestra completa al generarla.");
  const sample = JSON.parse(saleExample("CLP"));
  assert.equal(sample.currency, "CLP");
  assert.equal(sample.dryRun, true);
  assert.equal(connectionActive(integration, "csv", false), true);
  assert.equal(connectionActive(integration, "csv", true), false, "unsaved switches block imports");
  assert.equal(connectionActive(integration, "api", false), false, "another saved mode blocks this mode's tools");
  assert.equal(connectionActive({ ...integration, enabled: false }, "csv", false), false);
});
