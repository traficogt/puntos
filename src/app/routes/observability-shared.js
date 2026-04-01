import { createRequire } from "node:module";
import path from "node:path";
import { config } from "../../config/index.js";
import { dbQuery } from "../database.js";

const require = createRequire(import.meta.url);
const pkg = require(path.join(process.cwd(), "package.json"));
export const DEFAULT_METRICS_CACHE_TTL_MS = 60_000;

function buildSha() {
  return String(process.env.RELEASE_SHA || process.env.GITHUB_SHA || "").trim();
}

function buildTimestamp() {
  return String(process.env.BUILD_TIMESTAMP || process.env.GITHUB_RUN_STARTED_AT || "").trim();
}

export function hasValidMetricsToken(req) {
  const configured = String(config.METRICS_TOKEN || "").trim();
  if (!configured) return false;

  const auth = String(req.headers.authorization || "");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const header = String(req.headers["x-metrics-token"] || "").trim();
  return bearer === configured || header === configured;
}

export function buildProbeErrorBody(baseBody) {
  return {
    ...baseBody,
    error: "Service unavailable",
    timestamp: new Date().toISOString()
  };
}

export function createCachedMetricSection(load, { ttlMs = DEFAULT_METRICS_CACHE_TTL_MS, now = Date.now } = {}) {
  let cache = null;
  let inFlight = null;

  return async function getCachedMetricSection() {
    const ts = Number(now());
    if (cache && ts - cache.ts < ttlMs) {
      return [...cache.lines];
    }
    if (inFlight) {
      const lines = await inFlight;
      return [...lines];
    }

    inFlight = (async () => {
      const lines = await load();
      const stableLines = Array.isArray(lines) ? [...lines] : [];
      cache = { ts: Number(now()), lines: stableLines };
      return stableLines;
    })();

    try {
      const lines = await inFlight;
      return [...lines];
    } finally {
      inFlight = null;
    }
  };
}

