import { test, expect } from "@playwright/test";
import { apiGet, apiPost, apiPut, expectOk } from "./lib.js";
test.describe.configure({ mode: "serial" });

function rand(len = 6) {
  return Math.random().toString(36).slice(2, 2 + len);
}

async function useRandomClientIp(page) {
  const ip = `10.210.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
}

async function createBusinessViaUi(page) {
  const token = rand(8);
  const businessName = `Cafe E2E ${token}`;
  const email = `owner-${token}@example.com`;
  const password = `Pwd-${token}1234`;
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
  return { slug, businessName, email, password };
}

test("owner can onboard business and create reward in dashboard", async ({ page }) => {
  await useRandomClientIp(page);
  await createBusinessViaUi(page);

  await page.goto("/admin-dashboard.html");
  await expect(page.locator("#main")).toBeVisible();

  const rewardName = `Promo ${rand(5)}`;
  await page.fill("#rewardName", rewardName);
  await page.fill("#rewardDescription", "Promo creada por test E2E");
  await page.fill("#rewardPointsCost", "75");
  await page.click("#btnCreateReward");

  await expect(page.locator("#rewardsList")).toContainText(rewardName);
});

test("customer can join business with OTP and open card", async ({ page }) => {
  await useRandomClientIp(page);
  const out = await createBusinessViaUi(page);
  const phone = `5555${Math.floor(1000 + Math.random() * 8999)}`;

  await page.goto(`/join/${out.slug}`);
  await page.fill("#phone", phone);
  await page.fill("#name", "Cliente E2E");
  const reqCodeRespPromise = page.waitForResponse((resp) =>
    resp.request().method() === "POST" &&
    resp.url().includes(`/api/public/business/${out.slug}/join/request-code`)
  );
  await page.click("#btnCode");
  const reqCodeResp = await reqCodeRespPromise;
  const reqCodeBody = await reqCodeResp.json();
  const code = String(reqCodeBody?.dev_code || "");
  expect(code.length >= 4, "No se recibio dev_code; revisa MESSAGE_PROVIDER=dev para este entorno e2e").toBeTruthy();

  await page.fill("#code", code);
  await page.click("#btnVerify");

  await page.waitForURL(/\/c$/);
  await expect(page.locator("#main")).toBeVisible();
  await expect(page.locator("#bizName")).toContainText(out.businessName);
});

test("staff can award points using customer QR token", async ({ page }) => {
  await useRandomClientIp(page);
  const out = await createBusinessViaUi(page);
  const phone = `5555${Math.floor(1000 + Math.random() * 8999)}`;

  await page.goto(`/join/${out.slug}`);
  await page.fill("#phone", phone);
  await page.fill("#name", "Cliente Premio");
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

  const before = await apiGet(page, "/api/customer/me");
  expectOk(before, "customer me should succeed");

  const award = await apiPost(page, "/api/staff/award", { customerQrToken: token, amount_q: 50 }, { csrf: true });
  expectOk(award, "award should succeed");

  const after = await apiGet(page, "/api/customer/me");
  expectOk(after, "customer me should succeed");

  const result = { before: before.body?.customer?.points, after: after.body?.customer?.points, award: award.body };

  expect(result.award?.ok).toBeTruthy();
  expect(Number(result.after)).toBeGreaterThanOrEqual(Number(result.before));
});

test("admin dashboard tab visibility matches plan features", async ({ page }) => {
  await useRandomClientIp(page);
  await createBusinessViaUi(page);
  await page.goto("/admin-dashboard.html");
  await expect(page.locator("#main")).toBeVisible();

  const plan = await apiGet(page, "/api/admin/plan");
  expectOk(plan, "plan should be readable");

  const result = await page.evaluate((features) => {
    const mapping = {
      rewards: "rewards",
      tiers: "tiers",
      branches: "multi_branch",
      staff: "staff_management",
      giftcards: "gift_cards",
      achievements: "gamification",
      challenges: "gamification",
      referrals: "referrals",
      analytics: "analytics"
    };
    const mismatches = [];
    for (const [tab, feature] of Object.entries(mapping)) {
      const el = document.querySelector(`.tab[data-tab=\"${tab}\"]`);
      if (!el) continue;
      const isVisible = getComputedStyle(el).display !== "none";
      const shouldBeVisible = Boolean(features?.[feature]);
      if (isVisible !== shouldBeVisible) mismatches.push({ tab, feature, isVisible, shouldBeVisible });
    }
    return { mismatches };
  }, plan.body?.features || {});

  expect(result.mismatches).toEqual([]);
});

