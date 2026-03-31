import fs from "node:fs";
import path from "node:path";

import { toCSV } from "../../utils/csv.js";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function resolveCertificationPeriod(query = {}) {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);

  return {
    from: query?.from ? String(query.from) : formatDate(start),
    to: query?.to ? String(query.to) : formatDate(end)
  };
}

function replayActions() {
  return [
    "award.replay",
    "reward.redeem.replay",
    "award.refund.replay",
    "gift_card.issue.replay",
    "gift_card.redeem.replay",
    "external_award.replay"
  ];
}

function sanitizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "business";
}

function parseRetentionDays(value, fallback = 90) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function dayDirectoryName(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : "";
}

function relativeArtifactPath(outputRoot, filePath) {
  return path.relative(outputRoot, filePath).replaceAll(path.sep, "/");
}

function certificationOutputRoot(root = path.join(process.cwd(), "artifacts", "ledger-certifications")) {
  return String(process.env.LEDGER_CERTIFICATION_OUTPUT_ROOT || root);
}

function certificationRetentionDays() {
  return parseRetentionDays(process.env.LEDGER_CERTIFICATION_RETENTION_DAYS, 90);
}

function readJsonFile(fsModule, filePath) {
  return JSON.parse(fsModule.readFileSync(filePath, "utf8"));
}

