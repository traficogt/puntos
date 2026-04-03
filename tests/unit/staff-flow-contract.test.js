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

function readStaffRouteSource() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(new URL("../../src/app/routes/staff-routes.js", import.meta.url), "utf8");
}

test("staff shell makes customer selection explicit before award or redeem", () => {
  const html = readStaffShellHtml();
  const source = readStaffClientSource();
  const routeSource = readStaffRouteSource();
  const scanLoop = source.match(/async function scanLoop\(\)[\s\S]*?requestAnimationFrame\(scanLoop\);\n  \}/)?.[0] || "";

  assert.match(html, /staff-primary-workspace/, "expected the customer-dominant workspace wrapper");
  assert.match(html, /Seleccionar cliente/, "expected staff camera area to be framed as customer selection");
  assert.match(html, /Cliente activo/, "expected the staff workflow to surface the selected customer");
  assert.match(html, /id="customerReadyChip">Esperando cliente<\/div>/, "expected the customer summary to start waiting");
  assert.match(html, /id="btnAward" disabled/, "expected register to start disabled before selection");
  assert.match(html, /id="btnRedeem" disabled/, "expected redeem to start disabled before selection");
  assert.match(html, /id="rewardSelect" disabled/, "expected reward selection to start disabled before selection");
  assert.match(html, /staff-action-rail/, "expected award and redeem to share the action rail");
  assert.match(html, /staff-action-block-secondary/, "expected gift cards to stay secondary");
  assert.match(html, /Saldo actual/, "expected the summary to show current balance in one field");
  assert.match(html, /Último movimiento/, "expected the summary to show the latest action in one field");
  assert.match(html, /role="status"/, "expected the action status to be announced to assistive tech");
  assert.match(html, /aria-live="polite"/, "expected the action status to be politely announced");
  assert.match(html, /Escanea o ingresa el código del cliente para continuar\./, "expected explicit pre-selection guidance");
  assert.match(source, /Escanea o ingresa el código del cliente para continuar\./, "expected the approved pre-selection copy to be reused");
  assert.match(source, /Tu rol no permite canjear recompensas\./, "expected the surface to explain when redeem is unavailable by role");
  assert.match(source, /Los canjes no están disponibles en el plan actual\./, "expected the surface to explain when redeem is unavailable by plan");
  assert.match(source, /Canje no disponible para tu rol/, "expected the active-customer summary to explain role-based redeem limits");
  assert.match(source, /giftCardActionBlock/, "expected the gift-card panel to be explicitly hideable when unavailable");
  assert.match(source, /No hay recompensas activas para este programa\./, "expected reward guidance to stay explicit when no rewards are active");
  assert.match(routeSource, /res\.json\(\{ ok: true, staff: req\.staff, features \}\);/, "expected /staff/me to expose plan features to the staff client");
  assert.match(source, /\/api\/staff\/customer\/lookup/, "expected selected customers to be resolved through the lookup endpoint");
  assert.doesNotMatch(scanLoop, /await award\(token\);/, "expected QR scan not to auto-award points");
  assert.match(source, /customerQrToken/, "expected scanned tokens to be sent through customer lookup");
});

test("staff client resolves selected customers through the verified lookup endpoint", () => {
  const source = readStaffClientSource();

  assert.match(source, /\/api\/staff\/customer\/lookup/, "expected verified lookup endpoint for selected customer");
  assert.doesNotMatch(source, /decodeCustomerIdFromQrToken/, "expected client not to trust unverified QR payload decoding");
});
