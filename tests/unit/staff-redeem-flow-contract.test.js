import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function readStaffHtml() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(new URL("../../public/staff.html", import.meta.url), "utf8");
}

function readStaffModule() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(new URL("../../public/staff/index.js", import.meta.url), "utf8");
}

test("staff shell exposes an explicit customer-selection action before register or redeem", () => {
  const html = readStaffHtml();

  assert.match(html, /id="btnSelectCustomer"/, "expected explicit customer selection control");
  assert.match(html, /Seleccionar cliente/, "expected Spanish-first customer-selection copy");
  assert.match(html, /Cliente activo/, "expected selected-customer summary copy");
  assert.match(html, /id="btnAward" disabled/, "expected award to look inactive before selection");
  assert.match(html, /id="btnRedeem" disabled/, "expected redeem to look inactive before selection");
  assert.match(html, /Saldo actual/, "expected a current-balance summary label");
  assert.match(html, /Último movimiento/, "expected a latest-action summary label");
  assert.match(html, /Escanea o ingresa el código del cliente para continuar\./, "expected pre-selection guidance copy");
});

test("staff scanner selects the customer instead of auto-awarding on scan", () => {
  const source = readStaffModule();

  assert.match(source, /Escanea o ingresa el código del cliente para continuar\./, "expected the approved prompt copy to be reused");
  assert.match(source, /Registrando puntos\.\.\./, "expected award to show an in-surface busy state");
  assert.match(source, /Canjeando recompensa\.\.\./, "expected redeem to show an in-surface busy state");
  assert.match(source, /Canje listo\./, "expected redeem to refresh the surface after success");
  assert.match(source, /Puntos registrados:/, "expected award to refresh the surface after success");
  assert.match(source, /\/api\/staff\/customer\/lookup/, "expected scanned tokens to resolve through the customer lookup endpoint");
  assert.doesNotMatch(source, /scanLoop[\s\S]*await award\(token\)/, "expected scan loop to stop auto-awarding on scan");
});
