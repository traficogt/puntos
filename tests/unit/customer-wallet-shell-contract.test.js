import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readCustomerShellHtml() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");
}

function readCustomerWalletCss() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(new URL("../../public/styles/pages.css", import.meta.url), "utf8");
}

function readCustomerBrandingModule() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(new URL("../../public/customer-branding.js", import.meta.url), "utf8");
}

function getWalletShellRegion(html) {
  const walletStart = html.indexOf('<div class="loyalty-card">');
  assert.notEqual(walletStart, -1, "expected the customer wallet shell to include a loyalty-card container");

  const sectionsStart = html.indexOf('<div class="customer-sections">', walletStart);
  assert.notEqual(sectionsStart, -1, "expected the customer wallet shell to include the lower-section container");

  return html.slice(walletStart, sectionsStart);
}

test("customer wallet exposes a dominant hero and progress band near the top", () => {
  const html = readCustomerShellHtml();
  const walletShell = getWalletShellRegion(html);

  assert.match(walletShell, /class="[^"]*\blc-hero\b[^"]*"/, "expected lc-hero inside the top wallet shell");
  assert.match(walletShell, /class="[^"]*\blc-focus-band\b[^"]*"/, "expected lc-focus-band inside the top wallet shell");
  assert.match(walletShell, /id="nextReward"/, "expected nextReward inside the top wallet shell");
  assert.match(
    html,
    /<div class="customer-sections">\s*<div class="[^"]*\bcus-section\b[^"]*\bcus-section-tier\b[^"]*" id="tierSection">/,
    "expected tierSection to be the first lower section immediately after the wallet card",
  );
});

test("customer wallet keeps account utilities in a separate quiet section", () => {
  const html = readCustomerShellHtml();
  const css = readCustomerWalletCss();

  assert.match(
    html,
    /class="[^"]*\bcus-section\b[^"]*\bcus-section-account\b[^"]*"/,
    "expected quiet account section classes to remain present",
  );
  assert.match(
    css,
    /\.cus-section-account\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1;/,
    "expected account section to span the full grid width as the quiet bottom section",
  );
  assert.doesNotMatch(
    css,
    /\.cus-section-referrals,\s*\.cus-section-achievements,\s*\.cus-section-account\s*\{[\s\S]*grid-column:\s*2;/,
    "expected no later grouped CSS rule to force the account section back into the right column",
  );
  assert.match(html, /id="btnExport"/, "expected export control to remain available");
  assert.match(html, /id="btnDelete"/, "expected delete control to remain available");
});

test("logged-out wallet shell stays Spanish-first and exposes registro plus login", () => {
  const html = readCustomerShellHtml();
  const brandingModule = readCustomerBrandingModule();

  assert.match(html, /Ir a registro/, "expected registration path copy in Spanish");
  assert.match(html, /Ingresar/, "expected login path copy in Spanish");
  assert.match(
    html,
    /<h1\b[^>]*id="customerEntryTitle"[^>]*>\s*Tu programa activo vive aquí\.\s*<\/h1>/,
    "expected the refined logged-out heading copy",
  );
  assert.match(
    brandingModule,
    /setText\("#customerEntryTitle", "Tu programa activo vive aquí\."\)/,
    "expected runtime wallet branding to preserve the approved entry heading copy",
  );
});
