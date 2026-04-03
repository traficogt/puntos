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
  assert.match(html, /Cliente listo/, "expected a visible ready-state cue");
  assert.match(html, /staff-action-rail/, "expected a shared action rail for register and redeem");
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
});
