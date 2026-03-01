const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const baseUrl = getArg("--url", process.env.PERF_BASE_URL || "http://localhost:3001");
const path = getArg("--path", process.env.PERF_PATH || "/api/health");
const totalRequests = Number(getArg("--requests", process.env.PERF_REQUESTS || 120));
const concurrency = Number(getArg("--concurrency", process.env.PERF_CONCURRENCY || 12));
const maxP95Ms = Number(getArg("--max-p95-ms", process.env.PERF_MAX_P95_MS || 600));
const maxErrorRate = Number(getArg("--max-error-rate", process.env.PERF_MAX_ERROR_RATE || 0.02));
const timeoutMs = Number(getArg("--timeout-ms", process.env.PERF_TIMEOUT_MS || 4000));

const durations = [];
let failures = 0;

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
  return sorted[idx];
}

async function hit(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const res = await fetch(endpoint, { signal: controller.signal });
    const ms = performance.now() - started;
    durations.push(ms);
    if (!res.ok) failures += 1;
  } catch {
    const ms = performance.now() - started;
    durations.push(ms);
    failures += 1;
  } finally {
    clearTimeout(timer);
  }
}

async function run() {
  const endpoint = `${baseUrl}${path}`;
  console.log(`Perf sanity: ${endpoint} | requests=${totalRequests} concurrency=${concurrency}`);

  // Warm-up
  for (let i = 0; i < Math.min(10, totalRequests); i += 1) {
    await hit(endpoint);
  }

  const started = performance.now();
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (cursor < totalRequests) {
      cursor += 1;
      await hit(endpoint);
    }
  });
  await Promise.all(workers);
  const totalMs = performance.now() - started;

  const success = durations.length - failures;
  const errorRate = durations.length ? failures / durations.length : 1;
  const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  const max = durations.length ? Math.max(...durations) : 0;
  const rps = totalMs > 0 ? (durations.length / totalMs) * 1000 : 0;

  console.log(`requests=${durations.length} success=${success} failures=${failures} error_rate=${(errorRate * 100).toFixed(2)}%`);
  console.log(`latency_ms avg=${avgMs.toFixed(1)} p50=${p50.toFixed(1)} p95=${p95.toFixed(1)} max=${max.toFixed(1)} rps=${rps.toFixed(1)}`);
  console.log(`thresholds p95<=${maxP95Ms}ms error_rate<=${(maxErrorRate * 100).toFixed(2)}%`);

  if (success === 0) {
    console.error("PERF_SANITY=FAIL endpoint_unavailable=true");
    process.exit(2);
  }

  if (p95 > maxP95Ms || errorRate > maxErrorRate) {
    console.error("PERF_SANITY=FAIL");
    process.exit(1);
  }
  console.log("PERF_SANITY=PASS");
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
