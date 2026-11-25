import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

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
        join_headline: "Unete y gana beneficios",
      },
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
      joinSubtitle: "Confirma tu telefono para acumular puntos en Cafe Bourbon.",
    },
  );
});

test("customer shell keeps branding anchors while using the premium app shell", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");

  assert.match(source, /id="customerBrandTitle"/);
  assert.match(source, /<body class="[^"]*\bapp-shell\b[^"]*\bpage-customer\b[^"]*">/);
  assert.match(source, /id="themeToggle"/);
});
