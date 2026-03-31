import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { resolveJoinCode } from "./_support/dev-join-code.js";

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

async function waitFor(check, { timeoutMs = 8000, intervalMs = 250 } = {}) {
  const start = Date.now();
  let lastError = null;
  while ((Date.now() - start) < timeoutMs) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (lastError) throw lastError;
  throw new Error("Timed out waiting for condition");
}

integrationDescribe("Refund + Gamification Integration", () => {
  const baseUrl = process.env.TEST_API_URL || "http://localhost:3001";
  const browserOrigin = new URL(baseUrl).origin;
  const superEmail = process.env.SUPER_ADMIN_EMAIL;
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;

  function createAdminClient() {
    return new pg.Client({
      host: process.env.TEST_DB_HOST || process.env.DB_HOST || "localhost",
      port: Number(process.env.TEST_DB_PORT || process.env.DB_PORT || 5432),
      database: process.env.TEST_DB_NAME || process.env.DB_NAME || "puntos",
      user: process.env.TEST_DB_USER || process.env.DB_MIGRATIONS_USER || process.env.DB_USER || "postgres",
      password: process.env.TEST_DB_PASSWORD || process.env.DB_MIGRATIONS_PASSWORD || process.env.DB_PASSWORD || ""
    });
  }

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

  it("reverses earned achievements and challenge rewards when the qualifying purchase is refunded", async () => {
    if (!superEmail || !superPassword) {
      throw new Error("SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD are required for this integration test");
    }

    const db = createAdminClient();
    await db.connect();

    try {
      const superJar = new Map();
      const ownerJar = new Map();
      const customerJar = new Map();

    const superLogin = await request(superJar, "/api/super/login", {
      method: "POST",
      body: JSON.stringify({ email: superEmail, password: superPassword })
    });
    assert.equal(superLogin.status, 200);

    const rand = Math.random().toString(36).slice(2, 9);
    const ownerEmail = `owner-gamify-${rand}@example.com`;
    const password = "OrchardLanternMarble2026!";

    const createdBusiness = await request(superJar, "/api/super/businesses", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        businessName: `Gamify Refund ${rand}`,
        email: ownerEmail,
        password,
        category: "cafe",
        plan: "EMPRESA"
      })
    });
    assert.equal(createdBusiness.status, 201);
    const businessId = createdBusiness.data?.business?.id;
    const businessSlug = createdBusiness.data?.business?.slug;
    assert.ok(businessId, "expected business id");
    assert.ok(businessSlug, "expected business slug");

    const impersonate = await request(superJar, `/api/super/impersonate/${encodeURIComponent(businessId)}`, {
      method: "POST",
      csrf: true,
      body: "{}"
    });
    assert.equal(impersonate.status, 200);
    for (const [key, value] of superJar.entries()) {
      if (key.startsWith("__Host-pf_staff") || key.startsWith("pf_csrf")) ownerJar.set(key, value);
    }

    const createAchievement = await request(ownerJar, "/api/admin/achievements", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        name: `Q50 spender ${rand}`,
        requirement_type: "spend",
        requirement_value: 50,
        points_reward: 7,
        active: true
      })
    });
    assert.equal(createAchievement.status, 201);

    const createChallenge = await request(ownerJar, "/api/admin/challenges", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        name: `5 point push ${rand}`,
        description: "Single-purchase challenge",
        challenge_type: "milestone",
        requirement_type: "points",
        requirement_value: 5,
        reward_points: 3,
        start_date: new Date(Date.now() - 60_000).toISOString(),
        active: true
      })
    });
    assert.equal(createChallenge.status, 201);

    const customerPhone = `+50255${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`;
    const requestCode = await request(customerJar, `/api/public/business/${encodeURIComponent(businessSlug)}/join/request-code`, {
      method: "POST",
      body: JSON.stringify({
        phone: customerPhone,
        name: "Customer Refund Test"
      })
    });
    assert.equal(requestCode.status, 200);
    const devCode = resolveJoinCode({
      requestCodeData: requestCode.data,
      businessSlug,
      phone: customerPhone
    });
    assert.ok(devCode, "expected join code for customer verification");

    const verifyJoin = await request(customerJar, `/api/public/business/${encodeURIComponent(businessSlug)}/join/verify`, {
      method: "POST",
      body: JSON.stringify({
        phone: customerPhone,
        code: devCode,
        name: "Customer Refund Test"
      })
    });
    assert.equal(verifyJoin.status, 200);
    const customerId = verifyJoin.data?.customer?.id;
    assert.ok(customerId, "expected customer id");

    const qr = await request(customerJar, "/api/public/customer/qr", {
      method: "POST",
      csrf: true,
      body: "{}"
    });
    assert.equal(qr.status, 200);
    assert.ok(qr.data?.token, "expected QR token");

      const award = await request(ownerJar, "/api/staff/award", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        customerQrToken: qr.data.token,
        amount_q: 50,
        txId: crypto.randomUUID()
      })
    });
    assert.equal(award.status, 200);
    const purchaseTransactionId = award.data?.transactionId;
    assert.ok(purchaseTransactionId, "expected purchase transaction id");

      await waitFor(async () => {
        const { rows } = await db.query(
          `SELECT
             EXISTS (
               SELECT 1
               FROM customer_achievements ca
               JOIN achievements a ON a.id = ca.achievement_id
               WHERE ca.customer_id = $1
                 AND a.name = $2
             ) AS achievement_earned,
             (
               SELECT cc.completed
               FROM customer_challenges cc
               JOIN challenges c ON c.id = cc.challenge_id
               WHERE cc.customer_id = $1
                 AND c.name = $3
               LIMIT 1
             ) AS challenge_completed
           FROM customer_balances cb
           WHERE cb.customer_id = $1`,
          [customerId, `Q50 spender ${rand}`, `5 point push ${rand}`]
        );
        const state = rows[0];
        if (!state) return false;
        if (!state.achievement_earned) return false;
        if (!state.challenge_completed) return false;
        return state;
      }, { timeoutMs: 12_000, intervalMs: 400 });

      const refund = await request(ownerJar, "/api/staff/refund", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        transactionId: purchaseTransactionId,
        requestId: crypto.randomUUID(),
        reason: "integration refund"
      })
      });
      assert.equal(refund.status, 200);
      assert.ok(Number(refund.data?.gamificationReconciliation?.achievementsRevoked || 0) >= 1);
      assert.ok(Number(refund.data?.gamificationReconciliation?.challengesRevoked || 0) >= 1);
      assert.equal(refund.data?.newBalance, 0);

      const meAfter = await request(customerJar, "/api/customer/me");
      assert.equal(meAfter.status, 200);
      assert.equal(Number(meAfter.data?.customer?.points || 0), 0);

      const achievementsAfter = await request(customerJar, "/api/customer/achievements");
      assert.equal(achievementsAfter.status, 200);
      const earnedAfter = achievementsAfter.data?.earned || [];
      const inProgressAfter = achievementsAfter.data?.inProgress || [];
      assert.equal(earnedAfter.some((item) => item.name === `Q50 spender ${rand}`), false);
      const achievementProgress = inProgressAfter.find((item) => item.name === `Q50 spender ${rand}`);
      assert.ok(achievementProgress, "achievement should return to in-progress list");
      assert.equal(Number(achievementProgress.current || 0), 0);

      const challengesAfter = await request(customerJar, "/api/customer/challenges");
      assert.equal(challengesAfter.status, 200);
      const challengeAfter = (challengesAfter.data?.challenges || []).find((item) => item.name === `5 point push ${rand}`);
      assert.ok(challengeAfter, "challenge should still be visible");
      assert.equal(Boolean(challengeAfter.completed), false);
      assert.equal(Number(challengeAfter.progress || 0), 0);
      assert.equal(Number(challengeAfter.times_completed || 0), 0);
    } finally {
      await db.end().catch(() => {});
    }
  });
});