test("staff can redeem reward for customer after points award", async ({ page }) => {
  await useRandomClientIp(page);
  const out = await createBusinessViaUi(page);
  const phone = `5555${Math.floor(1000 + Math.random() * 8999)}`;

  await page.goto(`/join/${out.slug}`);
  await page.fill("#phone", phone);
  await page.fill("#name", "Cliente Canje");
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

  const rewardName = `Canje ${rand(5)}`;
  const plan = await apiGet(page, "/api/admin/plan");
  expectOk(plan, "plan should be readable");
  if (!plan.body?.features?.rewards || !plan.body?.features?.redemptions) {
    test.skip(true, "Plan sin rewards/redemptions");
  }

  const createdReward = await apiPost(page, "/api/admin/rewards", {
    name: rewardName,
    description: "Reward E2E para canje",
    points_cost: 60
  }, { csrf: true });
  expectOk(createdReward, "reward should be created");
  const rewardId = String(createdReward.body?.reward?.id || "");
  expect(rewardId).toBeTruthy();

  const qr = await apiPost(page, "/api/public/customer/qr", {}, { csrf: true });
  expectOk(qr, "qr token should be issued");
  const token = String(qr.body?.token || "");
  expect(token.length >= 20).toBeTruthy();

  const before = await apiGet(page, "/api/customer/me");
  expectOk(before, "customer me should succeed");

  const award = await apiPost(page, "/api/staff/award", { customerQrToken: token, amount_q: 1000 }, { csrf: true });
  expectOk(award, "award should succeed");

  const redeem = await apiPost(page, "/api/staff/redeem", { customerId: before.body?.customer?.id, rewardId }, { csrf: true });
  expectOk(redeem, "redeem should succeed");

  const after = await apiGet(page, "/api/customer/me");
  expectOk(after, "customer me should succeed");

  const result = {
    beforePoints: before.body?.customer?.points,
    afterPoints: after.body?.customer?.points,
    redemptionCode: String(redeem.body?.redemptionCode || "")
  };

  expect(result.redemptionCode.length > 3).toBeTruthy();
  expect(Number(result.afterPoints)).toBeLessThan(Number(result.beforePoints) + 200);
});

test("admin can apply automation template from dashboard", async ({ page }) => {
  await useRandomClientIp(page);
  await createBusinessViaUi(page);
  await page.goto("/admin-dashboard.html");
  await expect(page.locator("#main")).toBeVisible();

  const plan = await apiGet(page, "/api/admin/plan");
  expectOk(plan, "plan should be readable");
  const lifecycleEnabled = Boolean(plan.body?.features?.lifecycle_automation);
  test.skip(!lifecycleEnabled, "Plan sin lifecycle_automation");

  await page.click("#btnTplReactivacion");
  await expect(page.locator("#lifecycleWinbackEnabled")).toBeChecked();
  await expect(page.locator("#lifecycleWinbackDays")).toHaveValue("21");
});

test("rbac: cashier cannot refund while manager can reach refund validation", async ({ page }) => {
  await useRandomClientIp(page);
  await createBusinessViaUi(page);
  await page.goto("/admin-dashboard.html");
  await expect(page.locator("#main")).toBeVisible();

  const plan = await apiGet(page, "/api/admin/plan");
  expectOk(plan, "plan should be readable");
  const canManageStaff = Boolean(plan.body?.features?.staff_management);
  test.skip(!canManageStaff, "Plan sin staff_management");

  const token = rand(7);
  const managerEmail = `mgr-rbac-${token}@example.com`;
  const cashierEmail = `cash-rbac-${token}@example.com`;
  const pwd = `Pwd-${token}1234`;

  const createdManager = await apiPost(page, "/api/admin/staff", {
    name: "Manager RBAC",
    email: managerEmail,
    password: pwd,
    role: "MANAGER"
  }, { csrf: true });
  expectOk(createdManager, "manager staff should be created");

  const createdCashier = await apiPost(page, "/api/admin/staff", {
    name: "Cashier RBAC",
    email: cashierEmail,
    password: pwd,
    role: "CASHIER"
  }, { csrf: true });
  expectOk(createdCashier, "cashier staff should be created");

  const postRefundAndGetStatus = async () => {
    const out = await apiPost(page, "/api/staff/refund", { transactionId: "00000000-0000-0000-0000-000000000000" }, { csrf: true });
    return out.status;
  };

  await page.goto("/staff/login");
  await page.fill("#email", managerEmail);
  await page.fill("#password", pwd);
  const mgrLoginRespPromise = page.waitForResponse((resp) =>
    resp.request().method() === "POST" && resp.url().includes("/api/staff/login")
  );
  await page.click("#btnLogin");
  const mgrLoginResp = await mgrLoginRespPromise;
  expect(mgrLoginResp.ok(), "manager login should succeed").toBeTruthy();
  await page.goto("/staff");
  const managerStatus = await postRefundAndGetStatus();

  const logout = await apiPost(page, "/api/staff/logout", {}, { csrf: true });
  expectOk(logout, "logout should succeed");

  await page.goto("/staff/login");
  await page.fill("#email", cashierEmail);
  await page.fill("#password", pwd);
  const cashLoginRespPromise = page.waitForResponse((resp) =>
    resp.request().method() === "POST" && resp.url().includes("/api/staff/login")
  );
  await page.click("#btnLogin");
  const cashLoginResp = await cashLoginRespPromise;
  expect(cashLoginResp.ok(), "cashier login should succeed").toBeTruthy();
  await page.goto("/staff");
  const cashierStatus = await postRefundAndGetStatus();

  expect(managerStatus).not.toBe(403);
  expect(cashierStatus).toBe(403);
});

