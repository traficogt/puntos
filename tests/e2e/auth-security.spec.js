import { test, expect } from "@playwright/test";
import { totp } from "../../src/utils/totp.js";

test.describe.configure({ mode: "serial" });

function rand(len = 6) {
  return Math.random().toString(36).slice(2, 2 + len);
}

async function useRandomClientIp(page) {
  const ip = `10.213.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
  return ip;
}

async function createBusinessForAuthFlow(page, clientIp) {
  const token = rand(8);
  const businessName = `Cafe AUTH ${token}`;
  const email = `owner-auth-${token}@example.com`;
  const password = "OrchardLanternMarble2026!";
  const resp = await page.request.post("/api/admin/signup", {
    headers: {
      ...(clientIp ? { "x-forwarded-for": clientIp } : {}),
      ...(process.env.SIGNUP_CAPTCHA_SECRET
        ? { "x-signup-captcha": process.env.SIGNUP_CAPTCHA_SECRET }
        : {})
    },
    data: {
      businessName,
      email,
      password,
      category: "cafe",
      program_type: "SPEND",
      ...(process.env.SIGNUP_CAPTCHA_SECRET
        ? { captcha_token: process.env.SIGNUP_CAPTCHA_SECRET }
        : {})
    }
  });
  expect(resp.ok(), `admin signup should succeed: ${await resp.text()}`).toBeTruthy();
  const body = await resp.json();
  const slug = String(body?.business?.slug || "");
  expect(slug).toBeTruthy();
  return { slug, businessName, email, password };
}

async function loginStaffViaUi(page, { email, password, mfaCode = "" }) {
  await page.goto("/staff/login?sw=off", { waitUntil: "networkidle" });
  await expect(page.locator("#btnLogin")).toBeVisible();
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.fill("#mfaCode", mfaCode);
  const loginReq = page.waitForRequest((req) =>
    req.method() === "POST" && req.url().includes("/api/staff/login")
  );
  const loginResp = page.waitForResponse((resp) =>
    resp.request().method() === "POST" && resp.url().includes("/api/staff/login")
  );
  await page.click("#btnLogin");
  const req = await loginReq;
  const resp = await loginResp;
  if (!resp.ok()) {
    throw new Error(`staff login failed: ${resp.status()} payload=${req.postData() || ""} body=${await resp.text()}`);
  }
  return resp;
}

test("staff login page exposes recovery and MFA controls", async ({ page }) => {
  await useRandomClientIp(page);
  await page.goto("/staff/login?sw=off");

  await expect(page.locator("#mfaCode")).toBeVisible();
  await expect(page.locator("#btnRequestReset")).toBeVisible();
  await expect(page.locator("#btnConfirmReset")).toBeVisible();
  await expect(page.locator("#btnConfirmEmailChange")).toBeVisible();
});

test("staff can enable MFA through UI and use it on next login", async ({ page }) => {
  const clientIp = await useRandomClientIp(page);
  const out = await createBusinessForAuthFlow(page, clientIp);

  await loginStaffViaUi(page, out);
  await page.goto("/staff?sw=off");
  await expect(page.locator("#btnStaffReauth")).toBeVisible();

  await page.fill("#staffReauthPassword", out.password);
  const reauthResp = page.waitForResponse((resp) =>
    resp.request().method() === "POST" && resp.url().includes("/api/staff/security/reauth")
  );
  await page.click("#btnStaffReauth");
  expect((await reauthResp).ok()).toBeTruthy();

  const enrollResp = page.waitForResponse((resp) =>
    resp.request().method() === "POST" && resp.url().includes("/api/staff/security/mfa/enroll")
  );
  await page.click("#btnStaffMfaEnroll");
  expect((await enrollResp).ok()).toBeTruthy();

  const secretText = await page.locator("#staffMfaSecret").textContent();
  const match = String(secretText || "").match(/Secreto:\s*([A-Z2-7]+)/);
  expect(match, "staff MFA secret should be rendered").toBeTruthy();
  const secret = String(match[1]);

  await page.fill("#staffMfaConfirmCode", totp(secret));
  const confirmResp = page.waitForResponse((resp) =>
    resp.request().method() === "POST" && resp.url().includes("/api/staff/security/mfa/confirm")
  );
  await page.click("#btnStaffMfaConfirm");
  expect((await confirmResp).ok()).toBeTruthy();

  const logoutResp = page.waitForResponse((resp) =>
    resp.request().method() === "POST" && resp.url().includes("/api/staff/logout")
  );
  await page.click("#btnLogout");
  expect((await logoutResp).ok()).toBeTruthy();

  await page.goto("/staff/login?sw=off");
  await page.fill("#email", out.email);
  await page.fill("#password", out.password);
  const failedLogin = page.waitForResponse((resp) =>
    resp.request().method() === "POST" && resp.url().includes("/api/staff/login")
  );
  await page.click("#btnLogin");
  expect((await failedLogin).status()).toBe(401);

  await loginStaffViaUi(page, { ...out, mfaCode: totp(secret) });

  await page.goto("/staff?sw=off");
  await page.fill("#staffReauthPassword", out.password);
  await page.fill("#staffReauthMfaCode", totp(secret));
  const reauthWithMfaResp = page.waitForResponse((resp) =>
    resp.request().method() === "POST" && resp.url().includes("/api/staff/security/reauth")
  );
  await page.click("#btnStaffReauth");
  expect((await reauthWithMfaResp).ok()).toBeTruthy();

  const disableResp = page.waitForResponse((resp) =>
    resp.request().method() === "POST" && resp.url().includes("/api/staff/security/mfa/disable")
  );
  await page.click("#btnStaffMfaDisable");
  expect((await disableResp).ok()).toBeTruthy();
});

test("super page exposes recovery controls and security actions", async ({ page }) => {
  await useRandomClientIp(page);
  await page.goto("/super?sw=off");

  await expect(page.locator("#loginMfaCode")).toBeVisible();
  await expect(page.locator("#btnRequestSuperReset")).toBeVisible();
  await expect(page.locator("#btnConfirmSuperReset")).toBeVisible();
  await expect(page.locator("#btnConfirmSuperEmail")).toBeVisible();
});

test("super can use MFA controls through UI when credentials are configured", async ({ page }) => {
  const email = process.env.SUPER_ADMIN_EMAIL || "";
  const password = process.env.SUPER_ADMIN_PASSWORD || "";
  test.skip(!email || !password, "SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required for super UI auth test");

  await useRandomClientIp(page);
  await page.goto("/super?sw=off");
  await page.fill("#email", email);
  await page.fill("#password", password);

  const loginResp = page.waitForResponse((resp) =>
    resp.request().method() === "POST" && resp.url().includes("/api/super/login")
  );
  await page.click("#btnLogin");
  expect((await loginResp).ok()).toBeTruthy();

  await expect(page.locator("#securityCard")).toBeVisible();
  await expect(page.locator("#btnSuperReauth")).toBeVisible();
  await expect(page.locator("#btnSuperMfaEnroll")).toBeVisible();
  await expect(page.locator("#btnSuperMfaDisable")).toBeVisible();
  await expect(page.locator("#btnSuperEmailChange")).toBeVisible();
  await expect(page.locator("#btnSuperLockdown")).toBeVisible();
});
