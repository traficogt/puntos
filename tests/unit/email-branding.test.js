import test from "node:test";
import assert from "node:assert/strict";

import { resolveEmailBranding } from "../../src/app/services/messaging/email-branding.js";

test("resolveEmailBranding uses platform defaults without business context", async () => {
  const branding = await resolveEmailBranding({
    businessId: null,
    getBusinessById: async () => null
  });

  assert.equal(branding.scope, "platform");
  assert.equal(branding.brandName, "PuntosFieles");
  assert.equal(branding.poweredByVisible, false);
  assert.match(branding.primaryColor, /^#/);
});

test("resolveEmailBranding uses tenant branding when business context exists", async () => {
  const branding = await resolveEmailBranding({
    businessId: "biz_1",
    getBusinessById: async () => ({
      id: "biz_1",
      name: "Cafe Bourbon",
      customer_branding_json: {
        customer_program_name: "Recompensas Cafe Bourbon",
        customer_logo_url: "https://cdn.example.com/logo.png",
        primary_color: "#6D3524",
        accent_color: "#D7A554",
        powered_by_visible: true
      }
    })
  });

  assert.equal(branding.scope, "tenant");
  assert.equal(branding.brandName, "Recompensas Cafe Bourbon");
  assert.equal(branding.logoUrl, "https://cdn.example.com/logo.png");
  assert.equal(branding.primaryColor, "#6D3524");
  assert.equal(branding.accentColor, "#D7A554");
  assert.equal(branding.poweredByVisible, true);
});

test("resolveEmailBranding falls back to business name and safe defaults when tenant branding is incomplete", async () => {
  const branding = await resolveEmailBranding({
    businessId: "biz_2",
    getBusinessById: async () => ({
      id: "biz_2",
      name: "Cafe Central",
      customer_branding_json: {}
    })
  });

  assert.equal(branding.scope, "tenant");
  assert.equal(branding.brandName, "Cafe Central");
  assert.equal(branding.logoUrl, "");
  assert.match(branding.primaryColor, /^#/);
  assert.match(branding.accentColor, /^#/);
});
