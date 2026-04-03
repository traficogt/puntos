import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function readStaffHtml() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(new URL("../../public/staff.html", import.meta.url), "utf8");
}

function readStaffStyles() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(new URL("../../public/styles/pages.css", import.meta.url), "utf8");
}

test("staff shell centers the active customer above a shared action rail", () => {
  const html = readStaffHtml();

  assert.match(html, /staff-primary-workspace/, "expected a dedicated primary workspace wrapper");
  assert.match(html, /Seleccionar cliente/, "expected the left selection panel to remain explicit");
  assert.match(html, /Cliente activo/, "expected the active customer summary to be dominant");
  assert.match(html, /id="customerReadyChip">Esperando cliente<\/div>/, "expected the summary to start in a waiting state");
  assert.doesNotMatch(html, /Cliente listo/, "expected the ready cue to appear only after selection");
  assert.match(html, /staff-action-rail/, "expected a shared action rail for register and redeem");
  assert.match(html, /staff-action-block-secondary/, "expected gift cards to remain visually secondary");
  assert.match(html, /Saldo actual/, "expected one summary field to describe the current balance");
  assert.match(html, /Último movimiento/, "expected one summary field to describe the latest action");
  assert.match(html, /aria-live="polite"/, "expected the inline status area to announce updates");
  assert.match(html, /role="status"/, "expected the inline status area to behave as a live status region");
  assert.match(html, /Escanea o ingresa el código del cliente para continuar\./, "expected explicit pre-selection guidance");
});

test("staff surface polish CSS defines the customer-dominant workspace", () => {
  const css = readStaffStyles();

  assert.match(css, /\.staff-primary-workspace/, "expected the primary workspace layout rule");
  assert.match(css, /\.staff-selection-panel/, "expected the left selection panel styling");
  assert.match(css, /\.staff-customer-column/, "expected the active customer column styling");
  assert.match(css, /\.staff-action-rail/, "expected the shared action rail styling");
  assert.match(css, /\.staff-action-grid/, "expected the shared action grid styling");
  assert.match(css, /\.staff-ready-chip/, "expected the ready-state chip styling");
  assert.match(css, /staff-action-grid/, "expected the main actions to share the top row");
  assert.match(css, /staff-action-block-secondary/, "expected gift cards to span the full rail and read as secondary");
  assert.match(css, /staff-action-rail\[data-customer-state="waiting"\]/, "expected the main actions to look inactive before selection");
});
