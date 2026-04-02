import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function readStaffShellHtml() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(new URL("../../public/staff.html", import.meta.url), "utf8");
}

function readStaffClientSource() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(new URL("../../public/staff/index.js", import.meta.url), "utf8");
}

test("staff shell makes customer selection explicit before award or redeem", () => {
  const html = readStaffShellHtml();
  const source = readStaffClientSource();
  const scanLoop = source.match(/async function scanLoop\(\)[\s\S]*?requestAnimationFrame\(scanLoop\);\n  \}/)?.[0] || "";

  assert.match(html, /Seleccionar cliente/, "expected staff camera area to be framed as customer selection");
  assert.match(html, /Cliente seleccionado/, "expected the staff workflow to surface the selected customer");
  assert.match(source, /Primero selecciona un cliente\./, "expected redeem to require an explicit customer selection");
  assert.match(source, /customerId: lastCustomerId/, "expected redeem to use the selected customer");
  assert.doesNotMatch(scanLoop, /await award\(token\);/, "expected QR scan not to auto-award points");
  assert.match(scanLoop, /await selectCustomerFromToken\(token, \{ silent: false \}\);/, "expected QR scan to select the customer instead");
});

test("staff client resolves selected customers through the verified lookup endpoint", () => {
  const source = readStaffClientSource();

  assert.match(source, /\/api\/staff\/customer\/lookup/, "expected verified lookup endpoint for selected customer");
  assert.doesNotMatch(source, /decodeCustomerIdFromQrToken/, "expected client not to trust unverified QR payload decoding");
});
