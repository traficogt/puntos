import { test, expect } from "@playwright/test";
import { apiPost, expectOk } from "./lib.js";

test.describe.configure({ mode: "serial" });

function rand(len = 6) {
  return Math.random().toString(36).slice(2, 2 + len);
}

async function useRandomClientIp(page) {
  const ip = `10.211.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
}

async function createBusinessViaUi(page) {
  const token = rand(8);
  const businessName = `Cafe ADV ${token}`;
  const email = `owner-adv-${token}@example.com`;
  const password = `Pwd-ADV-${token}1234`;
  await page.goto("/admin");
  await page.fill("#businessName", businessName);
  await page.fill("#email", email);
  await page.fill("#password", password);
  const signupRespPromise = page.waitForResponse((resp) =>
    resp.request().method() === "POST" && resp.url().includes("/api/admin/signup")
  );
  await page.click("#btnCreate");
  const signupResp = await signupRespPromise;
  expect(signupResp.ok(), "admin signup should succeed").toBeTruthy();
  await expect(page.locator("#result")).toBeVisible();
  const slug = (await page.locator("#slug").textContent())?.trim();
  expect(slug).toBeTruthy();
  return { slug, email, password };
}

test("adversarial: same QR token cannot be replayed", async ({ page }) => {
  await useRandomClientIp(page);
  const out = await createBusinessViaUi(page);
  const phone = `5555${Math.floor(1000 + Math.random() * 8999)}`;

  await page.goto(`/join/${out.slug}`);
  await page.fill("#phone", phone);
  await page.fill("#name", "Cliente Replay");
  const reqCodeRespPromise = page.waitForResponse((resp) =>
    resp.request().method() === "POST" &&
    resp.url().includes(`/api/public/business/${out.slug}/join/request-code`)
  );
  await page.click("#btnCode");
  const reqCodeResp = await reqCodeRespPromise;
  const reqCodeBody = await reqCodeResp.json();
  const code = String(reqCodeBody?.dev_code || "");
  expect(code.length >= 4).toBeTruthy();
  await page.fill("#code", code);
  await page.click("#btnVerify");
  await page.waitForURL(/\/c$/);

  await page.goto("/staff/login");
  await page.fill("#email", out.email);
  await page.fill("#password", out.password);
  const loginRespPromise = page.waitForResponse((resp) =>
    resp.request().method() === "POST" && resp.url().includes("/api/staff/login")
  );
  await page.click("#btnLogin");
  const loginResp = await loginRespPromise;
  expect(loginResp.ok(), "staff login should succeed").toBeTruthy();
  await page.goto("/staff");
  await page.goto("/c");

  const qr = await apiPost(page, "/api/public/customer/qr", {}, { csrf: true });
  expectOk(qr, "qr token should be issued");
  const token = String(qr.body?.token || "");
  expect(token.length >= 20).toBeTruthy();

  const first = await apiPost(page, "/api/staff/award", { customerQrToken: token, amount_q: 12 }, { csrf: true });
  expectOk(first, "first award should succeed");

  const second = await apiPost(page, "/api/staff/award", { customerQrToken: token, amount_q: 12 }, { csrf: true });
  expect(second.status).toBe(409);
  expect(String(second.body?.error || "").toLowerCase()).toContain("already used");
});

test("adversarial: csrf is required for staff logout", async ({ page }) => {
  await useRandomClientIp(page);
  await createBusinessViaUi(page); // owner gets authenticated as staff

  const resp = await page.request.post("/api/staff/logout", {
    data: {}
  });
  expect(resp.status()).toBe(403);
  const body = await resp.json();
  expect(String(body?.error || "")).toContain("CSRF");
});

test("adversarial: super login endpoint rate-limits brute force attempts", async ({ page }) => {
  const ip = `10.212.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    const resp = await page.request.post("/api/super/login", {
      headers: { "x-forwarded-for": ip },
      data: { email: "bad@example.com", password: "bad-password-123" }
    });
    statuses.push(resp.status());
  }
  expect(statuses[5]).toBe(429);
});
