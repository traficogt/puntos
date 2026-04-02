import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("shared icon svg matches the canonical PF motion-study mark", () => {
  const iconSvg = read("public/icon.svg");

  assert.match(iconSvg, /<linearGradient id="pf-bg"/);
  assert.match(iconSvg, /<stop offset="0%" stop-color="#0F1020"/);
  assert.match(iconSvg, /<stop offset="100%" stop-color="#1A1530"/);
  assert.match(iconSvg, /<path d="M140 386 L140 128 C308 128 376 182 376 268"/);
  assert.match(iconSvg, /stroke="#E2E8F0"/);
  assert.match(iconSvg, /<stop offset="0%" stop-color="#FBBF24"/);
  assert.match(iconSvg, /<stop offset="100%" stop-color="#F59E0B"/);
  assert.match(iconSvg, /<circle class="punto" cx="238" cy="198" r="27" fill="#F59E0B"/);
});

test("marketing header and entry points reference the canonical PF icon", () => {
  const indexHtml = read("public/index.html");
  const customerHtml = read("public/customer.html");
  const joinHtml = read("public/join.html");
  const adminDashboardHtml = read("public/admin-dashboard.html");

  assert.match(indexHtml, /rel="icon" href="\/icon\.svg\?v=4" type="image\/svg\+xml"/);
  assert.match(indexHtml, /<a href="\/" class="brand brand-lockup">/);
  assert.match(indexHtml, /<img src="\/icon\.svg\?v=4" alt="PuntosFieles" class="brand-mark"\/>/);
  assert.match(indexHtml, /Bricolage\+Grotesque/);
  assert.match(customerHtml, /rel="icon" href="\/icon\.svg\?v=4" type="image\/svg\+xml"/);
  assert.match(joinHtml, /rel="icon" href="\/icon\.svg\?v=4" type="image\/svg\+xml"/);
  assert.match(adminDashboardHtml, /rel="icon" href="\/icon\.svg\?v=4" type="image\/svg\+xml"/);
});

test("manifest stays installable and aligned with the canonical icon set", () => {
  const manifest = read("public/manifest.webmanifest");

  assert.match(manifest, /"display": "standalone"/);
  assert.match(manifest, /"src": "\/icon-192\.png"/);
  assert.match(manifest, /"src": "\/icon-512\.png"/);
  assert.match(manifest, /"background_color": "#0b0f14"/);
  assert.match(manifest, /"theme_color": "#0b0f14"/);
});