test("super admin plan update is reflected in admin feature tabs", async ({ page }) => {
  const superEmail = process.env.SUPER_ADMIN_EMAIL || "";
  const superPassword = process.env.SUPER_ADMIN_PASSWORD || "";
  test.skip(!superEmail || !superPassword, "Faltan credenciales de super admin para e2e");

  await useRandomClientIp(page);
  await page.goto("/super");
  await page.fill("#email", superEmail);
  await page.fill("#password", superPassword);
  await page.click("#btnLogin");
  await expect(page.locator("#mainCard")).toBeVisible();

  const plansOut = await apiGet(page, "/api/super/plans");
  expectOk(plansOut, "super plans should be readable");
  const plans = Array.isArray(plansOut.body?.plans) ? plansOut.body.plans : [];
  test.skip((plans || []).length < 2, "Se requieren al menos 2 planes para validar cambio de plan");
  const lowPlan = plans[0]?.plan;
  const highPlan = plans[1]?.plan;
  const lowOrigFeatures = { ...(plans[0]?.features || {}) };
  const highOrigFeatures = { ...(plans[1]?.features || {}) };

  const lowForcedFeatures = { ...lowOrigFeatures, analytics: false };
  const highForcedFeatures = { ...highOrigFeatures, analytics: true };

  try {
    const lowSet = await apiPut(page, `/api/super/plans/${encodeURIComponent(lowPlan)}/features`, { features: lowForcedFeatures }, { csrf: true });
    expectOk(lowSet, "set low plan features should succeed");
    const highSet = await apiPut(page, `/api/super/plans/${encodeURIComponent(highPlan)}/features`, { features: highForcedFeatures }, { csrf: true });
    expectOk(highSet, "set high plan features should succeed");

    const token = rand(8);
    const createdOut = await apiPost(page, "/api/super/businesses", {
      businessName: `Cafe Plan ${token}`,
      email: `owner-plan-${token}@example.com`,
      password: `Pwd-${token}1234`,
      category: "cafe",
      plan: lowPlan
    }, { csrf: true });
    expectOk(createdOut, "create business should succeed");
    const created = createdOut.body?.business;
    expect(created?.id).toBeTruthy();

    const imp1 = await apiPost(page, `/api/super/impersonate/${encodeURIComponent(created.id)}`, {}, { csrf: true });
    expectOk(imp1, "impersonate should succeed");

    await page.goto("/admin-dashboard.html");
    await expect(page.locator("#main")).toBeVisible();
    const analyticsVisibleLow = await page.locator('.tab[data-tab="analytics"]').isVisible();

    await page.goto("/super");
    const upPlan = await apiPut(page, `/api/super/businesses/${encodeURIComponent(created.id)}/plan`, { plan: highPlan }, { csrf: true });
    expectOk(upPlan, "update business plan should succeed");
    const imp2 = await apiPost(page, `/api/super/impersonate/${encodeURIComponent(created.id)}`, {}, { csrf: true });
    expectOk(imp2, "impersonate should succeed");

    await page.goto("/admin-dashboard.html");
    await expect(page.locator("#main")).toBeVisible();
    const analyticsVisibleHigh = await page.locator('.tab[data-tab="analytics"]').isVisible();

    expect(analyticsVisibleLow).toBeFalsy();
    expect(analyticsVisibleHigh).toBeTruthy();
  } finally {
    try {
      if (!page.isClosed()) {
        await page.goto("/super");
        await apiPut(page, `/api/super/plans/${encodeURIComponent(lowPlan)}/features`, { features: lowOrigFeatures }, { csrf: true });
        await apiPut(page, `/api/super/plans/${encodeURIComponent(highPlan)}/features`, { features: highOrigFeatures }, { csrf: true });
      }
    } catch {
      // Cleanup failure should not mask the core assertion result.
    }
  }
});