function writeJsonFile(fsModule, filePath, payload) {
  fsModule.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function listDayDirectories(fsModule, outputRoot) {
  if (!fsModule.existsSync(outputRoot)) return [];
  return fsModule.readdirSync(outputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && dayDirectoryName(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function pruneOldCertificationDays(fsModule, outputRoot, retentionDays) {
  if (!fsModule.existsSync(outputRoot) || retentionDays <= 0) {
    return { prunedDays: [], keptDays: listDayDirectories(fsModule, outputRoot) };
  }

  const dayNames = listDayDirectories(fsModule, outputRoot);
  if (dayNames.length <= retentionDays) {
    return { prunedDays: [], keptDays: dayNames };
  }

  const keep = new Set(dayNames.slice(-retentionDays));
  const prunedDays = [];
  for (const dayName of dayNames) {
    if (keep.has(dayName)) continue;
    const dayDir = path.join(outputRoot, dayName);
    fsModule.rmSync(dayDir, { recursive: true, force: true });
    prunedDays.push(dayName);
  }
  return { prunedDays, keptDays: dayNames.filter((dayName) => keep.has(dayName)) };
}

function buildDayManifest(fsModule, outputRoot, dayName) {
  const dayDir = path.join(outputRoot, dayName);
  if (!fsModule.existsSync(dayDir)) return null;

  const artifacts = fsModule.readdirSync(dayDir)
    .filter((file) => file.endsWith(".json") && file !== "index.json")
    .sort()
    .map((file) => {
      const filePath = path.join(dayDir, file);
      const report = readJsonFile(fsModule, filePath);
      const csvPath = filePath.replace(/\.json$/u, ".csv");
      return {
        businessId: report.business?.id || "",
        businessName: report.business?.name || "",
        businessSlug: report.business?.slug || "",
        certificationStatus: report.certification_status || "UNKNOWN",
        period: report.period || {},
        generatedAt: report.generated_at || null,
        jsonPath: relativeArtifactPath(outputRoot, filePath),
        csvPath: relativeArtifactPath(outputRoot, csvPath)
      };
    });

  const manifest = {
    generated_at: new Date().toISOString(),
    date: dayName,
    business_count: artifacts.length,
    artifacts
  };
  writeJsonFile(fsModule, path.join(dayDir, "index.json"), manifest);
  return manifest;
}

function safeManifestPath(outputRoot, dayName) {
  return path.join(outputRoot, dayName, "index.json");
}

function safeArtifactFileName(value) {
  return /^[a-z0-9-]+_[a-z0-9-]+\.(json|csv)$/i.test(String(value || "")) ? String(value) : "";
}

function refreshCertificationIndexes(fsModule, outputRoot, retentionDays) {
  const dayNames = listDayDirectories(fsModule, outputRoot);
  const days = dayNames.map((dayName) => {
    const manifest = buildDayManifest(fsModule, outputRoot, dayName);
    return {
      date: dayName,
      business_count: manifest?.business_count || 0,
      manifest_path: `${dayName}/index.json`,
      artifact_dir: dayName
    };
  }).sort((a, b) => b.date.localeCompare(a.date));

  const rootIndex = {
    generated_at: new Date().toISOString(),
    retention_days: retentionDays,
    day_count: days.length,
    days
  };

  if (!fsModule.existsSync(outputRoot)) {
    fsModule.mkdirSync(outputRoot, { recursive: true });
  }
  writeJsonFile(fsModule, path.join(outputRoot, "index.json"), rootIndex);
  return rootIndex;
}

export async function readLedgerCertificationReportWithDeps(
  deps,
  businessId,
  from,
  to
) {
  const [{ rows: businessRows }, { rows: dailyRows }, { rows: statusRows }] = await Promise.all([
    deps.dbQuery(
      `SELECT id, name, slug
       FROM businesses
       WHERE id = $1`,
      [businessId]
    ),
    deps.dbQuery(
      `WITH days AS (
         SELECT generate_series($2::date, $3::date, interval '1 day')::date AS day
       ),
       tx_daily AS (
         SELECT
           created_at::date AS day,
           COALESCE(SUM(CASE WHEN status = 'POSTED' AND points > 0 AND source <> 'reversal' THEN points ELSE 0 END), 0)::int AS points_issued,
           COALESCE(SUM(CASE WHEN status = 'POSTED' AND source = 'redeem' THEN ABS(points) ELSE 0 END), 0)::int AS points_redeemed,
           COALESCE(SUM(CASE WHEN status = 'POSTED' AND source = 'reversal' THEN ABS(points) ELSE 0 END), 0)::int AS points_reversed,
           COALESCE(SUM(CASE WHEN status = 'POSTED' AND source = 'expire' THEN ABS(points) ELSE 0 END), 0)::int AS points_expired
         FROM transactions
         WHERE business_id = $1
           AND created_at::date BETWEEN $2::date AND $3::date
         GROUP BY created_at::date
       ),
       adjustment_daily AS (
         SELECT
           created_at::date AS day,
           COALESCE(SUM(delta_points), 0)::int AS adjustment_points
         FROM ledger_balance_adjustments
         WHERE business_id = $1
           AND created_at::date BETWEEN $2::date AND $3::date
         GROUP BY created_at::date
       ),
       gift_card_daily AS (
         SELECT
           created_at::date AS day,
           COALESCE(SUM(CASE WHEN tx_type = 'ISSUE' THEN amount_q ELSE 0 END), 0)::numeric(10,2) AS gift_cards_issued_q,
           COALESCE(SUM(CASE WHEN tx_type = 'REDEEM' THEN amount_q ELSE 0 END), 0)::numeric(10,2) AS gift_cards_redeemed_q
         FROM gift_card_transactions
         WHERE business_id = $1
           AND created_at::date BETWEEN $2::date AND $3::date
         GROUP BY created_at::date
       ),
       replay_daily AS (
         SELECT
           created_at::date AS day,
           COUNT(*)::int AS replay_events
         FROM audit_logs
         WHERE business_id = $1
           AND action = ANY($4::text[])
           AND created_at::date BETWEEN $2::date AND $3::date
         GROUP BY created_at::date
       )
       SELECT
         d.day,
         COALESCE(tx.points_issued, 0)::int AS points_issued,
         COALESCE(tx.points_redeemed, 0)::int AS points_redeemed,
         COALESCE(tx.points_reversed, 0)::int AS points_reversed,
         COALESCE(tx.points_expired, 0)::int AS points_expired,
         COALESCE(adj.adjustment_points, 0)::int AS adjustment_points,
         COALESCE(gc.gift_cards_issued_q, 0)::numeric(10,2) AS gift_cards_issued_q,
         COALESCE(gc.gift_cards_redeemed_q, 0)::numeric(10,2) AS gift_cards_redeemed_q,
         COALESCE(rp.replay_events, 0)::int AS replay_events
       FROM days d
       LEFT JOIN tx_daily tx ON tx.day = d.day
       LEFT JOIN adjustment_daily adj ON adj.day = d.day
       LEFT JOIN gift_card_daily gc ON gc.day = d.day
       LEFT JOIN replay_daily rp ON rp.day = d.day
       ORDER BY d.day ASC`,
      [businessId, from, to, replayActions()]
    ),
    deps.dbQuery(
      `WITH latest_run AS (
         SELECT completed_at, mismatched_customers
         FROM ledger_reconciliation_runs
         WHERE status = 'COMPLETED'
           AND (business_id = $1 OR business_id IS NULL)
         ORDER BY completed_at DESC
         LIMIT 1
       )
       SELECT
         COALESCE((
           SELECT COUNT(*)
           FROM ledger_balance_corrections
           WHERE business_id = $1
             AND status = 'PENDING'
         ), 0)::int AS pending_corrections_count,
         COALESCE((
           SELECT COUNT(*)
           FROM customer_balances cb
           JOIN customers c ON c.id = cb.customer_id
           WHERE c.business_id = $1
             AND c.deleted_at IS NULL
             AND cb.points < 0
         ), 0)::int AS negative_balance_count,
         COALESCE((SELECT mismatched_customers FROM latest_run), 0)::int AS latest_reconciliation_mismatches,
         (SELECT completed_at FROM latest_run) AS latest_reconciliation_completed_at`,
      [businessId]
    )
  ]);

  const business = businessRows[0] ?? { id: businessId, name: "Unknown business", slug: "" };
  const status = statusRows[0] ?? {};
  const daily = dailyRows.map((row) => ({
    date: String(row.day).slice(0, 10),
    points_issued: Number(row.points_issued || 0),
    points_redeemed: Number(row.points_redeemed || 0),
    points_reversed: Number(row.points_reversed || 0),
    points_expired: Number(row.points_expired || 0),
    adjustment_points: Number(row.adjustment_points || 0),
    gift_cards_issued_q: Number(row.gift_cards_issued_q || 0),
    gift_cards_redeemed_q: Number(row.gift_cards_redeemed_q || 0),
    replay_events: Number(row.replay_events || 0)
  }));

  const totals = daily.reduce((acc, row) => {
    acc.points_issued += row.points_issued;
    acc.points_redeemed += row.points_redeemed;
    acc.points_reversed += row.points_reversed;
    acc.points_expired += row.points_expired;
    acc.adjustment_points += row.adjustment_points;
    acc.gift_cards_issued_q += row.gift_cards_issued_q;
    acc.gift_cards_redeemed_q += row.gift_cards_redeemed_q;
    acc.replay_events += row.replay_events;
    return acc;
  }, {
    points_issued: 0,
    points_redeemed: 0,
    points_reversed: 0,
    points_expired: 0,
    adjustment_points: 0,
    gift_cards_issued_q: 0,
    gift_cards_redeemed_q: 0,
    replay_events: 0
  });

  const summary = {
    ...totals,
    gift_cards_issued_q: Number(totals.gift_cards_issued_q.toFixed(2)),
    gift_cards_redeemed_q: Number(totals.gift_cards_redeemed_q.toFixed(2)),
    pending_corrections_count: Number(status.pending_corrections_count || 0),
    negative_balance_count: Number(status.negative_balance_count || 0),
    latest_reconciliation_mismatches: Number(status.latest_reconciliation_mismatches || 0),
    latest_reconciliation_completed_at: status.latest_reconciliation_completed_at || null
  };

  const certificationStatus = (
    summary.pending_corrections_count > 0
    || summary.negative_balance_count > 0
    || summary.latest_reconciliation_mismatches > 0
  ) ? "REVIEW_REQUIRED" : "OK";

  return {
    ok: true,
    business,
    generated_at: new Date().toISOString(),
    period: { from, to },
    certification_status: certificationStatus,
    summary,
    daily_rows: daily
  };
}

export async function readLedgerCertificationReport(businessId, from, to) {
  const { dbQuery } = await import("../database.js");
  return readLedgerCertificationReportWithDeps({ dbQuery }, businessId, from, to);
}

export function toCertificationCsvRows(report) {
  const totalRow = {
    row_type: "TOTAL",
    date: "",
    points_issued: report.summary.points_issued,
    points_redeemed: report.summary.points_redeemed,
    points_reversed: report.summary.points_reversed,
    points_expired: report.summary.points_expired,
    adjustment_points: report.summary.adjustment_points,
    gift_cards_issued_q: report.summary.gift_cards_issued_q.toFixed(2),
    gift_cards_redeemed_q: report.summary.gift_cards_redeemed_q.toFixed(2),
    replay_events: report.summary.replay_events,
    certification_status: report.certification_status,
    pending_corrections_count: report.summary.pending_corrections_count,
    latest_reconciliation_mismatches: report.summary.latest_reconciliation_mismatches,
    negative_balance_count: report.summary.negative_balance_count,
    latest_reconciliation_completed_at: report.summary.latest_reconciliation_completed_at || "",
    generated_at: report.generated_at,
    period_from: report.period.from,
    period_to: report.period.to
  };

  const dayRows = report.daily_rows.map((row) => ({
    row_type: "DAY",
    date: row.date,
    points_issued: row.points_issued,
    points_redeemed: row.points_redeemed,
    points_reversed: row.points_reversed,
    points_expired: row.points_expired,
    adjustment_points: row.adjustment_points,
    gift_cards_issued_q: row.gift_cards_issued_q.toFixed(2),
    gift_cards_redeemed_q: row.gift_cards_redeemed_q.toFixed(2),
    replay_events: row.replay_events,
    certification_status: "",
    pending_corrections_count: "",
    latest_reconciliation_mismatches: "",
    negative_balance_count: "",
    latest_reconciliation_completed_at: "",
    generated_at: "",
    period_from: "",
    period_to: ""
  }));

  return [totalRow, ...dayRows];
}

export function ledgerCertificationCsv(report) {
  return toCSV(toCertificationCsvRows(report), [
    "row_type",
    "date",
    "points_issued",
    "points_redeemed",
    "points_reversed",
    "points_expired",
    "adjustment_points",
    "gift_cards_issued_q",
    "gift_cards_redeemed_q",
    "replay_events",
    "certification_status",
    "pending_corrections_count",
    "latest_reconciliation_mismatches",
    "negative_balance_count",
    "latest_reconciliation_completed_at",
    "generated_at",
    "period_from",
    "period_to"
  ]);
}

export async function writeLedgerCertificationArtifactsWithDeps({
  readReport = readLedgerCertificationReport,
  fsModule = fs,
  outputRoot = path.join(process.cwd(), "artifacts", "ledger-certifications"),
  retentionDays = certificationRetentionDays(),
  businessId,
  from,
  to
}) {
  const report = await readReport(businessId, from, to);
  const dayDir = path.join(outputRoot, report.period.to);
  const fileBase = `${sanitizeSlug(report.business.slug || report.business.name || report.business.id)}_${report.business.id}`;
  fsModule.mkdirSync(dayDir, { recursive: true });

  const jsonPath = path.join(dayDir, `${fileBase}.json`);
  const csvPath = path.join(dayDir, `${fileBase}.csv`);
  writeJsonFile(fsModule, jsonPath, report);
  fsModule.writeFileSync(csvPath, `${ledgerCertificationCsv(report)}\n`, "utf8");
  const retention = pruneOldCertificationDays(fsModule, outputRoot, retentionDays);
  const rootIndex = refreshCertificationIndexes(fsModule, outputRoot, retentionDays);

  return {
    businessId: report.business.id,
    businessName: report.business.name,
    period: report.period,
    certificationStatus: report.certification_status,
    jsonPath,
    csvPath,
    manifestPath: path.join(dayDir, "index.json"),
    rootIndexPath: path.join(outputRoot, "index.json"),
    retentionDays,
    prunedDays: retention.prunedDays,
    indexedDays: rootIndex.day_count
  };
}

export async function writeLedgerCertificationArtifacts({
  businessId,
  from,
  to,
  outputRoot = certificationOutputRoot(),
  retentionDays = certificationRetentionDays()
}) {
  return writeLedgerCertificationArtifactsWithDeps({
    readReport: readLedgerCertificationReport,
    fsModule: fs,
    outputRoot,
    retentionDays,
    businessId,
    from,
    to
  });
}

export function rebuildLedgerCertificationIndexesWithDeps({
  fsModule = fs,
  outputRoot = certificationOutputRoot(),
  retentionDays = certificationRetentionDays()
} = {}) {
  const retention = pruneOldCertificationDays(fsModule, outputRoot, retentionDays);
  const rootIndex = refreshCertificationIndexes(fsModule, outputRoot, retentionDays);
  return {
    outputRoot,
    retentionDays,
    prunedDays: retention.prunedDays,
    indexedDays: rootIndex.day_count,
    rootIndexPath: path.join(outputRoot, "index.json")
  };
}

export function rebuildLedgerCertificationIndexes({
  outputRoot = certificationOutputRoot(),
  retentionDays = certificationRetentionDays()
} = {}) {
  return rebuildLedgerCertificationIndexesWithDeps({
    fsModule: fs,
    outputRoot,
    retentionDays
  });
}

export function readLedgerCertificationArchiveIndexWithDeps({
  fsModule = fs,
  outputRoot = certificationOutputRoot(),
  businessId
} = {}) {
  const rootIndexPath = path.join(outputRoot, "index.json");
  if (!fsModule.existsSync(rootIndexPath)) {
    return {
      generated_at: new Date().toISOString(),
      retention_days: certificationRetentionDays(),
      business_id: businessId,
      available_days: []
    };
  }

  const rootIndex = readJsonFile(fsModule, rootIndexPath);
  const availableDays = [];
  for (const day of Array.isArray(rootIndex.days) ? rootIndex.days : []) {
    const dayName = dayDirectoryName(day.date);
    if (!dayName) continue;
    const dayManifestPath = safeManifestPath(outputRoot, dayName);
    if (!fsModule.existsSync(dayManifestPath)) continue;
    const dayManifest = readJsonFile(fsModule, dayManifestPath);
    const artifact = Array.isArray(dayManifest.artifacts)
      ? dayManifest.artifacts.find((item) => String(item.businessId) === String(businessId))
      : null;
    if (!artifact) continue;
    availableDays.push({
      date: dayName,
      generated_at: artifact.generatedAt || dayManifest.generated_at || null,
      certification_status: artifact.certificationStatus || "UNKNOWN",
      period: artifact.period || {},
      json_file: artifact.jsonPath ? path.basename(String(artifact.jsonPath)) : "",
      csv_file: artifact.csvPath ? path.basename(String(artifact.csvPath)) : ""
    });
  }

  return {
    generated_at: rootIndex.generated_at || new Date().toISOString(),
    retention_days: Number(rootIndex.retention_days || certificationRetentionDays()),
    business_id: businessId,
    available_days: availableDays
  };
}

export function readLedgerCertificationArchiveIndex({
  outputRoot = certificationOutputRoot(),
  businessId
} = {}) {
  return readLedgerCertificationArchiveIndexWithDeps({
    fsModule: fs,
    outputRoot,
    businessId
  });
}

export function readLedgerCertificationArtifactWithDeps({
  fsModule = fs,
  outputRoot = certificationOutputRoot(),
  businessId,
  date,
  format = "json"
} = {}) {
  const dayName = dayDirectoryName(date);
  if (!dayName) return null;
  const dayManifestPath = safeManifestPath(outputRoot, dayName);
  if (!fsModule.existsSync(dayManifestPath)) return null;
  const dayManifest = readJsonFile(fsModule, dayManifestPath);
  const artifact = Array.isArray(dayManifest.artifacts)
    ? dayManifest.artifacts.find((item) => String(item.businessId) === String(businessId))
    : null;
  if (!artifact) return null;

  const relativePath = format === "csv" ? artifact.csvPath : artifact.jsonPath;
  const fileName = safeArtifactFileName(path.basename(String(relativePath || "")));
  if (!fileName) return null;
  const filePath = path.join(outputRoot, dayName, fileName);
  if (!fsModule.existsSync(filePath)) return null;

  return {
    date: dayName,
    businessId,
    fileName,
    format,
    content: fsModule.readFileSync(filePath, "utf8")
  };
}

export function readLedgerCertificationArtifact({
  outputRoot = certificationOutputRoot(),
  businessId,
  date,
  format = "json"
} = {}) {
  return readLedgerCertificationArtifactWithDeps({
    fsModule: fs,
    outputRoot,
    businessId,
    date,
    format
  });
}
