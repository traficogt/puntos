import crypto from "node:crypto";
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

function cloneJar(jar) {
  return new Map(jar);
}

integrationDescribe("Gift card idempotency integration", () => {
  const baseUrl = process.env.TEST_API_URL || "http://localhost:3001";
  const browserOrigin = new URL(baseUrl).origin;
  const superEmail = process.env.SUPER_ADMIN_EMAIL;
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;
  const forwardedFor = process.env.TEST_CLIENT_IP
    || `198.51.100.${Math.max(10, Math.floor(Math.random() * 200))}`;

  async function request(jar, path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      "X-Forwarded-For": forwardedFor,
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

  it("deduplicates gift card create and redeem requests by requestId", async () => {
    if (!superEmail || !superPassword) {
      throw new Error("SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD are required for this integration test");
    }

    const superJar = new Map();
    const managerJar = new Map();

    const login = await request(superJar, "/api/super/login", {
      method: "POST",
      body: JSON.stringify({ email: superEmail, password: superPassword })
    });
    assert.equal(login.status, 200);

    const rand = Math.random().toString(36).slice(2, 9);
    const ownerEmail = `owner-gc-${rand}@example.com`;
    const managerEmail = `manager-gc-${rand}@example.com`;
    const defaultPassword = "OrchardLanternMarble2026!";

    const createdBusiness = await request(superJar, "/api/super/businesses", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        businessName: `Cafe GC ${rand}`,
        email: ownerEmail,
        password: defaultPassword,
        category: "cafe",
        plan: "EMPRESA"
      })
    });
    assert.equal(createdBusiness.status, 201);
    const businessId = createdBusiness.data?.business?.id;
    assert.ok(businessId);

    const createManager = await request(superJar, `/api/super/businesses/${encodeURIComponent(businessId)}/users`, {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        name: "Manager Gift",
        email: managerEmail,
        password: defaultPassword,
        role: "MANAGER",
        can_manage_gift_cards: true
      })
    });
    assert.equal(createManager.status, 201);

    const managerLogin = await request(managerJar, "/api/staff/login", {
      method: "POST",
      body: JSON.stringify({ email: managerEmail, password: defaultPassword })
    });
    assert.equal(managerLogin.status, 200);

    const createRequestId = crypto.randomUUID();
    const createPayload = JSON.stringify({
      amount_q: 25,
      issued_to_name: "Cliente GC",
      requestId: createRequestId
    });
    const [createA, createB] = await Promise.all([
      request(cloneJar(managerJar), "/api/admin/gift-cards", {
        method: "POST",
        csrf: true,
        body: createPayload
      }),
      request(cloneJar(managerJar), "/api/admin/gift-cards", {
        method: "POST",
        csrf: true,
        body: createPayload
      })
    ]);
    assert.equal(createA.status, 201);
    assert.equal(createB.status, 201);
    assert.equal(createA.data?.gift_card?.id, createB.data?.gift_card?.id);
    assert.equal(createA.data?.gift_card?.code, createB.data?.gift_card?.code);

    const code = createA.data?.gift_card?.code;
    assert.ok(code);

    const redeemRequestId = crypto.randomUUID();
    const redeemPayload = JSON.stringify({
      code_or_token: code,
      amount_q: 10,
      requestId: redeemRequestId
    });
    const [redeemA, redeemB] = await Promise.all([
      request(cloneJar(managerJar), "/api/staff/gift-cards/redeem", {
        method: "POST",
        csrf: true,
        body: redeemPayload
      }),
      request(cloneJar(managerJar), "/api/staff/gift-cards/redeem", {
        method: "POST",
        csrf: true,
        body: redeemPayload
      })
    ]);
    assert.equal(redeemA.status, 200);
    assert.equal(redeemB.status, 200);
    assert.equal(Number(redeemA.data?.gift_card?.balance_q), 15);
    assert.equal(Number(redeemB.data?.gift_card?.balance_q), 15);

    const details = await request(managerJar, `/api/staff/gift-cards/${encodeURIComponent(code)}`);
    assert.equal(details.status, 200);
    const tx = details.data?.transactions || [];
    const issueTx = tx.filter((row) => row.tx_type === "ISSUE");
    const redeemTx = tx.filter((row) => row.tx_type === "REDEEM");
    assert.equal(issueTx.length, 1);
    assert.equal(redeemTx.length, 1);
    assert.equal(Number(details.data?.card?.balance_q), 15);
  });
});
