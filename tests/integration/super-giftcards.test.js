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

integrationDescribe("Super + Gift Cards Integration", () => {
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

  it("toggles plan feature and enforces gift card permissions", async () => {
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

    const plans = await request("/api/super/plans", { headers: { Cookie: superCookie } });
    assert.equal(plans.status, 200);
    const emprendedor = (plans.data?.plans || []).find((p) => p.plan === "EMPRENDEDOR");
    assert.ok(emprendedor, "expected EMPRENDEDOR plan");
    const featurePatch = { ...(emprendedor.features || {}), gift_cards: true };
    const updateFeatures = await request("/api/super/plans/EMPRENDEDOR/features", {
      method: "PUT",
      headers: { Cookie: superCookie },
      body: JSON.stringify({ features: featurePatch })
    });
    assert.equal(updateFeatures.status, 200);

    const rand = Math.random().toString(36).slice(2, 9);
    const ownerEmail = `owner-${rand}@example.com`;
    const managerEmail = `manager-${rand}@example.com`;
    const cashierEmail = `cashier-${rand}@example.com`;
    const defaultPassword = `Pwd-${rand}1234`;

    const createdBusiness = await request("/api/super/businesses", {
      method: "POST",
      headers: { Cookie: superCookie },
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

    const impersonate = await request(`/api/super/impersonate/${encodeURIComponent(businessId)}`, {
      method: "POST",
      headers: { Cookie: superCookie },
      body: "{}"
    });
    assert.equal(impersonate.status, 200);
    const ownerCookie = cookieFrom(impersonate.response, "pf_staff");
    assert.ok(ownerCookie, "expected owner staff cookie after impersonation");

    const planInfo = await request("/api/admin/plan", { headers: { Cookie: ownerCookie } });
    assert.equal(planInfo.status, 200);
    assert.equal(Boolean(planInfo.data?.features?.gift_cards), true);

    const createManager = await request(`/api/super/businesses/${encodeURIComponent(businessId)}/users`, {
      method: "POST",
      headers: { Cookie: superCookie },
      body: JSON.stringify({
        name: "Manager Test",
        email: managerEmail,
        password: defaultPassword,
        role: "MANAGER",
        can_manage_gift_cards: true
      })
    });
    assert.equal(createManager.status, 201);

    const createCashier = await request(`/api/super/businesses/${encodeURIComponent(businessId)}/users`, {
      method: "POST",
      headers: { Cookie: superCookie },
      body: JSON.stringify({
        name: "Cashier Test",
        email: cashierEmail,
        password: defaultPassword,
        role: "CASHIER",
        can_manage_gift_cards: false
      })
    });
    assert.equal(createCashier.status, 201);

    const managerLogin = await request("/api/staff/login", {
      method: "POST",
      body: JSON.stringify({ email: managerEmail, password: defaultPassword })
    });
    assert.equal(managerLogin.status, 200);
    const managerCookie = cookieFrom(managerLogin.response, "pf_staff");
    assert.ok(managerCookie, "expected manager cookie");

    const managerCreateGiftCard = await request("/api/admin/gift-cards", {
      method: "POST",
      headers: { Cookie: managerCookie },
      body: JSON.stringify({ amount_q: 25, issued_to_name: "Cliente Test" })
    });
    assert.equal(managerCreateGiftCard.status, 201);
    assert.ok(managerCreateGiftCard.data?.gift_card?.code);

    const cashierLogin = await request("/api/staff/login", {
      method: "POST",
      body: JSON.stringify({ email: cashierEmail, password: defaultPassword })
    });
    assert.equal(cashierLogin.status, 200);
    const cashierCookie = cookieFrom(cashierLogin.response, "pf_staff");
    assert.ok(cashierCookie, "expected cashier cookie");

    const cashierCreateGiftCard = await request("/api/admin/gift-cards", {
      method: "POST",
      headers: { Cookie: cashierCookie },
      body: JSON.stringify({ amount_q: 25 })
    });
    assert.equal(cashierCreateGiftCard.status, 403);
  });
});
