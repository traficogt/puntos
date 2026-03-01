import express from "express";
import { dbQuery } from "../database.js";
import { hasValidMetricsToken, buildProbeErrorBody, serviceInfo } from "./observability-shared.js";

async function checkDatabaseStatus() {
  const checks = {
    service: "ok",
    database: "unknown",
    timestamp: new Date().toISOString()
  };
  let healthy = true;

  try {
    const result = await dbQuery("SELECT 1 as health");
    checks.database = result.rows[0]?.health === 1 ? "ok" : "error";
  } catch {
    checks.database = "error";
    healthy = false;
  }

  return { checks, healthy };
}

async function appendSharedMetrics(metrics) {
  const dbStats = await dbQuery(`
    SELECT
      count(*) FILTER (WHERE state = 'active') as active_connections,
      count(*) FILTER (WHERE state = 'idle') as idle_connections,
      count(*) as total_connections
    FROM pg_stat_activity
    WHERE datname = current_database()
  `);
  const dbStat = dbStats.rows[0] || {};
  metrics.push(`# HELP puntos_db_connections_active Number of active database connections`);
  metrics.push(`# TYPE puntos_db_connections_active gauge`);
  metrics.push(`puntos_db_connections_active ${dbStat.active_connections || 0}`);
  metrics.push(`# HELP puntos_db_connections_idle Number of idle database connections`);
  metrics.push(`# TYPE puntos_db_connections_idle gauge`);
  metrics.push(`puntos_db_connections_idle ${dbStat.idle_connections || 0}`);

  const tableStats = await dbQuery(`
    SELECT 'customers' as table_name, count(*) as row_count
    FROM customers WHERE deleted_at IS NULL
    UNION ALL
    SELECT 'transactions', count(*) FROM transactions
    UNION ALL
    SELECT 'redemptions', count(*) FROM redemptions
  `);
  for (const row of tableStats.rows) {
    metrics.push(`# HELP puntos_table_rows_${row.table_name} Number of rows in ${row.table_name} table`);
    metrics.push(`# TYPE puntos_table_rows_${row.table_name} gauge`);
    metrics.push(`puntos_table_rows_${row.table_name} ${row.row_count}`);
  }

  const webhookStats = await dbQuery(`
    SELECT status, count(*) as count
    FROM webhook_deliveries
    WHERE created_at > now() - interval '24 hours'
    GROUP BY status
  `);
  const webhookCounts = { PENDING: 0, SENT: 0, FAILED: 0 };
  for (const row of webhookStats.rows) {
    webhookCounts[row.status] = parseInt(row.count, 10);
  }
  metrics.push(`# HELP puntos_webhook_deliveries_24h Webhook deliveries in last 24 hours by status`);
  metrics.push(`# TYPE puntos_webhook_deliveries_24h gauge`);
  metrics.push(`puntos_webhook_deliveries_24h{status="pending"} ${webhookCounts.PENDING}`);
  metrics.push(`puntos_webhook_deliveries_24h{status="sent"} ${webhookCounts.SENT}`);
  metrics.push(`puntos_webhook_deliveries_24h{status="failed"} ${webhookCounts.FAILED}`);

  const pointsStats = await dbQuery(`
    SELECT
      count(*) as customer_count,
      COALESCE(sum(points), 0) as total_points,
      COALESCE(avg(points), 0) as avg_points
    FROM customer_balances
  `);
  const pointStats = pointsStats.rows[0] || {};
  metrics.push(`# HELP puntos_customers_total Total number of customers with balances`);
  metrics.push(`# TYPE puntos_customers_total gauge`);
  metrics.push(`puntos_customers_total ${pointStats.customer_count || 0}`);
  metrics.push(`# HELP puntos_points_total Total points across all customers`);
  metrics.push(`# TYPE puntos_points_total gauge`);
  metrics.push(`puntos_points_total ${pointStats.total_points || 0}`);
  metrics.push(`# HELP puntos_points_average Average points per customer`);
  metrics.push(`# TYPE puntos_points_average gauge`);
  metrics.push(`puntos_points_average ${parseFloat(pointStats.avg_points || 0).toFixed(2)}`);
}

