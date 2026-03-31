#!/usr/bin/env node
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const baseUrl = arg("--base-url", process.env.TEST_API_URL || "http://localhost:3001");
const browserOrigin = arg("--browser-origin", process.env.BROWSER_ORIGIN || process.env.APP_ORIGIN || new URL(baseUrl).origin);
const superEmail = arg("--super-email", process.env.SUPER_ADMIN_EMAIL || "");
const superPassword = arg("--super-password", process.env.SUPER_ADMIN_PASSWORD || "");
const forwardedFor = process.env.TEST_CLIENT_IP
  || `198.51.100.${Math.max(10, Math.floor(Math.random() * 200))}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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
  return { status: response.status, data };
}

async function waitForStableCustomer(customerJar, {
  attempts = 12,
  delayMs = 250,
  stableReads = 2
} = {}) {
  let lastPoints = null;
  let stableCount = 0;
  let latest = null;

  for (let i = 0; i < attempts; i += 1) {
    latest = await request(customerJar, "/api/customer/me");
    assert(latest.status === 200, `customer me failed while waiting for stability: ${latest.status}`);
    const points = Number(latest.data?.customer?.points ?? 0);
    if (lastPoints !== null && points === lastPoints) {
      stableCount += 1;
      if (stableCount >= stableReads) return latest;
    } else {
      stableCount = 0;
    }
    lastPoints = points;
    await sleep(delayMs);
  }

  return latest;
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
  assert(createdBusiness.status === 201, `create business failed: ${createdBusiness.status}`);

  const businessId = createdBusiness.data?.business?.id;
  const businessSlug = createdBusiness.data?.business?.slug;
  assert(businessId && businessSlug, "missing business identity");

  const impersonate = await request(superJar, `/api/super/impersonate/${encodeURIComponent(businessId)}`, {
    method: "POST",
    csrf: true,
    body: "{}"
  });
  assert(impersonate.status === 200, `impersonate failed: ${impersonate.status}`);
  for (const [key, value] of superJar.entries()) {
    if (key.startsWith("__Host-pf_staff") || key.startsWith("pf_csrf")) ownerJar.set(key, value);
  }

  return { businessSlug };
}

async function createCustomerAndQr(customerJar, businessSlug) {
  const customerPhone = `+50255${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`;
  const session = runHelperScript("dev-create-customer-session.mjs", [
    "--slug",
    String(businessSlug),
    "--phone",
    String(customerPhone),
    "--name",
    "Ledger Test Customer"
  ]);
  assert(session?.customer_id && session?.token, "failed to bootstrap customer session");
  customerJar.set("__Host-pf_customer", session.token);

  const me = await request(customerJar, "/api/customer/me");
  assert(me.status === 200, `customer bootstrap failed: ${me.status}`);

  const qr = await request(customerJar, "/api/public/customer/qr", {
    method: "POST",
    csrf: true,
    body: "{}"
  });
  assert(qr.status === 200, `customer qr failed: ${qr.status}`);
  assert(qr.data?.token, "missing qr token");

  return { customerId: session.customer_id, qrToken: qr.data.token };
}

async function main() {
  assert(superEmail && superPassword, "SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required");

  const superJar = new Map();
  const ownerJar = new Map();
  const redeemCustomerJar = new Map();
  const refundCustomerJar = new Map();

  const login = await request(superJar, "/api/super/login", {
    method: "POST",
    body: JSON.stringify({ email: superEmail, password: superPassword })
  });
  assert(login.status === 200, `super login failed: ${login.status}`);

  const rand = Math.random().toString(36).slice(2, 9);
  const { businessSlug } = await createBusinessAndOwnerSession(superJar, ownerJar, rand);
  const { customerId, qrToken } = await createCustomerAndQr(redeemCustomerJar, businessSlug);
  const refundCustomer = await createCustomerAndQr(refundCustomerJar, businessSlug);

  const reward = await request(ownerJar, "/api/admin/rewards", {
    method: "POST",
    csrf: true,
    body: JSON.stringify({
      name: `Reward ${rand}`,
      description: "Ledger assurance reward",
      points_cost: 5
    })
  });
  assert(reward.status === 200, `create reward failed: ${reward.status}`);
  const rewardId = reward.data?.reward?.id;
  assert(rewardId, "missing reward id");

  const award = await request(ownerJar, "/api/staff/award", {
    method: "POST",
    csrf: true,
    body: JSON.stringify({
      customerQrToken: qrToken,
      amount_q: 50,
      txId: crypto.randomUUID()
    })
  });
  assert(award.status === 200, `award failed: ${award.status}`);
  const purchaseTransactionId = award.data?.transactionId;
  assert(purchaseTransactionId, "missing purchase transaction id");

  const beforeMe = await waitForStableCustomer(redeemCustomerJar);
  const beforePoints = Number(beforeMe.data?.customer?.points ?? 0);

  const requestId = crypto.randomUUID();
  const redeemPayload = JSON.stringify({ customerId, rewardId, requestId });
  const [redeemA, redeemB] = await Promise.all([
    request(cloneJar(ownerJar), "/api/staff/redeem", { method: "POST", csrf: true, body: redeemPayload }),
    request(cloneJar(ownerJar), "/api/staff/redeem", { method: "POST", csrf: true, body: redeemPayload })
  ]);
  assert(redeemA.status === 200 && redeemB.status === 200, `duplicate redeem failed: ${redeemA.status}/${redeemB.status}`);
  assert(redeemA.data?.redemptionCode === redeemB.data?.redemptionCode, "duplicate redeem returned different codes");
  assert(Number(redeemA.data?.newBalance ?? 0) === beforePoints - 5, "duplicate redeem balance drift");

  const refundAward = await request(ownerJar, "/api/staff/award", {
    method: "POST",
    csrf: true,
    body: JSON.stringify({
      customerQrToken: refundCustomer.qrToken,
      amount_q: 50,
      txId: crypto.randomUUID()
    })
  });
  assert(refundAward.status === 200, `refund setup award failed: ${refundAward.status}`);
  const refundTransactionId = refundAward.data?.transactionId;
  assert(refundTransactionId, "missing refund transaction id");

  const refundRequestId = crypto.randomUUID();
  const refundPayload = JSON.stringify({
    transactionId: refundTransactionId,
    requestId: refundRequestId,
    reason: "live ledger duplicate refund"
  });
  const [refundA, refundB] = await Promise.all([
    request(cloneJar(ownerJar), "/api/staff/refund", { method: "POST", csrf: true, body: refundPayload }),
    request(cloneJar(ownerJar), "/api/staff/refund", { method: "POST", csrf: true, body: refundPayload })
  ]);
  assert(refundA.status === 200 && refundB.status === 200, `duplicate refund failed: ${refundA.status}/${refundB.status}`);
  assert(refundA.data?.reversalTransactionId === refundB.data?.reversalTransactionId, "duplicate refund returned different reversals");

  const afterMe = await waitForStableCustomer(refundCustomerJar);
  assert(
    Number(afterMe.data?.customer?.points ?? 0) === Number(refundA.data?.newBalance ?? NaN),
    "refund final balance did not match the successful refund result"
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    redeem: {
      statuses: [redeemA.status, redeemB.status],
      redemptionCode: redeemA.data?.redemptionCode,
      newBalance: redeemA.data?.newBalance
    },
    refund: {
      statuses: [refundA.status, refundB.status],
      reversalTransactionId: refundA.data?.reversalTransactionId,
      newBalance: afterMe.data?.customer?.points,
      expectedBalance: refundA.data?.newBalance,
      refundCustomerId: refundCustomer.customerId
    }
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`live-staff-ledger-check FAIL: ${error?.message || error}\n`);
  process.exit(1);
});
