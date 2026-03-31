import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const runIntegration = process.env.RUN_INTEGRATION === "true";
const integrationDescribe = runIntegration ? describe : describe.skip;

function applySetCookieJar(jar, response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  for (const raw of values) {
    const first = String(raw || "").split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    jar.set(first.slice(0, eq), first.slice(eq + 1));
  }
}

function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
}

function csrfTokenFromJar(jar) {
  return jar.get("pf_csrf_readable") || "";
}

integrationDescribe("Super + Gift Cards Integration", () => {
  const baseUrl = process.env.TEST_API_URL || "http://localhost:3001";
  const browserOrigin = new URL(baseUrl).origin;
  const superEmail = process.env.SUPER_ADMIN_EMAIL;
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;

  async function request(jar, path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    const cookie = cookieHeader(jar);
    if (cookie) headers.Cookie = cookie;
    if (options.csrf) {
      headers["X-CSRF-Token"] = csrfTokenFromJar(jar);
      headers.Origin ??= browserOrigin;
      headers.Referer ??= `${browserOrigin}/`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers
    });
    applySetCookieJar(jar, response);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { response, data, status: response.status };
  }

  it("toggles plan feature and enforces gift card permissions", async () => {
    if (!superEmail || !superPassword) {
      throw new Error("SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD are required for this integration test");
    }

    const superJar = new Map();
    const managerJar = new Map();
    const cashierJar = new Map();

    const login = await request(superJar, "/api/super/login", {
      method: "POST",
      body: JSON.stringify({ email: superEmail, password: superPassword })
    });
    assert.equal(login.status, 200);
    assert.ok(superJar.get("__Host-pf_super"), "expected super auth cookie");

    const plans = await request(superJar, "/api/super/plans");
    assert.equal(plans.status, 200);
    const emprendedor = (plans.data?.plans || []).find((p) => p.plan === "EMPRENDEDOR");
    assert.ok(emprendedor, "expected EMPRENDEDOR plan");
    const featurePatch = { ...(emprendedor.features || {}), gift_cards: true };
    const updateFeatures = await request(superJar, "/api/super/plans/EMPRENDEDOR/features", {
      method: "PUT",
      csrf: true,
      body: JSON.stringify({ features: featurePatch })
    });
    assert.equal(updateFeatures.status, 200);

    const rand = Math.random().toString(36).slice(2, 9);
    const ownerEmail = `owner-${rand}@example.com`;
    const managerEmail = `manager-${rand}@example.com`;
    const cashierEmail = `cashier-${rand}@example.com`;
    const defaultPassword = "OrchardLanternMarble2026!";

    const createdBusiness = await request(superJar, "/api/super/businesses", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        businessName: `Cafe Test ${rand}`,
        email: ownerEmail,
        password: defaultPassword,
        category: "cafe",
        plan: "EMPRENDEDOR"
      })
    });
    assert.equal(createdBusiness.status, 201);
    const businessId = createdBusiness.data?.business?.id;
    assert.ok(businessId, "expected business id");

    const impersonate = await request(superJar, `/api/super/impersonate/${encodeURIComponent(businessId)}`, {
      method: "POST",
      csrf: true,
      body: "{}"
    });
    assert.equal(impersonate.status, 200);
    assert.ok(superJar.get("__Host-pf_staff"), "expected owner staff cookie after impersonation");

    const planInfo = await request(superJar, "/api/admin/plan");
    assert.equal(planInfo.status, 200);
    assert.equal(Boolean(planInfo.data?.features?.gift_cards), true);

    const createManager = await request(superJar, `/api/super/businesses/${encodeURIComponent(businessId)}/users`, {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        name: "Manager Test",
        email: managerEmail,
        password: defaultPassword,
        role: "MANAGER",
        can_manage_gift_cards: true
      })
    });
    assert.equal(createManager.status, 201);

    const createCashier = await request(superJar, `/api/super/businesses/${encodeURIComponent(businessId)}/users`, {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        name: "Cashier Test",
        email: cashierEmail,
        password: defaultPassword,
        role: "CASHIER",
        can_manage_gift_cards: false
      })
    });
    assert.equal(createCashier.status, 201);

    const managerLogin = await request(managerJar, "/api/staff/login", {
      method: "POST",
      body: JSON.stringify({ email: managerEmail, password: defaultPassword })
    });
    assert.equal(managerLogin.status, 200);
    assert.ok(managerJar.get("__Host-pf_staff"), "expected manager cookie");

    const managerCreateGiftCard = await request(managerJar, "/api/admin/gift-cards", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        amount_q: 25,
        issued_to_name: "Cliente Test",
        requestId: crypto.randomUUID()
      })
    });
    assert.equal(managerCreateGiftCard.status, 201);
    assert.ok(managerCreateGiftCard.data?.gift_card?.code);

    const cashierLogin = await request(cashierJar, "/api/staff/login", {
      method: "POST",
      body: JSON.stringify({ email: cashierEmail, password: defaultPassword })
    });
    assert.equal(cashierLogin.status, 200);
    assert.ok(cashierJar.get("__Host-pf_staff"), "expected cashier cookie");

    const cashierCreateGiftCard = await request(cashierJar, "/api/admin/gift-cards", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({ amount_q: 25, requestId: crypto.randomUUID() })
    });
    assert.equal(cashierCreateGiftCard.status, 403);
  });
});
