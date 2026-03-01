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
  assert(cookie.includes("pf_super="), "Super login did not issue the pf_super cookie");

  const meResponse = await request("/api/super/me", {
    headers: { cookie }
  });
  assert(meResponse.ok, `/api/super/me returned HTTP ${meResponse.status}`);
  console.log("SMOKE auth: super login/session path OK");
}

async function main() {
  console.log(`SMOKE base_url=${baseUrl}`);

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
  await expectHtml("/staff-login.html");
  await expectHtml("/super.html");

  console.log("SMOKE read-only checks OK");
  await checkSuperSession();
  console.log("SMOKE PASS");
}

main().catch((error) => {
  console.error(`SMOKE FAIL: ${error.message || error}`);
  process.exit(1);
});
