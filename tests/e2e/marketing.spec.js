import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://privatrack.com/**", (route) => route.fulfill({ body: "" }));
  await page.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({ body: "", contentType: "application/javascript" }));
});

test("loyalty demonstration earns a reward and can restart", async ({ page }) => {
  await page.goto("/?sw=off", { waitUntil: "domcontentloaded" });
  const demo = page.getByRole("region", { name: "Prueba una tarjeta de lealtad" });
  await expect(demo.getByText("340", { exact: true })).toBeVisible();
  await demo.getByRole("button", { name: "Simular una visita" }).click();
  await expect(demo.getByText("380", { exact: true })).toBeVisible();
  await demo.getByRole("button", { name: "Simular una visita" }).click();
  await expect(demo.getByText("420", { exact: true })).toBeVisible();
  await expect(demo.getByRole("status")).toContainText("recompensa");
  await demo.getByRole("button", { name: "Volver a probar" }).click();
  await expect(demo.getByText("340", { exact: true })).toBeVisible();
});

test("demo request validates missing fields and submits existing payload", async ({ page }) => {
  await page.goto("/?sw=off", { waitUntil: "domcontentloaded" });
  await page.locator("#contactSubmit").click();
  await expect(page.locator("#cfName")).toBeFocused();
  await expect(page.locator("#contactStatus")).toContainText("nombre");
  await page.getByLabel("Nombre", { exact: true }).fill("Ana López");
  await page.getByLabel("Negocio", { exact: true }).fill("Café de prueba");
  await page.getByLabel("Correo o teléfono").fill("ana@example.com");
  await page.getByLabel("Sucursales o puntos de atención").fill("2 sucursales");
  await page.getByLabel("¿Qué quieres resolver?").fill("Organizar el programa de lealtad.");
  await page.locator("#contactSubmit").click();
  await expect(page.locator("#contactStatus")).toContainText("verificación");
  await page.locator("#contactForm").evaluate((form) => {
    const token = document.createElement("input");
    token.type = "hidden";
    token.name = "cf-turnstile-response";
    token.value = "test-verification-token";
    form.append(token);
  });
  /** @type {Record<string, unknown>|null} */
  let submitted = null;
  await page.route("**/api/public/contact", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true } });
  });
  await page.locator("#contactSubmit").click();
  await expect(page.locator("#contactStatus")).toContainText("Recibimos tu solicitud");
  expect(submitted).toEqual({
    name: "Ana López", business: "Café de prueba", contact: "ana@example.com",
    message: "Organizar el programa de lealtad.\n\nContexto operativo: 2 sucursales",
    turnstileToken: "test-verification-token"
  });
});

test("mobile navigation and FAQ work without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?sw=off", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Solicitar demo", exact: true }).first().click();
  await expect(page).toHaveURL(/#contacto$/);
  await page.getByText("¿Mis clientes tienen que descargar una app?", { exact: true }).click();
  await expect(page.locator("#preguntas details").first()).toContainText("desde el navegador");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("content and demo request remain visible without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${test.info().project.use.baseURL}/?sw=off`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#contactForm")).toBeVisible();
  await expect(page.locator("#contacto h2")).toBeVisible();
  await expect(page.locator("#contactSubmit")).toBeDisabled();
  await context.close();
});
