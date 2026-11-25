import { test, expect } from "@playwright/test";

async function useClientIp(page) {
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `10.219.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`,
  });
}

// The owner dashboard is the merchant app (/negocio/); web/merchant/src/api.js owns the cross-tab
// logout epoch (pf_staff_epoch / pf_staff_logout_pending) that the retired vanilla dashboard shared.
test("owner logout hides both merchant tabs offline and revokes the session on reconnect", async ({
  page,
  context,
}) => {
  await useClientIp(page);
  const token = globalThis.crypto.randomUUID();
  const signup = await page.request.post("/api/admin/signup", {
    data: {
      businessName: `Logout ${token}`,
      email: `logout-${token}@example.com`,
      password: "OrchardLanternMarble2026!",
      program_type: "SPEND",
      ...(process.env.SIGNUP_CAPTCHA_SECRET
        ? { captcha_token: process.env.SIGNUP_CAPTCHA_SECRET }
        : {}),
    },
  });
  expect(signup.ok()).toBeTruthy();
  const nav = (tab) => tab.locator('nav[aria-label="Tu negocio"]');
  await page.goto("/negocio/", { waitUntil: "domcontentloaded" });
  await expect(nav(page)).toBeVisible();
  const sibling = await context.newPage();
  await sibling.goto("/negocio/", { waitUntil: "domcontentloaded" });
  await expect(nav(sibling)).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await expect(nav(page)).toBeHidden();
  await expect(page.getByRole("heading", { name: "Ingresa a tu negocio" })).toBeVisible();
  await expect(nav(sibling)).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("pf_staff_logout_pending")))
    .toBe("1");
  // Retrying while offline says so instead of claiming success.
  await page.getByRole("button", { name: "Completar cierre de sesión", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo cerrar la sesión");

  const revoked = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes("/api/staff/logout"),
  );
  await context.setOffline(false);
  expect([200, 401]).toContain((await revoked).status());
  await page.waitForURL(/\/equipo\/ingresar\//);
  expect((await page.request.get("/api/staff/me")).status()).toBe(401);
  expect(await page.evaluate(() => localStorage.getItem("pf_staff_logout_pending"))).toBeNull();
});

test("super logout hides both tabs offline and revokes the session on reconnect", async ({
  page,
  context,
}) => {
  const email = process.env.SUPER_ADMIN_EMAIL || "";
  const password = process.env.SUPER_ADMIN_PASSWORD || "";
  test.skip(!email || !password, "Isolated super credentials are required");
  await useClientIp(page);
  await page.goto("/super", { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#btnLogin").click();
  await expect(page.locator("#planes")).toBeVisible();
  const sibling = await context.newPage();
  await sibling.goto("/super", { waitUntil: "domcontentloaded" });
  await expect(sibling.locator("#planes")).toBeVisible();

  await context.setOffline(true);
  await page.locator("#btnLogout").click();
  await expect(page.locator("#planes")).toBeHidden();
  await expect(page.locator("#seguridad")).toBeHidden();
  await expect(page.locator("#negocios")).toBeHidden();
  await expect(page.locator("#salud")).toBeHidden();
  await expect(sibling.locator("#planes")).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("pf_super_logout_pending")))
    .toBe("1");
  await expect(page.locator("#toast")).toContainText("No se pudo cerrar");

  const revoked = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes("/api/super/logout"),
  );
  await context.setOffline(false);
  expect([200, 401]).toContain((await revoked).status());
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("pf_super_logout_pending")))
    .toBeNull();
  expect((await page.request.get("/api/super/me")).status()).toBe(401);
});