function appendProcessMetrics(metrics) {
  const memUsage = process.memoryUsage();
  metrics.push(`# HELP puntos_process_memory_bytes Process memory usage in bytes`);
  metrics.push(`# TYPE puntos_process_memory_bytes gauge`);
  metrics.push(`puntos_process_memory_bytes{type="rss"} ${memUsage.rss}`);
  metrics.push(`puntos_process_memory_bytes{type="heap_total"} ${memUsage.heapTotal}`);
  metrics.push(`puntos_process_memory_bytes{type="heap_used"} ${memUsage.heapUsed}`);
  metrics.push(`# HELP puntos_process_uptime_seconds Process uptime in seconds`);
  metrics.push(`# TYPE puntos_process_uptime_seconds gauge`);
  metrics.push(`puntos_process_uptime_seconds ${process.uptime()}`);
}

async function appendBillingMetrics(metrics) {
  const billingAgg = await dbQuery(`
    SELECT event_type, count(*) AS count
    FROM billing_events
    WHERE created_at > now() - interval '24 hours'
      AND event_type IN ('message.sent','message.failed','webhook.sent','webhook.failed')
    GROUP BY event_type
  `);
  const billingMap = { "message.sent": 0, "message.failed": 0, "webhook.sent": 0, "webhook.failed": 0 };
  for (const row of billingAgg.rows) {
    billingMap[row.event_type] = Number(row.count);
  }
  metrics.push(`# HELP puntos_billing_events_24h Message/Webhook billing events in last 24h`);
  metrics.push(`# TYPE puntos_billing_events_24h gauge`);
  for (const [eventType, count] of Object.entries(billingMap)) {
    metrics.push(`puntos_billing_events_24h{type="${eventType}"} ${count}`);
  }
}

async function appendBackgroundJobMetrics(metrics) {
  const jobCounts = await dbQuery(`
    SELECT status, count(*) AS count
    FROM background_jobs
    GROUP BY status
  `);
  const jobCountMap = { QUEUED: 0, RUNNING: 0, DONE: 0, FAILED: 0 };
  for (const row of jobCounts.rows) {
    jobCountMap[row.status] = Number(row.count);
  }
  metrics.push(`# HELP puntos_jobs_total Background jobs by status`);
  metrics.push(`# TYPE puntos_jobs_total gauge`);
  metrics.push(`puntos_jobs_total{status="queued"} ${jobCountMap.QUEUED}`);
  metrics.push(`puntos_jobs_total{status="running"} ${jobCountMap.RUNNING}`);
  metrics.push(`puntos_jobs_total{status="done"} ${jobCountMap.DONE}`);
  metrics.push(`puntos_jobs_total{status="failed"} ${jobCountMap.FAILED}`);

  const oldestQueued = await dbQuery(`
    SELECT EXTRACT(EPOCH FROM (now() - run_after)) AS age_seconds
    FROM background_jobs
    WHERE status='QUEUED'
    ORDER BY run_after ASC
    LIMIT 1
  `);
  const ageSeconds = Number(oldestQueued.rows?.[0]?.age_seconds ?? 0);
  metrics.push(`# HELP puntos_jobs_oldest_age_seconds Age of oldest queued job (negative means scheduled in future)`);
  metrics.push(`# TYPE puntos_jobs_oldest_age_seconds gauge`);
  metrics.push(`puntos_jobs_oldest_age_seconds ${ageSeconds.toFixed(0)}`);

  const churnLast = await dbQuery(`
    SELECT EXTRACT(EPOCH FROM max(created_at)) AS last_ts
    FROM message_logs
    WHERE channel = 'CHURN'
  `);
  const churnTs = Number(churnLast.rows?.[0]?.last_ts ?? 0);
  metrics.push(`# HELP puntos_churn_last_sent_timestamp Unix timestamp of last churn message sent`);
  metrics.push(`# TYPE puntos_churn_last_sent_timestamp gauge`);
  metrics.push(`puntos_churn_last_sent_timestamp ${churnTs.toFixed(0)}`);
}

export function createObservabilityRouter(options = {}) {
  const {
    getPromMetrics = null,
    getQueueHealth = null,
    includeQueueHealth = false,
    includeBillingMetrics = false,
    includeBackgroundJobMetrics = false,
    includeQueueMetrics = false
  } = options;

  const router = express.Router();

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
        redis: driver === "redis" ? "ok" : "disabled"
      });
    });
  }

  router.get("/ready", async (_req, res) => {
    try {
      await Promise.race([
        dbQuery("SELECT 1"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Database timeout")), 2000))
      ]);
      res.status(200).json({
        ready: true,
        timestamp: new Date().toISOString()
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
      await appendSharedMetrics(metrics);
      if (includeBillingMetrics) await appendBillingMetrics(metrics);
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
      if (includeBackgroundJobMetrics) await appendBackgroundJobMetrics(metrics);
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

  router.get("/info", (_req, res) => {
    res.json(serviceInfo());
  });

  return router;
}
