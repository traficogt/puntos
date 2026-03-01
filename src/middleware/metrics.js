import { Histogram, Counter, collectDefaultMetrics, Registry } from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry });

const httpDuration = new Histogram({
  name: "puntos_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "path", "status"],
  buckets: [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 2, 3, 5]
});

const httpRequests = new Counter({
  name: "puntos_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "path", "status"]
});

registry.registerMetric(httpDuration);
registry.registerMetric(httpRequests);

export function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const deltaNs = Number(process.hrtime.bigint() - start);
    const sec = deltaNs / 1e9;
    const path = normalizePath(req);
    const labels = { method: req.method, path, status: String(res.statusCode) };
    httpDuration.labels(labels.method, labels.path, labels.status).observe(sec);
    httpRequests.labels(labels.method, labels.path, labels.status).inc();
  });
  next();
}

function normalizePath(req) {
  const url = req.originalUrl || req.url || "";
  // collapse IDs and UUIDs to :id
  return url
    .replace(/\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b/gi, ":uuid")
    .replace(/\\b\\d{6,}\\b/g, ":id")
    .split("?")[0];
}

export function getRegistry() {
  return registry;
}
