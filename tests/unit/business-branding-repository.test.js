import { test } from "node:test";
import assert from "node:assert/strict";

import {
  businessCustomerBrandingSchema
} from "../../src/utils/schemas.js";

test("business customer branding schema accepts the supported branding modes", () => {
  const parsed = businessCustomerBrandingSchema.parse({
    branding_mode: "endorsed_brand",
    customer_program_name: "Cafe Bourbon Rewards",
    customer_logo_url: "https://cdn.example.com/logo.png",
    primary_color: "#6D3524",
    accent_color: "#D7A554",
    neutral_theme: "warm",
    powered_by_visible: true,
    wallet_headline: "Tus puntos en un solo lugar",
    join_headline: "Unete y gana beneficios"
  });

  assert.equal(parsed.branding_mode, "endorsed_brand");
});

test("business customer branding schema rejects unsafe colors and unsupported modes", () => {
  assert.throws(() => businessCustomerBrandingSchema.parse({
    branding_mode: "full_custom",
    primary_color: "red"
  }));
});

test("business repository exposes customer branding helpers", async () => {
  process.env.NODE_ENV = "test";
  process.env.DB_HOST = "localhost";
  process.env.DB_NAME = "puntos";
  process.env.DB_USER = "puntos";
  process.env.DB_PASSWORD_FILE = "";
  process.env.DB_PASSWORD = "test-db-password-12345";
  process.env.JWT_SECRET_FILE = "";
  process.env.JWT_SECRET = "test-jwt-secret-abcdefghijklmnopqrstuvwxyz";

  const { BusinessRepo } = await import("../../src/app/repositories/business-repository.js");
  assert.equal(typeof BusinessRepo.getCustomerBrandingById, "function");
  assert.equal(typeof BusinessRepo.updateCustomerBranding, "function");
});
