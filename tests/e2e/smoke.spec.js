import { test, expect } from "@playwright/test";

async function useRandomClientIp(page) {
  const ip = `10.200.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
}

test("homepage loads and exposes join CTA", async ({ page }) => {
  await useRandomClientIp(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Convierte clientes en fans/i);
  await expect(page.getByRole("link", { name: "Crear cuenta" })).toBeVisible();
});

test("staff login page loads", async ({ page }) => {
  await useRandomClientIp(page);
  await page.goto("/staff/login");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Staff|personal|Ingreso|Inicia/i);
  await expect(page.locator("input[type='email']")).toBeVisible();
});

test("customer page loads without server error", async ({ page }) => {
  await useRandomClientIp(page);
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err?.message || err)));
  await page.goto("/c");
  await expect(page.locator("body")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
