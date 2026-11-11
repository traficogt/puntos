import { test, expect } from "@playwright/test";

async function useRandomClientIp(page) {
  const ip = `10.200.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
}

test("homepage loads and exposes the demo CTA", async ({ page }) => {
  await useRandomClientIp(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/se repite/i);
  const demoLink = page.locator(".marketing-hero").getByRole("link", { name: "Probar la demo", exact: true });
  await expect(demoLink).toBeVisible();
  await expect(demoLink).toHaveAttribute("href", "/demostracion/");
});

test("homepage styles are applied", async ({ page }) => {
  await useRandomClientIp(page);
  await page.goto("/?sw=off", { waitUntil: "domcontentloaded" });

  const styles = await page.evaluate(() => ({
    pageBg: getComputedStyle(document.documentElement).backgroundColor,
    h1Font: getComputedStyle(document.querySelector("h1")).fontFamily,
    heroDisplay: getComputedStyle(document.querySelector(".marketing-hero")).display
  }));

  expect(styles.pageBg).toBe("rgb(247, 245, 239)");
  expect(styles.h1Font).toContain("Fraunces");
  expect(styles.heroDisplay).toBe("grid");
});

test("staff login page loads", async ({ page }) => {
  await useRandomClientIp(page);
  await page.goto("/staff/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bienvenido a tu negocio");
  await expect(page.locator("#email")).toBeVisible();
});

test("customer page loads without server error", async ({ page }) => {
  await useRandomClientIp(page);
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err?.message || err)));
  await page.goto("/c", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("logged-out customer page shows the entry shell", async ({ page, context }) => {
  await context.clearCookies();
  await useRandomClientIp(page);
  await page.goto("/c", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#needLogin")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/tarjeta digital vive aqui|tu tarjeta/i);
  await expect(page.locator(".cus-entry-note")).toContainText("enlace de acceso");
});

test("logged-out admin dashboard shows the access gate", async ({ page, context }) => {
  await context.clearCookies();
  await useRandomClientIp(page);
  await page.goto("/admin-dashboard.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#needLogin")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Acceso denegado/i);
  await expect(page.getByRole("link", { name: /Ir a ingreso/i })).toBeVisible();
});
