#!/usr/bin/env node

/** @typedef {import("../types/observability.js").AlertCheck} AlertCheck */
/** @typedef {import("../types/observability.js").AlertMode} AlertMode */
/** @typedef {import("../types/observability.js").AlertScope} AlertScope */
/** @typedef {import("../types/observability.js").MetricLabels} MetricLabels */
/** @typedef {import("../types/observability.js").MetricRequirement} MetricRequirement */
/** @typedef {import("../types/observability.js").MetricSample} MetricSample */
/** @typedef {import("../types/observability.js").MetricSamples} MetricSamples */

const args = process.argv.slice(2);

/**
 * @param {string} name
 * @param {string} [fallback]
 */
function arg(name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

/**
 * @param {unknown} condition
 * @param {string} message
 */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * @param {string} name
 * @param {MetricLabels} labels
 */
function keyFor(name, labels) {
  const sorted = Object.entries(labels || {}).sort(([a], [b]) => a.localeCompare(b));
  return `${name}|${sorted.map(([k, v]) => `${k}=${v}`).join(",")}`;
}

/**
 * @param {string} raw
 * @returns {MetricLabels}
 */
function parseLabels(raw) {
  if (!raw) return /** @type {MetricLabels} */ ({});
  /** @type {MetricLabels} */
  const labels = {};
  const matcher = /([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g;
  let match;
  while ((match = matcher.exec(raw))) {
    labels[match[1]] = match[2];
  }
  return labels;
}

/**
 * @param {string} text
 * @returns {MetricSamples}
 */
function parseMetrics(text) {
  /** @type {MetricSamples} */
  const samples = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i);
    if (!match) continue;
    const [, name, rawLabels = "", rawValue] = match;
    const labels = parseLabels(rawLabels);
    samples.set(keyFor(name, labels), { name, labels, value: Number(rawValue) });
  }
  return samples;
}

/**
 * @param {MetricSamples} samples
 * @param {string} name
 * @param {MetricLabels} [labels]
 */
function getMetric(samples, name, labels = {}) {
  if (!Object.keys(labels).length) {
    for (const sample of samples.values()) {
      if (sample.name === name) return sample.value;
    }
    return undefined;
  }
  return samples.get(keyFor(name, labels))?.value;
}

/**
 * @param {MetricSamples} samples
 * @param {string} name
 * @param {MetricLabels} [labels]
 */
function ensureMetric(samples, name, labels = {}) {
  const value = getMetric(samples, name, labels);
  assert(value !== undefined, `Missing metric ${name}${Object.keys(labels).length ? ` ${JSON.stringify(labels)}` : ""}`);
  return value;
}

/**
 * @param {MetricSamples} samples
 * @param {string} name
 * @param {number} fallback
 * @param {MetricLabels} [labels]
 */
function getMetricOrDefault(samples, name, fallback, labels = {}) {
  const value = getMetric(samples, name, labels);
  return value === undefined ? fallback : value;
}

/**
 * @param {string} name
 * @param {string} status
 * @param {string} [detail]
 */
function report(name, status, detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  console.log(`ALERT ${name} ${status}${suffix}`);
}

/**
 * @param {string} baseUrl
 * @param {string[]} paths
 */
async function warmEndpoints(baseUrl, paths) {
  if (!baseUrl) return;
  for (const pathname of paths) {
    await fetch(new URL(pathname, baseUrl)).catch(() => {});
  }
}

/**
 * @param {string} baseUrl
 * @param {string} metricsPath
 * @param {string} metricsToken
 * @param {string[]} [warmupPaths]
 */
async function fetchMetrics(baseUrl, metricsPath, metricsToken, warmupPaths = []) {
  assert(baseUrl, `Missing base URL for ${metricsPath}`);
  await warmEndpoints(baseUrl, warmupPaths);

  const response = await fetch(new URL(metricsPath, baseUrl), {
    headers: {
      authorization: `Bearer ${metricsToken}`
    }
  });
  assert(response.ok, `${metricsPath} returned HTTP ${response.status}`);
  return parseMetrics(await response.text());
}

/**
 * @param {MetricSamples} samples
 * @param {string} metricName
 */
function hasAnySample(samples, metricName) {
  return getMetric(samples, metricName) !== undefined;
}

const baseUrl = arg("--base-url", process.env.ALERT_BASE_URL || "http://localhost:3001");
const apiBaseUrl = arg("--api-base-url", process.env.ALERT_API_BASE_URL || baseUrl);
const workerBaseUrl = arg("--worker-base-url", process.env.ALERT_WORKER_BASE_URL || "");
const metricsToken = arg("--metrics-token", process.env.ALERT_METRICS_TOKEN || process.env.METRICS_TOKEN || "");
/** @type {AlertMode} */
const mode = /** @type {AlertMode} */ (arg("--mode", process.env.ALERT_MODE || "presence"));
/** @type {AlertScope} */
const scope = /** @type {AlertScope} */ (arg("--scope", process.env.ALERT_SCOPE || "api"));
const allowAlerts = new Set(
  String(arg("--allow-alerts", process.env.ALERT_ALLOW_ALERTS || ""))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

const validModes = new Set(["presence", "evaluate"]);
const validScopes = new Set(["api", "worker", "all"]);

/** @type {MetricRequirement[]} */
const apiPresenceMetrics = [
  ["puntos_http_requests_total"],
  ["puntos_http_request_duration_seconds_bucket"],
  ["puntos_db_connections_active"],
  ["puntos_db_connections_idle"],
  ["puntos_webhook_deliveries_24h", { status: "failed" }],
  ["puntos_customers_total"],
  ["puntos_points_total"],
  ["puntos_process_memory_bytes"],
  ["puntos_process_uptime_seconds"]
];

/** @type {MetricRequirement[]} */
const workerPresenceMetrics = [
  ["puntos_webhook_deliveries_24h", { status: "failed" }],
  ["puntos_jobs_total", { status: "failed" }],
  ["puntos_jobs_oldest_age_seconds"],
  ["puntos_job_queue_depth"],
  ["puntos_job_queue_driver"],
  ["puntos_billing_events_24h", { type: "message.sent" }],
  ["puntos_churn_last_sent_timestamp"],
  ["puntos_db_connections_active"],
  ["puntos_process_uptime_seconds"]
];

/**
 * @param {MetricSamples} samples
 * @param {MetricRequirement[]} metrics
 * @param {string} label
 */
function checkPresence(samples, metrics, label) {
  for (const [metricName, labels] of metrics) {
    ensureMetric(samples, metricName, labels || {});
    report(metricName, "present", label);
  }
}

/**
 * @param {MetricSamples} samples
 * @returns {AlertCheck[]}
 */
function buildApiChecks(samples) {
  const checks = [];
  if (hasAnySample(samples, "puntos_metrics_error")) {
    checks.push({
      name: "PuntosMetricsCollectionFailing",
      value: getMetricOrDefault(samples, "puntos_metrics_error", 0),
      ok: (value) => value <= 0
    });
  } else {
    report("PuntosMetricsCollectionFailing", "clear", "value=0 (metric absent)");
  }
  return checks;
}

/**
 * @param {MetricSamples} samples
 * @returns {AlertCheck[]}
 */
function buildWorkerChecks(samples) {
  const churnLastSent = ensureMetric(samples, "puntos_churn_last_sent_timestamp");

  return [
    {
      name: "PuntosWebhookFailures24h",
      value: ensureMetric(samples, "puntos_webhook_deliveries_24h", { status: "failed" }),
      ok: (value) => value <= 5
    },
    {
      name: "PuntosJobBacklogOld",
      value: ensureMetric(samples, "puntos_jobs_oldest_age_seconds"),
      ok: (value) => value <= 900
    },
    {
      name: "PuntosJobFailuresPresent",
      value: ensureMetric(samples, "puntos_jobs_total", { status: "failed" }),
      ok: (value) => value <= 0
    },
    {
      name: "PuntosRedisQueueHealthFailing",
      value: ensureMetric(samples, "puntos_job_queue_depth"),
      ok: (value) => value >= 0
    },
    {
      name: "PuntosChurnSchedulerStale",
      value: churnLastSent > 0 ? Math.max(0, Math.floor(Date.now() / 1000) - churnLastSent) : 0,
      ok: (value) => churnLastSent <= 0 || value <= 172800
    },
    {
      name: "PuntosDbConnectionsHigh",
      value: ensureMetric(samples, "puntos_db_connections_active"),
      ok: (value) => value <= 40
    }
  ];
}

/**
 * @param {AlertCheck[]} checks
 */
function evaluateChecks(checks) {
  for (const check of checks) {
    if (allowAlerts.has(check.name)) {
      report(check.name, "allowed", `value=${check.value}`);
      continue;
    }
    assert(check.ok(check.value), `${check.name} threshold exceeded (value=${check.value})`);
    report(check.name, "clear", `value=${check.value}`);
  }
}

async function main() {
  assert(metricsToken, "Metrics token is required. Pass --metrics-token or set METRICS_TOKEN.");
  assert(validModes.has(mode), `Invalid mode ${mode}. Use presence or evaluate.`);
  assert(validScopes.has(scope), `Invalid scope ${scope}. Use api, worker, or all.`);

  const needsApi = scope === "api" || scope === "all";
  const needsWorker = scope === "worker" || scope === "all";

  if (needsWorker) {
    assert(workerBaseUrl, "Worker scope requires --worker-base-url or ALERT_WORKER_BASE_URL.");
  }

  if (needsApi) {
    const apiSamples = await fetchMetrics(
      apiBaseUrl,
      "/api/metrics",
      metricsToken,
      ["/api/health", "/api/ready", "/api/info", "/api/v1/openapi.json"]
    );

    checkPresence(apiSamples, apiPresenceMetrics, "scope=api");
    if (mode === "evaluate") {
      evaluateChecks(buildApiChecks(apiSamples));
    }
  }

  if (needsWorker) {
    const workerSamples = await fetchMetrics(
      workerBaseUrl,
      "/metrics",
      metricsToken,
      ["/health", "/ready", "/info", "/queue/health"]
    );

    checkPresence(workerSamples, workerPresenceMetrics, "scope=worker");
    if (mode === "evaluate") {
      evaluateChecks(buildWorkerChecks(workerSamples));
    }
  }

  console.log(`ALERT CHECK PASS (${mode}, scope=${scope})`);
}

main().catch((error) => {
  console.error(`ALERT CHECK FAIL: ${error.message || error}`);
  process.exit(1);
});