test("gift cards enforce role permissions (manager/cashier)", async ({ page }) => {
  const superEmail = process.env.SUPER_ADMIN_EMAIL || "";
  const superPassword = process.env.SUPER_ADMIN_PASSWORD || "";
  test.skip(!superEmail || !superPassword, "Faltan credenciales de super admin para e2e");

  await useRandomClientIp(page);
  await page.goto("/super");
  await page.fill("#email", superEmail);
  await page.fill("#password", superPassword);
  await page.click("#btnLogin");
  await expect(page.locator("#mainCard")).toBeVisible();

  const plansOut = await apiGet(page, "/api/super/plans");
  expectOk(plansOut, "super plans should be readable");
  const plans = Array.isArray(plansOut.body?.plans) ? plansOut.body.plans : [];
  const planWithGiftCards = plans.find((p) => Boolean(p?.features?.gift_cards));
  test.skip(!planWithGiftCards, "No hay plan con gift_cards habilitado");
  const plan = planWithGiftCards.plan;

  const token = rand(8);
  const ownerEmail = `owner-gc-${token}@example.com`;
  const managerEmail = `manager-gc-${token}@example.com`;
  const cashierNoEmail = `cashier-no-${token}@example.com`;
  const cashierYesEmail = `cashier-yes-${token}@example.com`;
  const pwd = `Pwd-${token}1234`;

  const createdOut = await apiPost(page, "/api/super/businesses", {
    businessName: `Cafe GC ${token}`,
    email: ownerEmail,
    password: pwd,
    category: "cafe",
    plan
  }, { csrf: true });
  expectOk(createdOut, "create business should succeed");
  const created = createdOut.body?.business;
  expect(created?.id).toBeTruthy();

  const mkUser = async (email, role, canManage) => {
    const out = await apiPost(page, `/api/super/businesses/${encodeURIComponent(created.id)}/users`, {
      name: email.split("@")[0],
      email,
      password: pwd,
      role,
      can_manage_gift_cards: canManage
    }, { csrf: true });
    expectOk(out, `create staff user should succeed: ${email}`);
  };
  await mkUser(managerEmail, "MANAGER", true);
  await mkUser(cashierNoEmail, "CASHIER", false);
  await mkUser(cashierYesEmail, "CASHIER", true);

  const login = async (email) => {
    const out = await apiPost(page, "/api/staff/login", { email, password: pwd }, { csrf: false });
    expectOk(out, `staff login should succeed: ${email}`);
  };
  const tryCreate = async () => {
    const out = await apiPost(page, "/api/admin/gift-cards", { amount_q: 25, issued_to_name: "E2E" }, { csrf: true });
    if (out.ok) {
      return { ok: true, code: out.body?.gift_card?.code || "", token: out.body?.gift_card?.qr_token || "" };
    }
    return { ok: false, error: `status ${out.status}: ${JSON.stringify(out.body)}` };
  };
  const tryRedeem = async (codeOrToken, amount) => {
    const out = await apiPost(page, "/api/staff/gift-cards/redeem", { code_or_token: codeOrToken, amount_q: amount }, { csrf: true });
    if (out.ok) {
      return { ok: true, balance: Number(out.body?.gift_card?.balance_q || 0) };
    }
    return { ok: false, error: `status ${out.status}: ${JSON.stringify(out.body)}` };
  };

  await login(managerEmail);
  const managerCreate = await tryCreate();
  const cardCode = managerCreate.code;

  await login(cashierNoEmail);
  const cashierNoCreate = await tryCreate();
  const cashierNoRedeem = await tryRedeem(cardCode, 5);

  await login(cashierYesEmail);
  const cashierYesCreate = await tryCreate();
  const cashierYesRedeem = await tryRedeem(cardCode, 5);

  const matrix = { managerCreate, cashierNoCreate, cashierNoRedeem, cashierYesCreate, cashierYesRedeem };

  expect(matrix.managerCreate.ok, `manager create failed: ${matrix.managerCreate.error || "unknown"}`).toBeTruthy();
  expect(matrix.cashierNoCreate.ok).toBeFalsy();
  expect(matrix.cashierNoRedeem.ok).toBeFalsy();
  expect(matrix.cashierYesCreate.ok).toBeFalsy();
  expect(matrix.cashierYesRedeem.ok).toBeTruthy();
});

