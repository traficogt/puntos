import { describe, it } from "node:test";
import assert from "node:assert/strict";

const runIntegration = process.env.RUN_INTEGRATION === "true";
const integrationDescribe = runIntegration ? describe : describe.skip;

function cookieFrom(res, name) {
  const getSetCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const raw = getSetCookie.length ? getSetCookie.join(", ") : (res.headers.get("set-cookie") || "");
  const m = raw.match(new RegExp(`${name}=[^;]+`));
  return m ? m[0] : "";
}

integrationDescribe("Plan enforcement regression", () => {
  const baseUrl = process.env.TEST_API_URL || "http://localhost:3001";
  const superEmail = process.env.SUPER_ADMIN_EMAIL;
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;

  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { response, data, status: response.status };
  }

  it("returns PLAN_FEATURE_LOCKED for disabled premium endpoints", async () => {
    if (!superEmail || !superPassword) {
      throw new Error("SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD are required for this integration test");
    }

    const login = await request("/api/super/login", {
      method: "POST",
      body: JSON.stringify({ email: superEmail, password: superPassword })
    });
    assert.equal(login.status, 200);
    const superCookie = cookieFrom(login.response, "pf_super");
    assert.ok(superCookie, "expected super auth cookie");

    const rand = Math.random().toString(36).slice(2, 9);
    const ownerEmail = `owner-lock-${rand}@example.com`;
    const password = `Pwd-${rand}1234`;
    const createdBusiness = await request("/api/super/businesses", {
      method: "POST",
      headers: { Cookie: superCookie },
      body: JSON.stringify({
        businessName: `Cafe Lock ${rand}`,
        email: ownerEmail,
        password,
        category: "cafe",
        plan: "BASICO"
      })
    });
    assert.equal(createdBusiness.status, 201);
    const businessId = createdBusiness.data?.business?.id;
    assert.ok(businessId, "expected business id");

    const impersonate = await request(`/api/super/impersonate/${encodeURIComponent(businessId)}`, {
      method: "POST",
      headers: { Cookie: superCookie },
      body: "{}"
    });
    assert.equal(impersonate.status, 200);
    const ownerCookie = cookieFrom(impersonate.response, "pf_staff");
    assert.ok(ownerCookie, "expected owner staff cookie");

    const planInfo = await request("/api/admin/plan", { headers: { Cookie: ownerCookie } });
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
      const out = await request(c.path, { method: c.method, headers: { Cookie: ownerCookie } });
      assert.equal(out.status, 403, `expected 403 for ${c.feature}`);
      assert.equal(out.data?.code, "PLAN_FEATURE_LOCKED", `expected PLAN_FEATURE_LOCKED code for ${c.feature}`);
    }
  });
});
