import { test, expect } from "@playwright/test";

async function useClientIp(page) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.219.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}` });
}

test("admin logout hides both tabs offline and revokes the session on reconnect", async ({ page, context }) => {
  await useClientIp(page);
  const token = globalThis.crypto.randomUUID();
  const signup = await page.request.post("/api/admin/signup", {
    data: {
      businessName: `Logout ${token}`,
      email: `logout-${token}@example.com`,
      password: "OrchardLanternMarble2026!",
      program_type: "SPEND",
      ...(process.env.SIGNUP_CAPTCHA_SECRET ? { captcha_token: process.env.SIGNUP_CAPTCHA_SECRET } : {})
    }
  });
  expect(signup.ok()).toBeTruthy();
  await page.goto("/admin-dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main")).toBeVisible();
  const sibling = await context.newPage();
  await sibling.goto("/admin-dashboard", { waitUntil: "domcontentloaded" });
  await expect(sibling.locator("#main")).toBeVisible();

  await context.setOffline(true);
  await page.locator("#btnLogout").click();
  await expect(page.locator("#main")).toBeHidden();
  await expect(page.locator("#needLogin")).toBeVisible();
  await expect(sibling.locator("#main")).toBeHidden();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pf_staff_logout_pending"))).toBe("1");
  await expect(page.locator("#toast")).toContainText("No se pudo cerrar");

  const revoked = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/api/staff/logout"));
  await context.setOffline(false);
  expect([200, 401]).toContain((await revoked).status());
  await page.waitForURL(/\/staff\/login$/);
  expect((await page.request.get("/api/staff/me")).status()).toBe(401);
  expect(await page.evaluate(() => localStorage.getItem("pf_staff_logout_pending"))).toBeNull();
});

test("super logout hides both tabs offline and revokes the session on reconnect", async ({ page, context }) => {
  const email = process.env.SUPER_ADMIN_EMAIL || "";
  const password = process.env.SUPER_ADMIN_PASSWORD || "";
  test.skip(!email || !password, "Isolated super credentials are required");
  await useClientIp(page);
  await page.goto("/super", { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#btnLogin").click();
  await expect(page.locator("#mainCard")).toBeVisible();
  const sibling = await context.newPage();
  await sibling.goto("/super", { waitUntil: "domcontentloaded" });
  await expect(sibling.locator("#mainCard")).toBeVisible();

  await context.setOffline(true);
  await page.locator("#btnLogout").click();
  await expect(page.locator("#mainCard")).toBeHidden();
  await expect(page.locator("#securityCard")).toBeHidden();
  await expect(page.locator("#businessCard")).toBeHidden();
  await expect(sibling.locator("#mainCard")).toBeHidden();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pf_super_logout_pending"))).toBe("1");
  await expect(page.locator("#toast")).toContainText("No se pudo cerrar");

  const revoked = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/api/super/logout"));
  await context.setOffline(false);
  expect([200, 401]).toContain((await revoked).status());
  await expect.poll(() => page.evaluate(() => localStorage.getItem("pf_super_logout_pending"))).toBeNull();
  expect((await page.request.get("/api/super/me")).status()).toBe(401);
});