test("suspicious awards are flagged when guard threshold is exceeded", async ({ page }) => {
  await useRandomClientIp(page);
  const out = await createBusinessViaUi(page);
  const phone = `5555${Math.floor(1000 + Math.random() * 8999)}`;

  await page.goto("/admin-dashboard.html");
  await expect(page.locator("#main")).toBeVisible();

  const plan = await apiGet(page, "/api/admin/plan");
  expectOk(plan, "plan should be readable");
  const gates = {
    programRules: Boolean(plan.body?.features?.program_rules),
    fraudMonitoring: Boolean(plan.body?.features?.fraud_monitoring)
  };
  test.skip(!gates.programRules || !gates.fraudMonitoring, "Plan sin program_rules o fraud_monitoring");

  await page.fill("#guardSuspiciousAmount", "1");
  await page.fill("#guardSuspiciousPoints", "1");
  await page.click("#btnSaveProgram");

  await page.goto(`/join/${out.slug}`);
  await page.fill("#phone", phone);
  await page.fill("#name", "Cliente Alerta");
  const reqCodeRespPromise = page.waitForResponse((resp) =>
    resp.request().method() === "POST" &&
    resp.url().includes(`/api/public/business/${out.slug}/join/request-code`)
  );
  await page.click("#btnCode");
  const reqCodeResp = await reqCodeRespPromise;
  const code = String((await reqCodeResp.json())?.dev_code || "");
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

  const qr = await apiPost(page, "/api/public/customer/qr", {}, { csrf: true });
  expectOk(qr, "qr token should be issued");
  const token = String(qr.body?.token || "");
  expect(token.length >= 20).toBeTruthy();

  const award = await apiPost(page, "/api/staff/award", { customerQrToken: token, amount_q: 5 }, { csrf: true });
  expectOk(award, "award should succeed");

  const suspiciousOut = await apiGet(page, "/api/admin/awards/suspicious?limit=20");
  expectOk(suspiciousOut, "suspicious awards should be readable");
  const suspicious = Array.isArray(suspiciousOut.body?.awards) ? suspiciousOut.body.awards : [];
  expect(Array.isArray(suspicious) && suspicious.length > 0).toBeTruthy();
  const hasFlag = suspicious.some((a) => Boolean(a?.guard?.suspicious));
  expect(hasFlag).toBeTruthy();
});

test("customer export works (if enabled) and delete disables profile access", async ({ page }) => {
  await useRandomClientIp(page);
  const out = await createBusinessViaUi(page);
  const phone = `5555${Math.floor(1000 + Math.random() * 8999)}`;

  await page.goto(`/join/${out.slug}`);
  await page.fill("#phone", phone);
  await page.fill("#name", "Cliente Privacidad");
  const reqCodeRespPromise = page.waitForResponse((resp) =>
    resp.request().method() === "POST" &&
    resp.url().includes(`/api/public/business/${out.slug}/join/request-code`)
  );
  await page.click("#btnCode");
  const reqCodeResp = await reqCodeRespPromise;
  const code = String((await reqCodeResp.json())?.dev_code || "");
  expect(code.length >= 4).toBeTruthy();
  await page.fill("#code", code);
  await page.click("#btnVerify");
  await page.waitForURL(/\/c$/);

  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const csrf = cookies.find((c) => c.name === "pf_csrf_readable")?.value || "";

  const req = async (method, path, body = undefined) => {
    const doFetch = async () => {
      const headers = {
        cookie: cookieHeader,
        "content-type": "application/json",
        "x-forwarded-for": `10.220.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`
      };
      if (method !== "GET" && method !== "HEAD" && csrf) headers["x-csrf-token"] = csrf;
      const resp = await page.request.fetch(path, {
        method,
        headers,
        data: body
      });
      let json = null;
      try { json = await resp.json(); } catch {}
      return { status: resp.status(), json };
    };
    const first = await doFetch();
    if (first.status !== 429) return first;
    await page.waitForTimeout(1200);
    return doFetch();
  };

  const exportResp = await req("GET", "/api/customer/export");
  if (exportResp.status !== 403) {
    expect(exportResp.status).toBe(200);
    expect(Boolean(exportResp.json?.customer?.id)).toBeTruthy();
  }

  const deleteResp = await req("DELETE", "/api/customer/me", {});
  expect(deleteResp.status).toBe(200);

  const meAfterDelete = await req("GET", "/api/customer/me");
  expect([401, 404]).toContain(meAfterDelete.status);
});
