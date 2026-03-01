import { test, expect } from "@playwright/test";

test.describe("Visual regression (chromium baseline)", () => {
test.skip(({ browserName }) => browserName !== "chromium", "Visual snapshots are maintained on Chromium only.");

function token() {
  return Math.random().toString(36).slice(2, 8);
}

async function useRandomClientIp(page) {
  const ip = `10.240.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
}

async function disableMotion(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; }
      html { scroll-behavior: auto !important; }
    `
  });
}

async function gotoStable(page, url, readySelector) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(readySelector, { state: "visible", timeout: 20_000 });
}

async function createBusinessAndOpenDashboard(page) {
  const t = token();
  await page.goto("/admin");
  await page.fill("#businessName", `Cafe Visual ${t}`);
  await page.fill("#email", `owner-visual-${t}@example.com`);
  await page.fill("#password", `Pwd-${t}1234`);
  await page.click("#btnCreate");
  await expect(page.locator("#result")).toBeVisible();
  await page.goto("/admin-dashboard.html");
  await expect(page.locator("#main")).toBeVisible();
}

test("visual: super login shell", async ({ page }) => {
  await useRandomClientIp(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoStable(page, "/super", "#loginCard");
  await disableMotion(page);
  await expect(page.locator("body")).toHaveScreenshot("super-login-desktop.png");
});

test("visual: super login mobile", async ({ page }) => {
  await useRandomClientIp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoStable(page, "/super", "#loginCard");
  await disableMotion(page);
  await expect(page.locator("body")).toHaveScreenshot("super-login-mobile.png");
});

test("visual: super dashboard logged-in", async ({ page }, _testInfo) => {
  const superEmail = process.env.SUPER_ADMIN_EMAIL || "";
  const superPassword = process.env.SUPER_ADMIN_PASSWORD || "";
  test.skip(!superEmail || !superPassword, "Missing SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD");

  await useRandomClientIp(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoStable(page, "/super", "#loginCard");
  await page.fill("#email", superEmail);
  await page.fill("#password", superPassword);
  await page.click("#btnLogin");
  await expect(page.locator("#mainCard")).toBeVisible();
  await expect(page.locator("#businessCard")).toBeVisible();
  await disableMotion(page);
  await expect(page.locator("#mainCard")).toHaveScreenshot("super-dashboard-maincard-desktop.png");
});

test("visual: admin dashboard shell desktop", async ({ page }) => {
  await useRandomClientIp(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await createBusinessAndOpenDashboard(page);
  await disableMotion(page);
  await expect(page.locator("#main")).toHaveScreenshot("admin-dashboard-desktop.png", {
    mask: [page.locator("#businessName")]
  });
});

test("visual: admin dashboard shell mobile", async ({ page }) => {
  await useRandomClientIp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await createBusinessAndOpenDashboard(page);
  await disableMotion(page);
  await expect(page.locator("#main")).toHaveScreenshot("admin-dashboard-mobile.png", {
    // Allow tiny anti-alias/layout variance on mobile rendering in CI.
    maxDiffPixels: 300,
    mask: [page.locator("#businessName")]
  });
});
});
