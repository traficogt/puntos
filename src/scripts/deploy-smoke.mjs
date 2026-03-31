#!/usr/bin/env node

/** @typedef {import("../types/ops.js").SmokeHealthResponse} SmokeHealthResponse */
/** @typedef {import("../types/ops.js").SmokeInfoResponse} SmokeInfoResponse */
/** @typedef {import("../types/ops.js").SmokeLiveResponse} SmokeLiveResponse */
/** @typedef {import("../types/ops.js").SmokeOpenApiResponse} SmokeOpenApiResponse */
/** @typedef {import("../types/ops.js").SmokeReadyResponse} SmokeReadyResponse */

const args = process.argv.slice(2);

/**
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string}
 */
function arg(name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

const baseUrl = arg("--base-url", process.env.SMOKE_BASE_URL || "http://localhost:3001");
const timeoutMs = Number(arg("--timeout-ms", process.env.SMOKE_TIMEOUT_MS || "5000"));
const superEmail = arg("--super-email", process.env.SMOKE_SUPER_EMAIL || process.env.SUPER_ADMIN_EMAIL || "");
const superPassword = arg("--super-password", process.env.SMOKE_SUPER_PASSWORD || process.env.SUPER_ADMIN_PASSWORD || "");
const requireSuperLogin = hasFlag("--require-super-login");

/**
 * @param {unknown} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * @param {string} pathname
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
async function request(pathname, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(new URL(pathname, baseUrl), {
      redirect: "manual",
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @template T
 * @param {string} pathname
 * @param {(body: T) => void} validate
 * @returns {Promise<void>}
 */
async function expectJson(pathname, validate) {
  const response = await request(pathname);
  assert(response.ok, `${pathname} returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  assert(contentType.includes("application/json"), `${pathname} did not return JSON`);
  const body = /** @type {T} */ (await response.json());
  validate(body);
}

/**
 * @param {string} pathname
 * @param {number[]} allowedStatuses
 * @returns {Promise<void>}
 */
async function expectAuthProtected(pathname, allowedStatuses = [401, 403]) {
  const response = await request(pathname);
  assert(
    allowedStatuses.includes(response.status),
    `${pathname} returned HTTP ${response.status}, expected one of ${allowedStatuses.join(", ")}`
  );
  const contentType = response.headers.get("content-type") || "";
  assert(contentType.includes("application/json"), `${pathname} auth response did not return JSON`);
  const body = await response.json();
  assert(typeof body?.error === "string" && body.error.length > 0, `${pathname} auth response missing error`);
}

/**
 * @param {string} pathname
 * @returns {Promise<void>}
 */
async function expectHtml(pathname) {
  const response = await request(pathname);
  assert(response.ok, `${pathname} returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  assert(contentType.includes("text/html"), `${pathname} did not return HTML`);
  const body = await response.text();
  assert(/<html/i.test(body), `${pathname} did not look like an HTML page`);
}

/**
 * @param {string} pathname
 * @param {{ origin?: string, mustContain?: string[] }} [options]
 * @returns {Promise<void>}
 */
async function expectStaticAsset(pathname, { origin = "", mustContain = [] } = {}) {
  const headers = origin ? { Origin: origin } : {};
  const response = await request(pathname, { headers });
  assert(response.ok, `${pathname} returned HTTP ${response.status}`);

  const contentType = response.headers.get("content-type") || "";
  const isJs = contentType.includes("javascript") || contentType.includes("ecmascript");
  const isCss = contentType.includes("text/css");
  const isWorker = pathname.endsWith(".js") && isJs;
  assert(isJs || isCss || isWorker, `${pathname} returned unexpected content-type ${contentType || "(empty)"}`);

  const body = await response.text();
  assert(body.trim().length > 0, `${pathname} returned an empty asset body`);
  for (const snippet of mustContain) {
    assert(body.includes(snippet), `${pathname} did not contain expected snippet: ${snippet}`);
  }
}

/**
 * @param {Response} response
 * @returns {string}
 */
function cookieHeader(response) {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
  return cookies
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function checkSuperSession() {
  if (!superEmail || !superPassword) {
    assert(!requireSuperLogin, "Super-login smoke check requested but credentials were not provided.");
    console.log("SMOKE skip auth: no super credentials configured");
    return;
  }

  const loginResponse = await request("/api/super/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: superEmail, password: superPassword })
  });
  assert(loginResponse.ok, `/api/super/login returned HTTP ${loginResponse.status}`);

  const cookie = cookieHeader(loginResponse);
  assert(cookie.includes("__Host-pf_super="), "Super login did not issue the __Host-pf_super cookie");

  const meResponse = await request("/api/super/me", {
    headers: { cookie }
  });
  assert(meResponse.ok, `/api/super/me returned HTTP ${meResponse.status}`);
  console.log("SMOKE auth: super login/session path OK");
}

async function main() {
  console.log(`SMOKE base_url=${baseUrl}`);
  const origin = new URL(baseUrl).origin;

  await expectJson(
    "/api/health",
    /** @param {SmokeHealthResponse} body */ (body) => {
    assert(body.service === "ok", "/api/health did not report service=ok");
    assert(body.database === "ok", "/api/health did not report database=ok");
    }
  );
  await expectJson(
    "/api/ready",
    /** @param {SmokeReadyResponse} body */ (body) => {
    assert(body.ready === true, "/api/ready did not report ready=true");
    }
  );
  await expectJson(
    "/api/live",
    /** @param {SmokeLiveResponse} body */ (body) => {
    assert(body.alive === true, "/api/live did not report alive=true");
    }
  );
  await expectJson(
    "/api/info",
    /** @param {SmokeInfoResponse} body */ (body) => {
    assert(typeof body.version === "string" && body.version.length > 0, "/api/info is missing version");
    }
  );
  await expectJson(
    "/api/v1/openapi.json",
    /** @param {SmokeOpenApiResponse} body */ (body) => {
    assert(typeof body.openapi === "string", "/api/v1/openapi.json is missing the openapi field");
    }
  );

  await expectHtml("/");
  await expectHtml("/admin.html");
  await expectHtml("/c");
  await expectHtml("/admin-dashboard.html");
  await expectHtml("/staff-login.html");
  await expectHtml("/super.html");

  await expectStaticAsset("/customer.js", { origin, mustContain: ["initCustomerPage"] });
  await expectStaticAsset("/admin-dashboard.js", { origin, mustContain: ["initAdminDashboard"] });
  await expectStaticAsset("/styles.css", { origin, mustContain: ["@import url(\"/styles/components.css\")"] });
  await expectStaticAsset("/styles/base.css", { origin, mustContain: [":root", "--display-font"] });
  await expectStaticAsset("/styles/components.css", { origin, mustContain: [".is-hidden", "button.primary"] });
  await expectStaticAsset("/styles/pages.css", { origin, mustContain: [".marketing-hero", ".panel-shell"] });
  await expectStaticAsset("/styles/admin-panels.css", { origin, mustContain: [".modal-backdrop", ".analytics-kpi-grid"] });
  await expectStaticAsset("/styles/analytics-visuals.css", { origin, mustContain: [".rfm-row", ".trend-bars"] });
  await expectStaticAsset("/styles/responsive.css", { origin, mustContain: ["@media", ".marketing-hero"] });
  await expectStaticAsset("/sw.js", { origin, mustContain: ["const CACHE =", "NETWORK_FIRST_DESTINATIONS"] });
  await expectAuthProtected("/api/admin/analytics/ledger-certification");
  await expectAuthProtected("/api/admin/analytics/ledger-certification.csv");

  console.log("SMOKE read-only checks OK");
  await checkSuperSession();
  console.log("SMOKE PASS");
}

main().catch((error) => {
  console.error(`SMOKE FAIL: ${error.message || error}`);
  process.exit(1);
});
