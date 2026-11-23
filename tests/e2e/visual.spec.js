import { test, expect } from "@playwright/test";

test.describe("Visual regression (chromium baseline)", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Visual snapshots are maintained on Chromium only.",
  );

  test.beforeEach(async ({ page, baseURL }) => {
    // Legacy screens request these same faces from Google. Keep visual evidence
    // independent of CDN availability, using PF's checked-in, licensed fonts.
    const fonts = new URL("/styles/fonts.css", baseURL).href;
    await page.route("https://fonts.googleapis.com/**", (route) =>
      route.fulfill({
        contentType: "text/css",
        body: `@import url("${fonts}");`,
      }),
    );
    await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
  });

  function token() {
    return Math.random().toString(36).slice(2, 8);
  }

  async function useRandomClientIp(page) {
    const ip = `10.240.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
    await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
  }

  async function expectLocalFonts(page) {
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [...document.fonts].some(
              (face) => face.family.includes("Inter") && face.status === "loaded",
            ),
          ),
        { message: "Use PF's checked-in Inter face rather than a fallback font" },
      )
      .toBe(true);
  }

  async function gotoStable(page, url, readySelector) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(readySelector, { state: "visible", timeout: 20_000 });
    await expectLocalFonts(page);
  }

  async function createBusinessAndOpenDashboard(page) {
    const t = token();
    await page.goto("/admin", { waitUntil: "domcontentloaded" });
    await page.fill("#businessName", `Cafe Visual ${t}`);
    await page.fill("#email", `owner-visual-${t}@example.com`);
    await page.fill("#password", "OrchardLanternMarble2026!");
    await page.click("#btnCreate");
    await expect(page.locator("#result")).toBeVisible();
    await page.goto("/admin-dashboard.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#main")).toBeVisible();
    await expect(page.getByText("Sin transacciones sospechosas.", { exact: true })).toHaveCount(1);
    await expectLocalFonts(page);
  }

  test("visual: super login shell", async ({ page }) => {
    await useRandomClientIp(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoStable(page, "/super", "#loginCard");
    await expect(page.locator("#loginCard")).toHaveScreenshot("super-login-desktop.png", {
      animations: "disabled",
    });
  });

  test("visual: super login mobile", async ({ page }) => {
    await useRandomClientIp(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoStable(page, "/super", "#loginCard");
    await expect(page.locator("#loginCard")).toHaveScreenshot("super-login-mobile.png", {
      animations: "disabled",
    });
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
    await expect(page.locator("#planes")).toBeVisible();
    await expect(page.locator("#planMatrix h3")).toHaveCount(3);
    await expect(page.locator("#negocios")).toBeVisible();
    await expect(page.locator("#toast")).toBeHidden();
    await expect(page.locator("#planes")).toHaveScreenshot("super-dashboard-plans-desktop.png", {
      animations: "disabled",
    });
  });

  test("visual: admin dashboard shell desktop", async ({ page }) => {
    await useRandomClientIp(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await createBusinessAndOpenDashboard(page);
    await page.locator(".admin-program-disclosure > summary").click();
    await expect(page.locator("#ownerConfigCard")).toHaveScreenshot("admin-dashboard-desktop.png", {
      animations: "disabled",
      mask: [page.locator("#businessName")],
    });
  });

  test("visual: admin dashboard shell mobile", async ({ page }) => {
    await useRandomClientIp(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await createBusinessAndOpenDashboard(page);
    await page.locator(".admin-program-disclosure > summary").click();
    await expect(page.locator("#ownerConfigCard")).toHaveScreenshot("admin-dashboard-mobile.png", {
      animations: "disabled",
      mask: [page.locator("#businessName")],
    });
  });
});
