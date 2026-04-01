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

function createAdminClient() {
  return new pg.Client({
    host: process.env.TEST_DB_HOST || process.env.DB_HOST || "localhost",
    port: Number(process.env.TEST_DB_PORT || process.env.DB_PORT || 5432),
    database: process.env.TEST_DB_NAME || process.env.DB_NAME || "puntos",
    user: process.env.TEST_DB_USER || process.env.DB_MIGRATIONS_USER || process.env.DB_USER || "postgres",
    password: process.env.TEST_DB_PASSWORD || process.env.DB_MIGRATIONS_PASSWORD || process.env.DB_PASSWORD || ""
  });
}

integrationDescribe("Recurring Challenge Integration", () => {
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

  it("resets and re-completes a daily recurring challenge after the prior window is forced to expire", async () => {
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
      const ownerEmail = `owner-recurring-${rand}@example.com`;
      const password = "OrchardLanternMarble2026!";

      const createdBusiness = await request(superJar, "/api/super/businesses", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({
          businessName: `Recurring Challenge ${rand}`,
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

      const challengeName = `Daily points ${rand}`;
      const createChallenge = await request(ownerJar, "/api/admin/challenges", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({
          name: challengeName,
          description: "Recurring daily challenge",
          challenge_type: "recurring",
          requirement_type: "points",
          requirement_value: 1,
          reward_points: 2,
          recurrence: "daily",
          start_date: new Date(Date.now() - 60_000).toISOString(),
          active: true
        })
      });
      assert.equal(createChallenge.status, 201);

      const challengeRow = await db.query(
        `SELECT id FROM challenges WHERE business_id = $1 AND name = $2`,
        [businessId, challengeName]
      );
      const challengeId = challengeRow.rows[0]?.id;
      assert.ok(challengeId, "expected recurring challenge id");

      const customerPhone = `+50256${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`;
      const requestCode = await request(customerJar, `/api/public/business/${encodeURIComponent(businessSlug)}/join/request-code`, {
        method: "POST",
        body: JSON.stringify({
          phone: customerPhone,
          name: "Recurring Challenge Customer"
        })
      });
      assert.equal(requestCode.status, 200);
      const devCode = resolveJoinCode({
        requestCodeData: requestCode.data,
        businessSlug,
        phone: customerPhone
      });
      assert.ok(devCode, "expected join code from request or harness");

      const verifyJoin = await request(customerJar, `/api/public/business/${encodeURIComponent(businessSlug)}/join/verify`, {
        method: "POST",
        body: JSON.stringify({
          phone: customerPhone,
          code: devCode,
          name: "Recurring Challenge Customer"
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

      const firstAward = await request(ownerJar, "/api/staff/award", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({
          customerQrToken: qr.data.token,
          amount_q: 10,
          txId: crypto.randomUUID()
        })
      });
      assert.equal(firstAward.status, 200);

      await waitFor(async () => {
        const row = await db.query(
          `SELECT completed, times_completed, completion_history
           FROM customer_challenges
           WHERE customer_id = $1 AND challenge_id = $2`,
          [customerId, challengeId]
        );
        const progress = row.rows[0];
        if (!progress?.completed) return false;
        if (Number(progress.times_completed || 0) !== 1) return false;
        const history = Array.isArray(progress.completion_history) ? progress.completion_history : [];
        if (history.length !== 1) return false;
        return progress;
      }, { timeoutMs: 12_000, intervalMs: 300 });

      await db.query(
        `UPDATE customer_challenges
         SET completed_at = now() - interval '1 day',
             last_reset_at = now() - interval '1 day',
             updated_at = now()
         WHERE customer_id = $1 AND challenge_id = $2`,
        [customerId, challengeId]
      );

      const secondQr = await request(customerJar, "/api/public/customer/qr", {
        method: "POST",
        csrf: true,
        body: "{}"
      });
      assert.equal(secondQr.status, 200);
      assert.ok(secondQr.data?.token, "expected second QR token");

      const secondAward = await request(ownerJar, "/api/staff/award", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({
          customerQrToken: secondQr.data.token,
          amount_q: 10,
          txId: crypto.randomUUID()
        })
      });
      assert.equal(secondAward.status, 200);
      const secondPurchaseTransactionId = secondAward.data?.transactionId;
      assert.ok(secondPurchaseTransactionId, "expected second purchase transaction id");

      await waitFor(async () => {
        const row = await db.query(
          `SELECT completed, progress, times_completed, last_source_transaction_id, completion_history
           FROM customer_challenges
           WHERE customer_id = $1 AND challenge_id = $2`,
          [customerId, challengeId]
        );
        const progress = row.rows[0];
        if (!progress?.completed) return false;
        if (Number(progress.progress || 0) < 1) return false;
        if (Number(progress.times_completed || 0) !== 2) return false;
        if (progress.last_source_transaction_id !== secondPurchaseTransactionId) return false;
        const history = Array.isArray(progress.completion_history) ? progress.completion_history : [];
        if (history.length !== 2) return false;
        return progress;
      }, { timeoutMs: 12_000, intervalMs: 300 });

      const challenges = await request(customerJar, "/api/customer/challenges");
      assert.equal(challenges.status, 200);
      const recurring = (challenges.data?.challenges || []).find((item) => item.name === challengeName);
      assert.ok(recurring, "expected recurring challenge in customer view");
      assert.equal(Boolean(recurring.completed), true);
      assert.equal(Number(recurring.times_completed || 0), 2);
    } finally {
      await db.end().catch(() => {});
    }
  });
});