export async function checkDatabaseStatus() {
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

export async function appendSharedMetrics(metrics) {
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

  const paymentWebhookStats = await dbQuery(`
    SELECT status, count(*) as count
    FROM payment_webhook_events
    WHERE created_at > now() - interval '24 hours'
    GROUP BY status
  `);
  const paymentWebhookCounts = {
    APPLIED: 0,
    FAILED: 0,
    PENDING_MAPPING: 0,
    IGNORED: 0
  };
  for (const row of paymentWebhookStats.rows) {
    paymentWebhookCounts[row.status] = Number(row.count);
  }
  metrics.push(`# HELP puntos_payment_webhook_events_24h Payment webhook events in last 24 hours by status`);
  metrics.push(`# TYPE puntos_payment_webhook_events_24h gauge`);
  metrics.push(`puntos_payment_webhook_events_24h{status="applied"} ${paymentWebhookCounts.APPLIED}`);
  metrics.push(`puntos_payment_webhook_events_24h{status="failed"} ${paymentWebhookCounts.FAILED}`);
  metrics.push(`puntos_payment_webhook_events_24h{status="pending_mapping"} ${paymentWebhookCounts.PENDING_MAPPING}`);
  metrics.push(`puntos_payment_webhook_events_24h{status="ignored"} ${paymentWebhookCounts.IGNORED}`);

  const paymentWebhookBacklog = await dbQuery(`
    SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at))) AS age_seconds
    FROM payment_webhook_events
    WHERE status = 'PENDING_MAPPING'
  `);
  const pendingMappingAgeSeconds = Number(paymentWebhookBacklog.rows?.[0]?.age_seconds ?? 0);
  metrics.push(`# HELP puntos_payment_webhook_pending_mapping_oldest_age_seconds Age of the oldest payment webhook waiting for customer mapping`);
  metrics.push(`# TYPE puntos_payment_webhook_pending_mapping_oldest_age_seconds gauge`);
  metrics.push(`puntos_payment_webhook_pending_mapping_oldest_age_seconds ${pendingMappingAgeSeconds.toFixed(0)}`);

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

  const reconciliationLast = await dbQuery(`
    SELECT
      COALESCE(EXTRACT(EPOCH FROM MAX(completed_at)), 0) AS last_completed_ts
    FROM ledger_reconciliation_runs
    WHERE status = 'COMPLETED'
  `);
  const reconciliationLatest = await dbQuery(`
    SELECT
      checked_customers,
      mismatched_customers,
      repaired_customers
    FROM ledger_reconciliation_runs
    WHERE status = 'COMPLETED'
    ORDER BY completed_at DESC
    LIMIT 1
  `);
  const latestRun = reconciliationLatest.rows?.[0] || {};
  const lastCompletedTs = Number(reconciliationLast.rows?.[0]?.last_completed_ts ?? 0);
  metrics.push(`# HELP puntos_ledger_reconciliation_last_completed_timestamp Unix timestamp of the latest completed ledger reconciliation run`);
  metrics.push(`# TYPE puntos_ledger_reconciliation_last_completed_timestamp gauge`);
  metrics.push(`puntos_ledger_reconciliation_last_completed_timestamp ${lastCompletedTs.toFixed(0)}`);
  metrics.push(`# HELP puntos_ledger_reconciliation_checked_customers_total Customers checked in the latest completed ledger reconciliation run`);
  metrics.push(`# TYPE puntos_ledger_reconciliation_checked_customers_total gauge`);
  metrics.push(`puntos_ledger_reconciliation_checked_customers_total ${Number(latestRun.checked_customers || 0)}`);
  metrics.push(`# HELP puntos_ledger_reconciliation_mismatched_customers_total Customers with balance drift in the latest completed ledger reconciliation run`);
  metrics.push(`# TYPE puntos_ledger_reconciliation_mismatched_customers_total gauge`);
  metrics.push(`puntos_ledger_reconciliation_mismatched_customers_total ${Number(latestRun.mismatched_customers || 0)}`);
  metrics.push(`# HELP puntos_ledger_reconciliation_repaired_customers_total Customers auto-repaired in the latest completed ledger reconciliation run`);
  metrics.push(`# TYPE puntos_ledger_reconciliation_repaired_customers_total gauge`);
  metrics.push(`puntos_ledger_reconciliation_repaired_customers_total ${Number(latestRun.repaired_customers || 0)}`);

  const anomalyStats = await dbQuery(`
    SELECT
      COALESCE((
        SELECT COUNT(*)
        FROM customer_balances cb
        JOIN customers c ON c.id = cb.customer_id
        WHERE c.deleted_at IS NULL
          AND cb.points < 0
      ), 0)::int AS negative_balances,
      COALESCE((
        SELECT COUNT(*)
        FROM transactions
        WHERE source = 'reversal'
          AND created_at >= now() - interval '24 hours'
      ), 0)::int AS reversals_24h,
      COALESCE((
        SELECT COUNT(*)
        FROM audit_logs
        WHERE action IN (
          'award.replay',
          'reward.redeem.replay',
          'award.refund.replay',
          'gift_card.issue.replay',
          'gift_card.redeem.replay',
          'external_award.replay'
        )
          AND created_at >= now() - interval '24 hours'
      ), 0)::int AS replay_events_24h,
      COALESCE((
        SELECT COUNT(*)
        FROM ledger_balance_corrections
        WHERE status = 'PENDING'
      ), 0)::int AS pending_corrections
  `);
  const anomaly = anomalyStats.rows?.[0] || {};
  metrics.push(`# HELP puntos_negative_balances_total Customers with negative point balances`);
  metrics.push(`# TYPE puntos_negative_balances_total gauge`);
  metrics.push(`puntos_negative_balances_total ${Number(anomaly.negative_balances || 0)}`);
  metrics.push(`# HELP puntos_reversals_24h_total Reversal transactions created in the last 24 hours`);
  metrics.push(`# TYPE puntos_reversals_24h_total gauge`);
  metrics.push(`puntos_reversals_24h_total ${Number(anomaly.reversals_24h || 0)}`);
  metrics.push(`# HELP puntos_value_replay_events_24h_total Deduplicated value-changing replay events in the last 24 hours`);
  metrics.push(`# TYPE puntos_value_replay_events_24h_total gauge`);
  metrics.push(`puntos_value_replay_events_24h_total ${Number(anomaly.replay_events_24h || 0)}`);
  metrics.push(`# HELP puntos_pending_ledger_corrections_total Pending manual ledger corrections awaiting owner review`);
  metrics.push(`# TYPE puntos_pending_ledger_corrections_total gauge`);
  metrics.push(`puntos_pending_ledger_corrections_total ${Number(anomaly.pending_corrections || 0)}`);
}

export function appendProcessMetrics(metrics) {
  const info = serviceInfo();
  const memUsage = process.memoryUsage();
  metrics.push(`# HELP puntos_process_memory_bytes Process memory usage in bytes`);
  metrics.push(`# TYPE puntos_process_memory_bytes gauge`);
  metrics.push(`puntos_process_memory_bytes{type="rss"} ${memUsage.rss}`);
  metrics.push(`puntos_process_memory_bytes{type="heap_total"} ${memUsage.heapTotal}`);
  metrics.push(`puntos_process_memory_bytes{type="heap_used"} ${memUsage.heapUsed}`);
  metrics.push(`# HELP puntos_process_uptime_seconds Process uptime in seconds`);
  metrics.push(`# TYPE puntos_process_uptime_seconds gauge`);
  metrics.push(`puntos_process_uptime_seconds ${process.uptime()}`);
  metrics.push(`# HELP puntos_build_info Build and runtime identity`);
  metrics.push(`# TYPE puntos_build_info gauge`);
  metrics.push(
    `puntos_build_info{service="${info.service}",version="${info.version}",environment="${info.environment}",build_sha="${info.build_sha || "unknown"}"} 1`
  );
}

export async function appendBillingMetrics(metrics) {
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

export async function appendBackgroundJobMetrics(metrics) {
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

  const runningAges = await dbQuery(`
    SELECT
      COALESCE(MAX(EXTRACT(EPOCH FROM (now() - started_at))) FILTER (WHERE status = 'RUNNING'), 0) AS oldest_running_age_seconds,
      COALESCE(COUNT(*) FILTER (WHERE status = 'RUNNING' AND started_at <= now() - interval '15 minutes'), 0) AS stale_running_count,
      COALESCE(COUNT(*) FILTER (WHERE completed_at >= now() - interval '24 hours' AND status = 'FAILED'), 0) AS failed_24h
    FROM background_jobs
    WHERE status = 'RUNNING' OR completed_at >= now() - interval '24 hours'
  `);
  const running = runningAges.rows?.[0] || {};
  metrics.push(`# HELP puntos_jobs_running_oldest_age_seconds Age of the oldest running background job`);
  metrics.push(`# TYPE puntos_jobs_running_oldest_age_seconds gauge`);
  metrics.push(`puntos_jobs_running_oldest_age_seconds ${Number(running.oldest_running_age_seconds || 0).toFixed(0)}`);
  metrics.push(`# HELP puntos_jobs_running_stale_total Background jobs still running after 15 minutes`);
  metrics.push(`# TYPE puntos_jobs_running_stale_total gauge`);
  metrics.push(`puntos_jobs_running_stale_total ${Number(running.stale_running_count || 0)}`);
  metrics.push(`# HELP puntos_jobs_failed_24h Background jobs failed in the last 24 hours`);
  metrics.push(`# TYPE puntos_jobs_failed_24h gauge`);
  metrics.push(`puntos_jobs_failed_24h ${Number(running.failed_24h || 0)}`);

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

export function serviceInfo() {
  return {
    service: "PuntosFieles",
    version: pkg.version,
    environment: config.NODE_ENV,
    build_sha: buildSha() || null,
    build_timestamp: buildTimestamp() || null,
    uptime_seconds: process.uptime(),
    node_version: process.version,
    timestamp: new Date().toISOString()
  };
}
