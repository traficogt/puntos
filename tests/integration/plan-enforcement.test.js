import { describe, it } from "node:test";
import assert from "node:assert/strict";

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

integrationDescribe("Plan enforcement regression", () => {
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

  it("returns PLAN_FEATURE_LOCKED for disabled premium endpoints", async () => {
    if (!superEmail || !superPassword) {
      throw new Error("SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD are required for this integration test");
    }

    const superJar = new Map();

    const login = await request(superJar, "/api/super/login", {
      method: "POST",
      body: JSON.stringify({ email: superEmail, password: superPassword })
    });
    assert.equal(login.status, 200);
    assert.ok(superJar.get("__Host-pf_super"), "expected super auth cookie");

    const rand = Math.random().toString(36).slice(2, 9);
    const ownerEmail = `owner-lock-${rand}@example.com`;
    const password = "OrchardLanternMarble2026!";
    const createdBusiness = await request(superJar, "/api/super/businesses", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        businessName: `Cafe Lock ${rand}`,
        email: ownerEmail,
        password,
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
    assert.ok(superJar.get("__Host-pf_staff"), "expected owner staff cookie");

    const planInfo = await request(superJar, "/api/admin/plan");
    assert.equal(planInfo.status, 200);
    const features = planInfo.data?.features || {};

    const checks = [
      { feature: "analytics", method: "GET", path: "/api/admin/rfm?days=30" },
      { feature: "campaign_rules", method: "GET", path: "/api/admin/campaign-rules" },
      { feature: "external_awards", method: "GET", path: "/api/admin/external-awards" },
      { feature: "lifecycle_automation", method: "GET", path: "/api/admin/automations" },
      { feature: "fraud_monitoring", method: "GET", path: "/api/admin/awards/suspicious" }
    ];

    const lockedChecks = checks.filter((c) => features[c.feature] === false);
    if (!lockedChecks.length) {
      // Environment may override all features to true; do not fail in that case.
      return;
    }

    for (const c of lockedChecks) {
      const out = await request(superJar, c.path, { method: c.method });
      assert.equal(out.status, 403, `expected 403 for ${c.feature}`);
      assert.equal(out.data?.code, "PLAN_FEATURE_LOCKED", `expected PLAN_FEATURE_LOCKED code for ${c.feature}`);
    }
  });
});
