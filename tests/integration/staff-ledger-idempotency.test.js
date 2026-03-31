import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runHelperScript(scriptName, args) {
  let output = "";
  try {
    output = execFileSync("docker", [
      "compose",
      "exec",
      "-T",
      "api",
      "node",
      `src/scripts/${scriptName}`,
      ...args
    ], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8"
    });
  } catch {
    output = execFileSync("node", [
      `src/scripts/${scriptName}`,
      ...args
    ], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8"
    });
  }
  return JSON.parse(String(output || "{}"));
}

integrationDescribe("Staff ledger idempotency integration", () => {
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

  async function waitForStableCustomer(jar, attempts = 12, delayMs = 250) {
    let lastPoints = null;
    let stableReads = 0;
    let latest = null;
    for (let i = 0; i < attempts; i += 1) {
      latest = await request(jar, "/api/customer/me");
      assert.equal(latest.status, 200);
      const points = Number(latest.data?.customer?.points ?? 0);
      if (lastPoints !== null && points === lastPoints) {
        stableReads += 1;
        if (stableReads >= 2) return latest;
      } else {
        stableReads = 0;
      }
      lastPoints = points;
      await sleep(delayMs);
    }
    return latest;
  }

  async function createBusinessAndOwnerSession(superJar, ownerJar, suffix) {
    const ownerEmail = `owner-ledger-${suffix}@example.com`;
    const password = "OrchardLanternMarble2026!";

    const createdBusiness = await request(superJar, "/api/super/businesses", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        businessName: `Ledger Test ${suffix}`,
        email: ownerEmail,
        password,
        category: "cafe",
        plan: "EMPRESA"
      })
    });
    assert.equal(createdBusiness.status, 201);
    const businessId = createdBusiness.data?.business?.id;
    const businessSlug = createdBusiness.data?.business?.slug;
    assert.ok(businessId);
    assert.ok(businessSlug);

    const impersonate = await request(superJar, `/api/super/impersonate/${encodeURIComponent(businessId)}`, {
      method: "POST",
      csrf: true,
      body: "{}"
    });
    assert.equal(impersonate.status, 200);
    for (const [key, value] of superJar.entries()) {
      if (key.startsWith("__Host-pf_staff") || key.startsWith("pf_csrf")) ownerJar.set(key, value);
    }

    return { businessId, businessSlug };
  }

  async function createCustomerAndQr(customerJar, businessSlug) {
    const customerPhone = `+50255${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`;
    const session = runHelperScript("dev-create-customer-session.mjs", [
      "--slug",
      businessSlug,
      "--phone",
      String(customerPhone),
      "--name",
      "Ledger Test Customer"
    ]);
    assert.ok(session?.customer_id && session?.token);
    customerJar.set("__Host-pf_customer", session.token);

    const me = await request(customerJar, "/api/customer/me");
    assert.equal(me.status, 200);

    const qr = await request(customerJar, "/api/public/customer/qr", {
      method: "POST",
      csrf: true,
      body: "{}"
    });
    assert.equal(qr.status, 200);
    assert.ok(qr.data?.token);

    return { customerId: session.customer_id, qrToken: qr.data.token };
  }

  it("deduplicates concurrent reward redeem requests by requestId", async () => {
    if (!superEmail || !superPassword) {
      throw new Error("SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD are required for this integration test");
    }

    const superJar = new Map();
    const ownerJar = new Map();
    const customerJar = new Map();

    const login = await request(superJar, "/api/super/login", {
      method: "POST",
      body: JSON.stringify({ email: superEmail, password: superPassword })
    });
    assert.equal(login.status, 200);

    const rand = Math.random().toString(36).slice(2, 9);
    const { businessSlug } = await createBusinessAndOwnerSession(superJar, ownerJar, rand);
    const { customerId, qrToken } = await createCustomerAndQr(customerJar, businessSlug);

    const createdReward = await request(ownerJar, "/api/admin/rewards", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        name: `Reward ${rand}`,
        description: "Idempotent redeem integration reward",
        points_cost: 5
      })
    });
    assert.equal(createdReward.status, 200);
    const rewardId = createdReward.data?.reward?.id;
    assert.ok(rewardId);

    const award = await request(ownerJar, "/api/staff/award", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        customerQrToken: qrToken,
        amount_q: 50,
        txId: crypto.randomUUID()
      })
    });
    assert.equal(award.status, 200);

    const beforeMe = await waitForStableCustomer(customerJar);
    const beforePoints = Number(beforeMe.data?.customer?.points ?? 0);
    assert.ok(beforePoints >= 5);

    const requestId = crypto.randomUUID();
    const payload = JSON.stringify({ customerId, rewardId, requestId });
    const [redeemA, redeemB] = await Promise.all([
      request(cloneJar(ownerJar), "/api/staff/redeem", {
        method: "POST",
        csrf: true,
        body: payload
      }),
      request(cloneJar(ownerJar), "/api/staff/redeem", {
        method: "POST",
        csrf: true,
        body: payload
      })
    ]);

    assert.equal(redeemA.status, 200);
    assert.equal(redeemB.status, 200);
    assert.equal(redeemA.data?.redemptionCode, redeemB.data?.redemptionCode);
    assert.equal(Number(redeemA.data?.newBalance ?? 0), Number(redeemB.data?.newBalance ?? 0));
    assert.equal(Number(redeemA.data?.newBalance ?? 0), beforePoints - 5);

    const replayRedeem = await request(ownerJar, "/api/staff/redeem", {
      method: "POST",
      csrf: true,
      body: payload
    });
    assert.equal(replayRedeem.status, 200);
    assert.equal(replayRedeem.data?.redemptionCode, redeemA.data?.redemptionCode);
    assert.equal(Number(replayRedeem.data?.newBalance ?? 0), beforePoints - 5);

    const afterMe = await request(customerJar, "/api/customer/me");
    assert.equal(afterMe.status, 200);
    assert.equal(Number(afterMe.data?.customer?.points ?? 0), beforePoints - 5);
  });

  it("deduplicates concurrent award requests by txId", async () => {
    if (!superEmail || !superPassword) {
      throw new Error("SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD are required for this integration test");
    }

    const superJar = new Map();
    const ownerJar = new Map();
    const customerJar = new Map();

    const login = await request(superJar, "/api/super/login", {
      method: "POST",
      body: JSON.stringify({ email: superEmail, password: superPassword })
    });
    assert.equal(login.status, 200);

    const rand = Math.random().toString(36).slice(2, 9);
    const { businessSlug } = await createBusinessAndOwnerSession(superJar, ownerJar, `${rand}-award`);
    const { qrToken } = await createCustomerAndQr(customerJar, businessSlug);

    const txId = crypto.randomUUID();
    const payload = JSON.stringify({
      customerQrToken: qrToken,
      amount_q: 50,
      txId
    });
    const [awardA, awardB] = await Promise.all([
      request(cloneJar(ownerJar), "/api/staff/award", {
        method: "POST",
        csrf: true,
        body: payload
      }),
      request(cloneJar(ownerJar), "/api/staff/award", {
        method: "POST",
        csrf: true,
        body: payload
      })
    ]);

    assert.equal(awardA.status, 200);
    assert.equal(awardB.status, 200);
    assert.equal(awardA.data?.transactionId, awardB.data?.transactionId);
    assert.equal(Number(awardA.data?.pointsAwarded ?? 0), Number(awardB.data?.pointsAwarded ?? 0));

    const afterMe = await waitForStableCustomer(customerJar);
    const afterPoints = Number(afterMe.data?.customer?.points ?? 0);
    assert.ok(afterPoints >= Number(awardA.data?.newBalance ?? 0));

    const history = await request(customerJar, "/api/customer/history");
    assert.equal(history.status, 200);
    const matchingTransactions = (history.data?.transactions || [])
      .filter((row) => row.id === awardA.data?.transactionId);
    assert.equal(matchingTransactions.length, 1);
  });

  it("deduplicates concurrent refund requests by requestId", async () => {
    if (!superEmail || !superPassword) {
      throw new Error("SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD are required for this integration test");
    }

    const superJar = new Map();
    const ownerJar = new Map();
    const customerJar = new Map();

    const login = await request(superJar, "/api/super/login", {
      method: "POST",
      body: JSON.stringify({ email: superEmail, password: superPassword })
    });
    assert.equal(login.status, 200);

    const rand = Math.random().toString(36).slice(2, 9);
    const { businessSlug } = await createBusinessAndOwnerSession(superJar, ownerJar, `${rand}-refund`);
    const { qrToken } = await createCustomerAndQr(customerJar, businessSlug);

    const award = await request(ownerJar, "/api/staff/award", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        customerQrToken: qrToken,
        amount_q: 50,
        txId: crypto.randomUUID()
      })
    });
    assert.equal(award.status, 200);
    const transactionId = award.data?.transactionId;
    assert.ok(transactionId);

    const payload = JSON.stringify({
      transactionId,
      requestId: crypto.randomUUID(),
      reason: "duplicate refund integration"
    });
    const [refundA, refundB] = await Promise.all([
      request(cloneJar(ownerJar), "/api/staff/refund", {
        method: "POST",
        csrf: true,
        body: payload
      }),
      request(cloneJar(ownerJar), "/api/staff/refund", {
        method: "POST",
        csrf: true,
        body: payload
      })
    ]);

    assert.equal(refundA.status, 200);
    assert.equal(refundB.status, 200);
    assert.equal(refundA.data?.reversalTransactionId, refundB.data?.reversalTransactionId);

    const replayRefund = await request(ownerJar, "/api/staff/refund", {
      method: "POST",
      csrf: true,
      body: payload
    });
    assert.equal(replayRefund.status, 200);
    assert.equal(replayRefund.data?.reversalTransactionId, refundA.data?.reversalTransactionId);

    const afterMe = await waitForStableCustomer(customerJar);
    assert.equal(Number(afterMe.data?.customer?.points ?? 0), Number(refundA.data?.newBalance ?? 0));
  });
});
