#!/usr/bin/env node
import crypto from "node:crypto";

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
  return { response, status: response.status, data, text };
}

async function createBusinessAndOwnerSession(superJar, ownerJar, suffix) {
  const ownerEmail = `owner-correction-${suffix}@example.com`;
  const password = "OrchardLanternMarble2026!";

  const createdBusiness = await request(superJar, "/api/super/businesses", {
    method: "POST",
    csrf: true,
    body: JSON.stringify({
      businessName: `Correction Test ${suffix}`,
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

  return { businessId, businessSlug, ownerPassword: password };
}

async function createSecondOwner(superJar, businessId, suffix, ownerJar) {
  const email = `owner2-correction-${suffix}@example.com`;
  const password = "HarborCactusNimbus2026!";

  const createUser = await request(superJar, `/api/super/businesses/${encodeURIComponent(businessId)}/users`, {
    method: "POST",
    csrf: true,
    body: JSON.stringify({
      name: "Owner Two",
      email,
      password,
      role: "OWNER",
      allow_multi_owner: true
    })
  });
  assert(createUser.status === 201, `create second owner failed: ${createUser.status}`);

  const login = await request(ownerJar, "/api/staff/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  assert(login.status === 200, `second owner login failed: ${login.status}`);

  return {
    ownerId: createUser.data?.user?.id,
    email,
    password
  };
}

async function createCustomerAndDrift(businessSlug, driftPoints) {
  const { withDbClientContext } = await import("../app/database.js");
  const { BusinessRepo } = await import("../app/repositories/business-repository.js");
  const { CustomerRepo } = await import("../app/repositories/customer-repository.js");

  const phone = `+50255${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`;
  const name = "Correction Smoke Customer";

  return withDbClientContext({ platformAdmin: true, tenantId: null }, async (client) => {
    const business = await BusinessRepo.getBySlug(businessSlug);
    assert(business?.id, `business not found for slug ${businessSlug}`);

    const customer = await CustomerRepo.upsertByPhone({
      id: crypto.randomUUID(),
      business_id: business.id,
      phone,
      name
    });

    await client.query(
      `UPDATE customer_balances
       SET points = points + $2,
           updated_at = now()
       WHERE customer_id = $1`,
      [customer.id, Number(driftPoints)]
    );

    return { businessId: business.id, customerId: customer.id, phone, driftPoints: Number(driftPoints) };
  });
}

async function main() {
  assert(superEmail && superPassword, "SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required");

  const superJar = new Map();
  const ownerOneJar = new Map();
  const ownerTwoJar = new Map();

  const login = await request(superJar, "/api/super/login", {
    method: "POST",
    body: JSON.stringify({ email: superEmail, password: superPassword })
  });
  assert(login.status === 200, `super login failed: ${login.status}`);

  const rand = Math.random().toString(36).slice(2, 9);
  const { businessId, businessSlug } = await createBusinessAndOwnerSession(superJar, ownerOneJar, rand);
  const secondOwner = await createSecondOwner(superJar, businessId, rand, ownerTwoJar);
  assert(secondOwner.ownerId, "missing second owner id");

  const firstCustomer = await createCustomerAndDrift(businessSlug, 11);
  const createOne = await request(ownerOneJar, "/api/admin/analytics/ledger-corrections", {
    method: "POST",
    csrf: true,
    body: JSON.stringify({
      customerId: firstCustomer.customerId,
      reason: "Controlled drift introduced for smoke validation"
    })
  });
  assert(createOne.status === 201, `request correction failed: ${createOne.status}`);
  const firstCorrectionId = createOne.data?.correction?.id;
  assert(firstCorrectionId, "missing first correction id");

  const selfApply = await request(ownerOneJar, `/api/admin/analytics/ledger-corrections/${encodeURIComponent(firstCorrectionId)}/apply`, {
    method: "POST",
    csrf: true,
    body: "{}"
  });
  assert(selfApply.status === 403, `self-apply should be forbidden, got ${selfApply.status}`);

  const applyBySecondOwner = await request(ownerTwoJar, `/api/admin/analytics/ledger-corrections/${encodeURIComponent(firstCorrectionId)}/apply`, {
    method: "POST",
    csrf: true,
    body: "{}"
  });
  assert(applyBySecondOwner.status === 200, `apply correction failed: ${applyBySecondOwner.status}`);
  assert(applyBySecondOwner.data?.correction?.status === "APPLIED", "correction did not apply");
  assert(applyBySecondOwner.data?.correction?.adjustment_id, "applied correction missing adjustment_id");

  const secondCustomer = await createCustomerAndDrift(businessSlug, 7);
  const createTwo = await request(ownerTwoJar, "/api/admin/analytics/ledger-corrections", {
    method: "POST",
    csrf: true,
    body: JSON.stringify({
      customerId: secondCustomer.customerId,
      reason: "Second drift introduced to validate rejection path"
    })
  });
  assert(createTwo.status === 201, `request second correction failed: ${createTwo.status}`);
  const secondCorrectionId = createTwo.data?.correction?.id;
  assert(secondCorrectionId, "missing second correction id");

  const selfReject = await request(ownerTwoJar, `/api/admin/analytics/ledger-corrections/${encodeURIComponent(secondCorrectionId)}/reject`, {
    method: "POST",
    csrf: true,
    body: JSON.stringify({ reason: "Owner cannot reject own request" })
  });
  assert(selfReject.status === 403, `self-reject should be forbidden, got ${selfReject.status}`);

  const rejectByFirstOwner = await request(ownerOneJar, `/api/admin/analytics/ledger-corrections/${encodeURIComponent(secondCorrectionId)}/reject`, {
    method: "POST",
    csrf: true,
    body: JSON.stringify({ reason: "Reviewed and rejected during smoke validation" })
  });
  assert(rejectByFirstOwner.status === 200, `reject correction failed: ${rejectByFirstOwner.status}`);
  assert(rejectByFirstOwner.data?.correction?.status === "REJECTED", "correction did not reject");

  const listed = await request(ownerOneJar, "/api/admin/analytics/ledger-corrections?limit=20");
  assert(listed.status === 200, `final list corrections failed: ${listed.status}`);
  const statuses = new Map((listed.data?.corrections || []).map((row) => [row.id, row.status]));
  assert(statuses.get(firstCorrectionId) === "APPLIED", "applied correction missing from list");
  assert(statuses.get(secondCorrectionId) === "REJECTED", "rejected correction missing from list");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    businessId,
    firstCorrection: {
      id: firstCorrectionId,
      selfApplyStatus: selfApply.status,
      finalStatus: applyBySecondOwner.data?.correction?.status,
      adjustmentId: applyBySecondOwner.data?.correction?.adjustment_id
    },
    secondCorrection: {
      id: secondCorrectionId,
      selfRejectStatus: selfReject.status,
      finalStatus: rejectByFirstOwner.data?.correction?.status
    }
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`live-ledger-correction-check FAIL: ${error?.message || error}\n`);
  process.exit(1);
});
