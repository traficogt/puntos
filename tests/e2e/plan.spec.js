import { test, expect } from "@playwright/test";
import { apiPost, expectOk } from "./lib.js";

// "Plan y facturación" (docs/product/2026-11-25-self-serve-trial.md §4.4, wave 2) against the
// real stack. The e2e stack has no Recurrente credentials, so GET /api/admin/billing answers
// 503 BILLING_UNAVAILABLE (or 404 before the billing API ships); the page must keep working
// with the wave-1 upgrade request form and the fallback copy.
test.use({ serviceWorkers: "block" });

function rand(len = 6) {
  return Math.random()
    .toString(36)
    .slice(2, 2 + len);
}

async function useRandomClientIp(page) {
  const ip = `10.220.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
}

/** A fresh self-serve trial through the public API (NODE_ENV=test exposes the OTP as dev_code). */
async function createTrialBusiness(page) {
  const token = rand(8);
  const phone = `5025${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  await page.goto("/prueba/", { waitUntil: "domcontentloaded" });
  const requested = await apiPost(
    page,
    "/api/public/trial/request-code",
    { phone, turnstileToken: "dev" },
    { csrf: false },
  );
  expectOk(requested, "trial code request");
  expect(String(requested.body.dev_code)).toMatch(/^\d{6}$/);
  const verified = await apiPost(
    page,
    "/api/public/trial/verify",
    { phone, code: requested.body.dev_code },
    { csrf: false },
  );
  expectOk(verified, "trial phone verification");
  const signup = await apiPost(
    page,
    "/api/public/trial/signup",
    {
      grant: verified.body.grant,
      businessName: `Plan E2E ${token}`,
      email: `plan-${token}@example.com`,
      password: "OrchardLanternMarble2026!",
      category: "cafe",
      turnstileToken: "dev",
    },
    { csrf: false },
  );
  expect(signup.status, JSON.stringify(signup.body)).toBe(201);
  return signup.body;
}

test("a fresh trial opens Plan y facturación and keeps the request form while card payment is unavailable", async ({
  page,
}) => {
  await useRandomClientIp(page);
  const signup = await createTrialBusiness(page);
  expect(signup.business.plan).toBe("EMPRENDEDOR");

  await page.goto("/negocio/#plan", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Plan y facturación" })).toBeVisible();
  await expect(page.locator(".plan-name")).toContainText("Plan Conecta");
  // Billing is unconfigured in this stack: the 503/404 fallback keeps the wave-1 request form.
  const fallback = page.getByTestId("billing-unavailable");
  await expect(fallback).toContainText("El pago con tarjeta estará disponible pronto");
  await expect(
    fallback.getByRole("button", { name: "Enviar solicitud", exact: true }),
  ).toBeVisible();
  await expect(fallback.getByLabel("Plan", { exact: true })).toBeVisible();
  await expect(page.getByTestId("plan-status")).toContainText("Prueba gratis de Conecta");
  expect(await page.getByTestId("plan-picker").count()).toBe(0);
  expect(await page.getByRole("button", { name: /^Pagar con tarjeta/ }).count()).toBe(0);
  // The trial banner is still there and its CTA keeps the request form.
  await expect(page.getByTestId("trial-banner")).toContainText("prueba gratis con Conecta");

  // Returning from a payment page never breaks the view when the API cannot confirm it.
  await page.goto("/negocio/?retorno=1#plan?checkout=chk_e2e_unknown&resultado=exito", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { level: 1, name: "Plan y facturación" })).toBeVisible();
  await expect(page.getByTestId("checkout-result")).toContainText("No pudimos consultar el pago");
  await expect(page).toHaveURL(/#plan$/);
  await expect(page.getByTestId("billing-unavailable")).toBeVisible();
});
