import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readCustomerShellHtml() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");
}

function readCustomerBrandingModule() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(new URL("../../public/customer-branding.js", import.meta.url), "utf8");
}

function readCustomerMeModule() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(new URL("../../public/customer/me.js", import.meta.url), "utf8");
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

test("customer wallet removes the paywalled account/export block and keeps gated customer modules identifiable", () => {
  const html = readCustomerShellHtml();
  const meModule = readCustomerMeModule();

  assert.doesNotMatch(html, /\bcus-section-account\b/, "expected account/export block to be removed from the wallet");
  assert.doesNotMatch(html, /id="btnExport"/, "expected export control to be removed from the wallet");
  assert.doesNotMatch(html, /id="btnDelete"/, "expected delete control to be removed from the wallet");
  assert.match(html, /id="referralsSection"/, "expected referrals region to remain identifiable for feature gating");
  assert.match(html, /id="achievementsSection"/, "expected achievements region to remain identifiable for feature gating");
  assert.match(meModule, /setHidden\(referralsSection, !features\.referrals\)/, "expected referrals visibility to follow plan features");
  assert.match(meModule, /setHidden\(achievementsSection, !features\.gamification\)/, "expected achievements visibility to follow plan features");
});

test("logged-out wallet shell stays Spanish-first and treats /c as wallet-only entry back to registro", () => {
  const html = readCustomerShellHtml();
  const brandingModule = readCustomerBrandingModule();

  assert.match(html, /Tu tarjeta se abre con el enlace del negocio\./, "expected wallet-only customer entry copy");
  assert.match(html, /Si tu sesión venció, vuelve a abrir el enlace del negocio para entrar de nuevo\./);
  assert.match(html, /No hay formulario aquí\./);
  assert.match(
    html,
    /<h1\b[^>]*id="customerEntryTitle"[^>]*>\s*Tu tarjeta se abre con el enlace del negocio\.\s*<\/h1>/,
    "expected the refined logged-out heading copy",
  );
  assert.doesNotMatch(html, /id="btnGoJoin"/, "expected /c to stop exposing pseudo-login actions");
  assert.doesNotMatch(html, /id="slug"/, "expected /c to stop exposing inline slug entry");
  assert.doesNotMatch(html, /id="joinFeedback"/, "expected /c to stop exposing inline feedback entry");
  assert.match(
    brandingModule,
    /setText\("#customerEntryTitle", "Tu tarjeta se abre con el enlace del negocio\."\)/,
    "expected runtime wallet branding to preserve the approved entry heading copy",
  );
});
