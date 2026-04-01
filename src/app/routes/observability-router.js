import express from "express";
import { dbQuery } from "../database.js";
import {
  appendBackgroundJobMetrics as appendBackgroundJobMetricsShared,
  appendBillingMetrics as appendBillingMetricsShared,
  appendProcessMetrics as appendProcessMetricsShared,
  appendSharedMetrics as appendSharedMetricsShared,
  buildProbeErrorBody,
  checkDatabaseStatus as checkDatabaseStatusShared,
  createCachedMetricSection,
  DEFAULT_METRICS_CACHE_TTL_MS,
  hasValidMetricsToken,
  serviceInfo
} from "./observability-shared.js";

export { createCachedMetricSection, DEFAULT_METRICS_CACHE_TTL_MS };

async function checkDatabaseStatus() {
  return checkDatabaseStatusShared();
}

async function appendSharedMetrics(metrics) {
  return appendSharedMetricsShared(metrics);
}

function appendProcessMetrics(metrics) {
  return appendProcessMetricsShared(metrics);
}

async function appendBillingMetrics(metrics) {
  return appendBillingMetricsShared(metrics);
}

async function appendBackgroundJobMetrics(metrics) {
  return appendBackgroundJobMetricsShared(metrics);
}

export function createObservabilityRouter(options = {}) {
  const {
    getPromMetrics = null,
    getQueueHealth = null,
    includeQueueHealth = false,
    includeBillingMetrics = false,
    includeBackgroundJobMetrics = false,
    includeQueueMetrics = false,
    metricsCacheTtlMs = DEFAULT_METRICS_CACHE_TTL_MS
  } = options;

  const router = express.Router();
  const getSharedMetricLines = createCachedMetricSection(async () => {
    const lines = [];
    await appendSharedMetrics(lines);
    return lines;
  }, { ttlMs: metricsCacheTtlMs });
  const getBillingMetricLines = createCachedMetricSection(async () => {
    const lines = [];
    await appendBillingMetrics(lines);
    return lines;
  }, { ttlMs: metricsCacheTtlMs });
  const getBackgroundJobMetricLines = createCachedMetricSection(async () => {
    const lines = [];
    await appendBackgroundJobMetrics(lines);
    return lines;
  }, { ttlMs: metricsCacheTtlMs });

  router.get("/health", async (_req, res) => {
    const { checks, healthy } = await checkDatabaseStatus();
    res.status(healthy ? 200 : 503).json(checks);
  });

  if (includeQueueHealth && typeof getQueueHealth === "function") {
    router.get("/queue/health", async (_req, res) => {
      const queueHealth = await getQueueHealth();
      const driver = queueHealth?.driver ?? "db";
      res.json({
        driver,
        queueDepth: queueHealth?.queueDepth ?? 0,
        healthy: queueHealth?.healthy ?? true,
        redis: queueHealth?.redis ?? (driver === "redis" ? "ok" : "disabled"),
        lastError: queueHealth?.lastError ?? null
      });
    });
  }

  router.get("/ready", async (_req, res) => {
    const checks = {
      database: "unknown",
      queue: includeQueueHealth ? "unknown" : "disabled"
    };
    try {
      await Promise.race([
        dbQuery("SELECT 1"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Database timeout")), 2000))
      ]);
      checks.database = "ok";
      let queueHealth = null;
      if (includeQueueHealth && typeof getQueueHealth === "function") {
        queueHealth = await getQueueHealth();
        checks.queue = queueHealth?.healthy === false ? "error" : (queueHealth?.driver === "redis" ? "ok" : "disabled");
      }
      const ready = checks.database === "ok" && checks.queue !== "error";
      res.status(ready ? 200 : 503).json({
        ready,
        checks,
        timestamp: new Date().toISOString(),
        queue: queueHealth ? {
          driver: queueHealth.driver ?? "db",
          queueDepth: queueHealth.queueDepth ?? 0,
          healthy: queueHealth.healthy ?? true
        } : undefined
      });
    } catch {
      res.status(503).json(buildProbeErrorBody({ ready: false }));
    }
  });

  router.get("/live", (_req, res) => {
    res.status(200).json({
      alive: true,
      timestamp: new Date().toISOString()
    });
  });

  router.get("/metrics", async (req, res) => {
    if (!hasValidMetricsToken(req)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const metrics = [];
    try {
      if (typeof getPromMetrics === "function") {
        const promMetrics = await getPromMetrics();
        if (promMetrics) metrics.push(String(promMetrics).trim());
      }
      metrics.push(...await getSharedMetricLines());
      if (includeBillingMetrics) metrics.push(...await getBillingMetricLines());
      if (includeQueueMetrics && typeof getQueueHealth === "function") {
        const queueHealth = await getQueueHealth();
        if (queueHealth) {
          metrics.push(`# HELP puntos_job_queue_depth Number of jobs queued in Redis`);
          metrics.push(`# TYPE puntos_job_queue_depth gauge`);
          metrics.push(`puntos_job_queue_depth ${queueHealth.queueDepth}`);
          metrics.push(`# HELP puntos_job_queue_driver Job queue driver in use (1=redis,0=db)`);
          metrics.push(`# TYPE puntos_job_queue_driver gauge`);
          metrics.push(`puntos_job_queue_driver ${queueHealth.driver === "redis" ? 1 : 0}`);
        }
      }
      if (includeBackgroundJobMetrics) metrics.push(...await getBackgroundJobMetricLines());
      appendProcessMetrics(metrics);

      res.set("Content-Type", "text/plain; version=0.0.4");
      return res.send(`${metrics.join("\n")}\n`);
    } catch {
      metrics.push(`# HELP puntos_metrics_error Metrics collection error`);
      metrics.push(`# TYPE puntos_metrics_error gauge`);
      metrics.push(`puntos_metrics_error 1`);
      res.set("Content-Type", "text/plain; version=0.0.4");
      return res.status(500).send(`${metrics.join("\n")}\n`);
    }
  });

  router.get("/info", async (_req, res) => {
    const info = serviceInfo();
    if (includeQueueHealth && typeof getQueueHealth === "function") {
      const queueHealth = await getQueueHealth();
      return res.json({
        ...info,
        queue: {
          driver: queueHealth?.driver ?? "db",
          queueDepth: queueHealth?.queueDepth ?? 0,
          healthy: queueHealth?.healthy ?? true
        }
      });
    }
    res.json(info);
  });

  return router;
}
