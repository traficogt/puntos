import { test, expect } from "@playwright/test";

async function useRandomClientIp(page) {
  const ip = `10.200.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
}

test("homepage loads and exposes join CTA", async ({ page }) => {
  await useRandomClientIp(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/experiencia de lealtad/i);
  await expect(page.getByRole("link", { name: "Abrir programa" })).toBeVisible();
});

test("homepage styles are applied", async ({ page }) => {
  await useRandomClientIp(page);
  await page.goto("/?sw=off");

  const styles = await page.evaluate(() => ({
    bodyBgImage: getComputedStyle(document.body).backgroundImage,
    h1Font: getComputedStyle(document.querySelector("h1")).fontFamily,
    heroDisplay: getComputedStyle(document.querySelector(".marketing-hero")).display
  }));

  expect(styles.bodyBgImage).toContain("gradient");
  expect(styles.h1Font).toContain("Iowan Old Style");
  expect(styles.heroDisplay).toBe("grid");
});

test("staff login page loads", async ({ page }) => {
  await useRandomClientIp(page);
  await page.goto("/staff/login");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Staff|personal|Ingreso|Inicia/i);
  await expect(page.locator("#email")).toBeVisible();
});

test("customer page loads without server error", async ({ page }) => {
  await useRandomClientIp(page);
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err?.message || err)));
  await page.goto("/c");
  await expect(page.locator("body")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("logged-out customer page shows the entry shell", async ({ page, context }) => {
  await context.clearCookies();
  await useRandomClientIp(page);
  await page.goto("/c");

  await expect(page.locator("#needLogin")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/tarjeta digital vive aqui|tu tarjeta/i);
  await expect(page.getByRole("button", { name: /Ir a registro/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ingresar/i })).toBeVisible();
});

test("logged-out admin dashboard shows the access gate", async ({ page, context }) => {
  await context.clearCookies();
  await useRandomClientIp(page);
  await page.goto("/admin-dashboard.html");

  await expect(page.locator("#needLogin")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Acceso denegado/i);
  await expect(page.getByRole("link", { name: /Ir a ingreso/i })).toBeVisible();
});
