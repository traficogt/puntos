#!/usr/bin/env node
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

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

async function createBusinessAndOwnerSession(superJar, ownerJar, suffix) {
  const ownerEmail = `owner-cert-${suffix}@example.com`;
  const password = "OrchardLanternMarble2026!";

  const createdBusiness = await request(superJar, "/api/super/businesses", {
    method: "POST",
    csrf: true,
    body: JSON.stringify({
      businessName: `Certification Test ${suffix}`,
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

  return {
    businessId,
    businessSlug,
    businessName: createdBusiness.data?.business?.name || `Certification Test ${suffix}`
  };
}

async function main() {
  assert(superEmail && superPassword, "SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required");

  const superJar = new Map();
  const ownerJar = new Map();

  const login = await request(superJar, "/api/super/login", {
    method: "POST",
    body: JSON.stringify({ email: superEmail, password: superPassword })
  });
  assert(login.status === 200, `super login failed: ${login.status}`);

  const rand = Math.random().toString(36).slice(2, 9);
  const { businessName } = await createBusinessAndOwnerSession(superJar, ownerJar, rand);

  const to = isoDate(new Date());
  const from = isoDate(new Date(Date.now() - (6 * 24 * 60 * 60 * 1000)));

  const jsonReport = await request(ownerJar, `/api/admin/analytics/ledger-certification?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  assert(jsonReport.status === 200, `ledger certification json failed: ${jsonReport.status}`);
  assert(jsonReport.data?.ok === true, "ledger certification json missing ok=true");
  assert(String(jsonReport.data?.business?.name || "") === businessName, "ledger certification json business mismatch");
  assert(String(jsonReport.data?.period?.from || "") === from, "ledger certification json from mismatch");
  assert(String(jsonReport.data?.period?.to || "") === to, "ledger certification json to mismatch");
  assert(Array.isArray(jsonReport.data?.daily_rows), "ledger certification json missing daily_rows");
  assert(typeof jsonReport.data?.summary?.points_issued === "number", "ledger certification json missing summary points_issued");
  assert(typeof jsonReport.data?.summary?.gift_cards_issued_q === "number", "ledger certification json missing summary gift_cards_issued_q");

  const csvReport = await request(ownerJar, `/api/admin/analytics/ledger-certification.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    headers: { Accept: "text/csv" }
  });
  assert(csvReport.status === 200, `ledger certification csv failed: ${csvReport.status}`);
  const csvType = csvReport.response.headers.get("content-type") || "";
  assert(csvType.includes("text/csv"), "ledger certification csv missing text/csv content type");
  const disposition = csvReport.response.headers.get("content-disposition") || "";
  assert(disposition.includes(`ledger-certification-${from}_to_${to}.csv`), "ledger certification csv filename mismatch");
  assert(String(csvReport.text || "").includes("row_type,date,points_issued"), "ledger certification csv missing header row");
  assert(String(csvReport.text || "").includes("TOTAL,"), "ledger certification csv missing total row");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    businessName,
    period: { from, to },
    certificationStatus: jsonReport.data?.certification_status,
    csvFilename: disposition
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`live-ledger-certification-check FAIL: ${error?.message || error}\n`);
  process.exit(1);
});
