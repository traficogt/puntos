#!/usr/bin/env node

/** @typedef {import("../types/ops.js").LoadRecord} LoadRecord */
/** @typedef {import("../types/ops.js").LoadTarget} LoadTarget */

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

const baseUrl = arg("--base-url", process.env.LOAD_BASE_URL || "http://localhost:3001");
const scenario = arg("--scenario", process.env.LOAD_SCENARIO || "mixed");
const totalRequests = Number(arg("--requests", process.env.LOAD_REQUESTS || "120"));
const concurrency = Number(arg("--concurrency", process.env.LOAD_CONCURRENCY || "12"));
const timeoutMs = Number(arg("--timeout-ms", process.env.LOAD_TIMEOUT_MS || "5000"));
const maxP95Ms = Number(arg("--max-p95-ms", process.env.LOAD_MAX_P95_MS || "750"));
const maxErrorRate = Number(arg("--max-error-rate", process.env.LOAD_MAX_ERROR_RATE || "0.02"));
const superEmail = arg("--super-email", process.env.LOAD_SUPER_EMAIL || process.env.SUPER_ADMIN_EMAIL || "");
const superPassword = arg("--super-password", process.env.LOAD_SUPER_PASSWORD || process.env.SUPER_ADMIN_PASSWORD || "");
const requireSuper = hasFlag("--require-super");

/**
 * @param {unknown} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * @param {number[]} values
 * @param {number} pct
 * @returns {number}
 */
function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
  return sorted[index];
}

/**
 * @param {number} value
 * @returns {string}
 */
function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}

/**
 * @param {URL} url
 * @param {RequestInit} [init]
 * @returns {Promise<{ response: Response; durationMs: number }>}
 */
async function timedFetch(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, durationMs: performance.now() - started };
  } finally {
    clearTimeout(timer);
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

/**
 * @returns {Promise<string>}
 */
async function getSuperCookie() {
  if (!superEmail || !superPassword) {
    assert(!requireSuper, "Critical load auth scenario requested but super credentials are missing.");
    return "";
  }

  const { response } = await timedFetch(new URL("/api/super/login", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: superEmail, password: superPassword })
  });
  assert(response.ok, `/api/super/login returned HTTP ${response.status}`);
  const cookie = cookieHeader(response);
  assert(cookie.includes("pf_super="), "Super login did not issue a pf_super cookie");
  return cookie;
}

/**
 * @returns {Promise<LoadTarget[]>}
 */
async function buildTargets() {
  /** @type {LoadTarget[]} */
  const publicTargets = [
    {
      label: "health",
      url: new URL("/api/health", baseUrl),
      validate: (response) => response.ok
    },
    {
      label: "ready",
      url: new URL("/api/ready", baseUrl),
      validate: (response) => response.ok
    },
    {
      label: "info",
      url: new URL("/api/info", baseUrl),
      validate: (response) => response.ok
    },
    {
      label: "openapi",
      url: new URL("/api/v1/openapi.json", baseUrl),
      validate: (response) => response.ok
    }
  ];

  if (scenario === "public") return publicTargets;

  const cookie = await getSuperCookie();
  /** @type {LoadTarget[]} */
  const authTargets = cookie ? [{
    label: "super-me",
    url: new URL("/api/super/me", baseUrl),
    init: { headers: { cookie } },
    validate: (response) => response.ok
  }] : [];

  if (scenario === "auth") {
    assert(authTargets.length > 0, "Auth scenario requires super credentials.");
    return authTargets;
  }

  return publicTargets.concat(authTargets);
}

async function main() {
  const targets = await buildTargets();
  assert(targets.length > 0, "No load targets configured.");

  /** @type {Map<string, LoadRecord>} */
  const stats = new Map();
  for (const target of targets) {
    stats.set(target.label, { durations: [], failures: 0, total: 0 });
  }

  let cursor = 0;
  async function worker() {
    while (cursor < totalRequests) {
      const index = cursor++;
      const target = targets[index % targets.length];
      const record = stats.get(target.label);
      try {
        const { response, durationMs } = await timedFetch(target.url, target.init);
        record.total += 1;
        record.durations.push(durationMs);
        if (!target.validate(response)) {
          record.failures += 1;
        }
      } catch {
        record.total += 1;
        record.failures += 1;
        record.durations.push(timeoutMs);
      }
    }
  }

  console.log(`LOAD base_url=${baseUrl} scenario=${scenario} requests=${totalRequests} concurrency=${concurrency}`);
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

  let overallFailures = 0;
  let overallTotal = 0;
  let overallP95 = 0;

  for (const [label, record] of stats.entries()) {
    if (!record.total) continue;
    overallFailures += record.failures;
    overallTotal += record.total;
    const avg = record.durations.reduce((sum, value) => sum + value, 0) / record.durations.length;
    const p95 = percentile(record.durations, 95);
    overallP95 = Math.max(overallP95, p95);
    const errorRate = record.failures / record.total;
    console.log(`LOAD ${label} total=${record.total} failures=${record.failures} error_rate=${(errorRate * 100).toFixed(2)}% avg=${formatMs(avg)} p95=${formatMs(p95)}`);
    if (errorRate > maxErrorRate) {
      throw new Error(`${label} exceeded error rate threshold (${(errorRate * 100).toFixed(2)}% > ${(maxErrorRate * 100).toFixed(2)}%)`);
    }
    if (p95 > maxP95Ms) {
      throw new Error(`${label} exceeded p95 threshold (${formatMs(p95)} > ${formatMs(maxP95Ms)})`);
    }
  }

  const overallErrorRate = overallTotal ? overallFailures / overallTotal : 1;
  console.log(`LOAD overall total=${overallTotal} failures=${overallFailures} error_rate=${(overallErrorRate * 100).toFixed(2)}% worst_p95=${formatMs(overallP95)}`);
  console.log("LOAD PASS");
}

main().catch((error) => {
  console.error(`LOAD FAIL: ${error.message || error}`);
  process.exit(1);
});
