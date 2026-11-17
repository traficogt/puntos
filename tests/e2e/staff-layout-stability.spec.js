import { test, expect } from "@playwright/test";

// Sections that load after the staff screen opens (shift briefing, protected
// benefits, service cases, operations) sit above the account-security card.
// While someone is looking at or pressing a control below them, their content
// must not push that control away: a shift between press and release turns a
// click into nothing.

function rand(len = 8) {
  return Math.random().toString(36).slice(2, 2 + len);
}

async function staffSession(page) {
  const ip = `10.214.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
  const token = rand();
  const email = `owner-layout-${token}@example.com`;
  const password = "OrchardLanternMarble2026!";
  const signup = await page.request.post("/api/admin/signup", {
    headers: {
      "x-forwarded-for": ip,
      ...(process.env.SIGNUP_CAPTCHA_SECRET ? { "x-signup-captcha": process.env.SIGNUP_CAPTCHA_SECRET } : {})
    },
    data: {
      businessName: `Cafe LAYOUT ${token}`,
      email,
      password,
      category: "cafe",
      program_type: "SPEND",
      ...(process.env.SIGNUP_CAPTCHA_SECRET ? { captcha_token: process.env.SIGNUP_CAPTCHA_SECRET } : {})
    }
  });
  expect(signup.ok(), `admin signup should succeed: ${await signup.text()}`).toBeTruthy();
  await page.goto("/staff/login?sw=off", { waitUntil: "domcontentloaded" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  const login = page.waitForResponse((resp) => resp.request().method() === "POST" && resp.url().includes("/api/staff/login"));
  await page.click("#btnLogin");
  expect((await login).ok()).toBeTruthy();
  await page.waitForURL((url) => url.pathname === "/negocio/");
}

/**
 * Someone scrolls to a field and starts using it as soon as the screen opens;
 * returns the viewport position of a nearby control until the screen settles.
 */
async function trackWhileLoading(page, fieldSelector, controlSelector) {
  await page.goto("/staff?sw=off", { waitUntil: "domcontentloaded" });
  await page.evaluate(([fieldSel, sel]) => {
    const field = document.querySelector(fieldSel);
    const target = document.querySelector(sel);
    field.scrollIntoView({ block: "center" });
    field.focus({ preventScroll: true });
    // Sample after each layout change, once the page has corrected it: this
    // observer is created after the page's, so it runs after it in each frame.
    const samples = [];
    /** @type {any} */ (window).__layoutSamples = samples;
    const sample = () => samples.push(Math.round(target.getBoundingClientRect().top));
    sample();
    new ResizeObserver(sample).observe(document.body);
  }, [fieldSelector, controlSelector]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(750);
  return page.evaluate((sel) => {
    const samples = /** @type {any} */ (window).__layoutSamples;
    samples.push(Math.round(document.querySelector(sel).getBoundingClientRect().top));
    return samples;
  }, controlSelector);
}

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`staff account-security controls stay in place for someone using them while the screen loads (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await staffSession(page);
    const samples = await trackWhileLoading(page, "#staffReauthPassword", "#btnStaffReauth");
    const moved = Math.max(...samples) - Math.min(...samples);
    expect(moved, `button top over time: ${[...new Set(samples)].join(", ")}`).toBeLessThanOrEqual(2);
  });
}
