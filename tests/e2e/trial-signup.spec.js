import { test, expect } from "@playwright/test";

// Self-serve trial signup at /prueba/ (docs/product/2026-11-25-self-serve-trial.md §4.1). The
// page is exercised against the real server; the trial API is mocked so the spec pins the
// documented request bodies and the hand-off without sending SMS or creating businesses.
test.use({ serviceWorkers: "block" });

test.beforeEach(async ({ page }) => {
  await page.route("https://privatrack.com/**", (route) => route.fulfill({ body: "" }));
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({ body: "", contentType: "application/javascript" }),
  );
});

test("the signup verifies the phone, posts the documented bodies and hands off to /negocio/", async ({
  page,
}) => {
  /** @type {Record<string, unknown>} */
  const posted = {};
  await page.route("**/api/public/trial/config", (route) =>
    route.fulfill({ json: { challengeRequired: false, siteKey: "" } }),
  );
  await page.route("**/api/public/trial/request-code", async (route) => {
    posted.request = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/public/trial/verify", async (route) => {
    posted.verify = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, grant: "grant-e2e" } });
  });
  await page.route("**/api/public/trial/signup", async (route) => {
    posted.signup = route.request().postDataJSON();
    await route.fulfill({
      json: { ok: true, business: { id: "b-e2e", slug: "cafe-e2e", name: "Café E2E" } },
    });
  });
  await page.route("**/negocio/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html lang='es'><title>Panel</title><h1>Panel de prueba</h1></html>",
    }),
  );
  await page.goto("/prueba/?plan=NEGOCIO", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Crea tu programa");
  await expect(page.locator("#trialPlanNote")).toContainText("Impulsa");
  await page.getByLabel("Nombre del negocio").fill("Café E2E");
  await page.getByLabel("Tu nombre (opcional)").fill("Ana");
  await page.getByLabel("Correo para entrar a tu panel").fill("owner-e2e@example.com");
  await page.getByLabel("Contraseña", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("#trialDatosFeedback")).toContainText("caracteres");
  await expect(page.getByLabel("Contraseña", { exact: true })).toBeFocused();
  await page.getByLabel("Contraseña", { exact: true }).fill("OrchardLanternMarble2026!");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Verifica tu teléfono" })).toBeVisible();
  await page.getByRole("textbox", { name: "Teléfono" }).fill("5555 1234");
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(page.getByRole("heading", { name: "Escribe el código" })).toBeVisible();
  await expect(page.locator("#verificationPhone")).toContainText("1234");
  expect(posted.request).toEqual({ phone: "50255551234" });
  await page.getByLabel("Código de 6 dígitos").fill("123456");
  await page.getByRole("button", { name: "Verificar y crear mi negocio" }).click();
  await expect(page).toHaveURL(/\/negocio\/$/);
  expect(posted.verify).toEqual({ phone: "50255551234", code: "123456" });
  expect(posted.signup).toEqual({
    grant: "grant-e2e",
    businessName: "Café E2E",
    email: "owner-e2e@example.com",
    password: "OrchardLanternMarble2026!",
    category: "otro",
    ownerName: "Ana",
  });
});

test("a server without the trial API explains it in Spanish and keeps the contact path", async ({
  page,
}) => {
  for (const path of ["config", "request-code"])
    await page.route(`**/api/public/trial/${path}`, (route) =>
      route.fulfill({ status: 404, json: { error: "Not found" } }),
    );
  await page.route("**/api/public/support/config", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/prueba/", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Nombre del negocio").fill("Café E2E");
  await page.getByLabel("Correo para entrar a tu panel").fill("owner-e2e@example.com");
  await page.getByLabel("Contraseña", { exact: true }).fill("OrchardLanternMarble2026!");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("textbox", { name: "Teléfono" }).fill("55551234");
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(page.locator("#trialPhoneFeedback")).toContainText("todavía no está disponible");
  await expect(page.locator("#trialUnavailable a[href='/#contacto']")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
