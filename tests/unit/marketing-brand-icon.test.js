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
  const staffHtml = read("public/staff.html");

  // Asset versions are content hashes written by npm run sw:build.
  const version = "\\?v=[0-9a-f]{8}";
  const icon = new RegExp(`rel="icon" href="\\/icon\\.svg${version}" type="image\\/svg\\+xml"`);
  assert.match(indexHtml, icon);
  assert.match(indexHtml, /<a href="\/" class="brand" aria-label="PuntosFieles, inicio">/);
  assert.match(
    indexHtml,
    new RegExp(`<img src="\\/icon\\.svg${version}" alt="" width="36" height="36"\\/>`),
  );
  assert.match(indexHtml, new RegExp(`href="\\/styles\\/fonts\\.css${version}"`));
  assert.match(read("public/styles/fonts.css"), /font-family: 'Bricolage Grotesque'/);
  assert.match(customerHtml, icon);
  assert.match(joinHtml, icon);
  assert.match(staffHtml, icon);
});

test("manifest stays installable and aligned with the canonical icon set", () => {
  const manifest = read("public/manifest.webmanifest");

  assert.match(manifest, /"display": "standalone"/);
  assert.match(manifest, /"src": "\/icon-192\.png"/);
  assert.match(manifest, /"src": "\/icon-512\.png"/);
  assert.match(manifest, /"background_color": "#0b0f14"/);
  assert.match(manifest, /"theme_color": "#0b0f14"/);
});
