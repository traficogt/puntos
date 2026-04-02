import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildBrandingPayload } from "../../public/admin-dashboard/modules/branding-form.js";

function makeQuery(elements) {
  return (selector) => elements[selector] ?? null;
}

test("branding form serializes the allowed customer-facing fields and preserves Spanish-first copy fields", () => {
  const $ = makeQuery({
    "#brandingMode": { value: "white_label_ready" },
    "#brandingProgramName": { value: "Cafe Bourbon Rewards" },
    "#brandingLogoUrl": { value: "https://cdn.example.com/logo.png" },
    "#brandingPrimaryColor": { value: "#6d3524" },
    "#brandingAccentColor": { value: "#d7a554" },
    "#brandingNeutralTheme": { value: "warm" },
    "#brandingPoweredByVisible": { checked: false },
    "#brandingWalletHeadline": { value: "Tus puntos en Cafe Bourbon" },
    "#brandingJoinHeadline": { value: "Unete y gana beneficios" }
  });

  assert.deepEqual(buildBrandingPayload($), {
    branding_mode: "white_label_ready",
    customer_program_name: "Cafe Bourbon Rewards",
    customer_logo_url: "https://cdn.example.com/logo.png",
    qr_logo_enabled: false,
    primary_color: "#6D3524",
    accent_color: "#D7A554",
    neutral_theme: "warm",
    powered_by_visible: false,
    wallet_headline: "Tus puntos en Cafe Bourbon",
    join_headline: "Unete y gana beneficios"
  });
});

test("customer branding helpers derive visibility and fallback copy from branding mode", async () => {
  const { normalizeCustomerBranding } = await import("../../public/customer-branding.js");

  assert.deepEqual(
    normalizeCustomerBranding({
      name: "Cafe Bourbon",
      customer_branding: {
        branding_mode: "white_label_ready",
        customer_program_name: "Recompensas Cafe Bourbon",
        primary_color: "#6d3524",
        accent_color: "#d7a554",
        powered_by_visible: false,
        wallet_headline: "Tus puntos en Cafe Bourbon",
        join_headline: "Unete y gana beneficios"
      }
    }),
    {
      businessName: "Cafe Bourbon",
      brandingMode: "white_label_ready",
      programName: "Recompensas Cafe Bourbon",
      logoUrl: "",
      primaryColor: "#6D3524",
      accentColor: "#D7A554",
      neutralTheme: "warm",
      poweredByVisible: false,
      walletHeadline: "Tus puntos en Cafe Bourbon",
      joinHeadline: "Unete y gana beneficios",
      navKicker: "Programa activo",
      navTitle: "Recompensas Cafe Bourbon",
      joinSubtitle: "Confirma tu telefono para acumular puntos en Cafe Bourbon."
    }
  );
});

test("customer shell keeps branding anchors while using the premium app shell", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");

  assert.match(source, /id="customerBrandTitle"/);
  assert.match(source, /<body class="app-shell page-customer">/);
  assert.match(source, /id="themeToggle"/);
});
