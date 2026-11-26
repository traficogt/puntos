import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://privatrack.com/**", (route) => route.fulfill({ body: "" }));
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({ body: "", contentType: "application/javascript" }),
  );
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
    name: "Ana López",
    business: "Café de prueba",
    contact: "ana@example.com",
    message: "Organizar el programa de lealtad.\n\nContexto operativo: 2 sucursales",
    turnstileToken: "test-verification-token",
  });
});

test("hero offers the free trial first and the demo second; the FAQ explains the trial", async ({
  page,
}) => {
  await page.goto("/?sw=off", { waitUntil: "domcontentloaded" });
  const hero = page.locator(".marketing-hero");
  await expect(hero.getByRole("link", { name: "Prueba gratis 14 días" })).toHaveAttribute(
    "href",
    "/prueba/",
  );
  await expect(hero.getByRole("link", { name: "Ver la demo" })).toHaveAttribute(
    "href",
    "/demostracion/",
  );
  await expect(hero).toContainText("Sin tarjeta para empezar");
  await page.getByText("¿Puedo probarlo gratis antes de contratar?", { exact: true }).click();
  await expect(page.locator("#preguntas")).toContainText("14 días");
  await expect(page.locator("#preguntas a[href='/prueba/']")).toBeVisible();
});

test("pricing page publishes the quetzal prices with USD alongside and the trial call to action even without the plans API", async ({
  page,
}) => {
  await page.route("**/api/public/plans", (route) =>
    route.fulfill({ status: 404, json: { error: "Not found" } }),
  );
  await page.goto("/precios?sw=off", { waitUntil: "domcontentloaded" });
  const pricing = page.locator("#planes");
  for (const amount of ["Q300", "Q630", "Q1,030"])
    await expect(pricing.getByText(amount, { exact: true })).toBeVisible();
  for (const amount of ["USD 39", "USD 79", "USD 129"])
    await expect(pricing.getByText(`${amount} fuera de Guatemala`, { exact: true })).toBeVisible();
  await expect(pricing).toContainText("Precios con IVA (12 %) incluido");
  await expect(page.locator("main")).not.toContainText("sin impuestos");
  await expect(pricing.getByRole("link", { name: "Prueba 14 días gratis" })).toHaveAttribute(
    "href",
    "/prueba/",
  );
  await expect(pricing.getByRole("link", { name: "Empezar con Impulsa" })).toHaveAttribute(
    "href",
    "/prueba/?plan=NEGOCIO",
  );
  await expect(pricing).toContainText("IVA (12 %)");
  await expect(page.locator("main")).not.toContainText("en revisión");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("pricing page re-renders published prices from the plans API", async ({ page }) => {
  await page.route("**/api/public/plans", (route) =>
    route.fulfill({
      json: {
        pricing_status: "published",
        comparison_currency: "USD",
        local_currency: "GTQ",
        tax: { iva_included: true, rate: 0.12 },
        plans: [
          {
            id: "EMPRENDEDOR",
            name: "Conecta",
            pricing: { currency: "USD", per: "branch_month", monthly: 41, gtq_monthly: 320 },
            limits: { activeCustomers: 300, branches: 1, rewards: 5 },
            features: { rewards: true, staff_management: true, analytics: false },
          },
        ],
      },
    }),
  );
  await page.goto("/precios?sw=off", { waitUntil: "domcontentloaded" });
  const conecta = page.locator('[data-plan="EMPRENDEDOR"]');
  await expect(conecta.getByText("Q320", { exact: true })).toBeVisible();
  await expect(conecta.getByText("USD 41 fuera de Guatemala", { exact: true })).toBeVisible();
  await expect(conecta).not.toContainText("Referencia");
  await expect(
    page.locator('[data-plan="NEGOCIO"]').getByText("Q630", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-plan="NEGOCIO"]').getByText("USD 79 fuera de Guatemala", { exact: true }),
  ).toBeVisible();
});

test("mobile navigation and FAQ work without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?sw=off", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Hablar con nosotros", exact: true }).first().click();
  await expect(page).toHaveURL(/#contacto$/);
  await page.getByText("¿Mis clientes tienen que descargar una app?", { exact: true }).click();
  await expect(page.locator("#preguntas details").first()).toContainText("desde el navegador");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("content and demo request remain visible without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(`${test.info().project.use.baseURL}/?sw=off`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#contactForm")).toBeVisible();
  await expect(page.locator("#contacto h2")).toBeVisible();
  await expect(page.locator("#contactSubmit")).toBeDisabled();
  await expect(page.locator("#tu-negocio")).toContainText("Una muestra de lo que puedes hacer");
  await expect(page.locator("#tu-negocio a[href='/precios']")).toBeVisible();
  await context.close();
});

test("selected capabilities open the matching interactive example", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?sw=off", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Funciones", exact: true }).click();
  await expect(page).toHaveURL(/#tu-negocio$/);
  const section = page.locator("#tu-negocio");
  await expect(section).toContainText("Estas son cinco de sus funciones");
  await expect(section).toContainText("dependen del plan");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(section.getByRole("link", { name: "Explora más funciones" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await section
    .getByRole("link", { name: "Explorar Recuperar clientes en la demostración" })
    .click();
  await expect(page).toHaveURL(/\/demostracion\/(?:\?vista=libre)?#recuperar-clientes$/);
  await expect(
    page.getByRole("heading", { name: "Recuperar clientes", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Vista previa · datos de ejemplo", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
