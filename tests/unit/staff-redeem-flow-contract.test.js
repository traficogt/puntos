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
  assert.match(html, /Escanea o ingresa el código del cliente para continuar\./, "expected pre-selection guidance copy");
});

test("staff scanner selects the customer instead of auto-awarding on scan", () => {
  const source = readStaffModule();

  assert.match(source, /async function selectCustomerFromToken/, "expected explicit customer-selection helper");
  assert.match(source, /await selectCustomerFromToken\(token,\s*\{\s*silent:\s*false\s*\}\)/, "expected scan loop to select customer from scanned token");
  assert.doesNotMatch(source, /scanLoop[\s\S]*await award\(token\)/, "expected scan loop to stop auto-awarding on scan");
  assert.match(source, /Primero selecciona un cliente\./, "expected award and redeem flow to require selected customer");
});
