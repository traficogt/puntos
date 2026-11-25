// Background job registry shared by the API process (src/app/server.js) and the
// standalone worker (src/app/worker.js). Every periodic job is declared once
// together with the process role(s) that run it. The worker runs its whole
// share unconditionally; the API only runs its share when IN_PROCESS_WORKERS is
// enabled (the default outside production, off in production to avoid duplicate
// runners when scaling horizontally).
import cron from "node-cron";

import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { withDbClientContext } from "./database.js";
import { BusinessRepo } from "./repositories/business-repository.js";
import { WebhookRepo } from "./repositories/webhook-repository.js";
import { processNativeWalletUpdates } from "./services/native-wallet/runtime.js";
import { processMobilePushUpdates } from "./services/mobile-push/runtime.js";
import { deliverPendingOnce } from "./services/webhook-service.js";
import { syncConfiguredPosOnce } from "./services/pos-integration-service.js";
import { processPendingJobsOnce } from "./services/job-service.js";
import { runLifecycleOnce, createMarketingTick } from "./services/lifecycle-service.js";
import { runSecondVisitAutomationsOnce } from "./services/second-visit-service.js";
import { processWeeklyOwnerBriefsOnce } from "./services/weekly-owner-brief-service.js";
import { runTrialDailyOnce } from "./services/trial-lifecycle-service.js";
import { purgeExpiredSupportAttachments } from "./services/support-case-maintenance.js";
import { pruneExpiredMfaCounters } from "./services/account-security-service.js";
import { runLedgerReconciliation } from "./services/ledger-reconciliation-service.js";
import {
  resolveCertificationPeriod,
  writeLedgerCertificationArtifacts,
} from "./services/ledger-certification-service.js";

/** @typedef {"api" | "worker"} SchedulerRole */
/**
 * @typedef {object} ScheduledWork
 * @property {string} name
 * @property {readonly SchedulerRole[]} runsIn
 * @property {() => Promise<unknown> | unknown} run
 */
/**
 * @typedef {object} PeriodicJob
 * @property {string} name
 * @property {readonly SchedulerRole[]} runsIn
 * @property {number} [everyMs] Interval period for setInterval jobs.
 * @property {() => Promise<unknown> | unknown} [run] Interval handler.
 * @property {string} [cron] Cron expression for calendar jobs.
 * @property {string} [timezone] Cron timezone.
 * @property {readonly ScheduledWork[]} [steps] Sequential steps of a cron job, filtered by role.
 */

/** @type {SchedulerRole} */
export const API = "api";
/** @type {SchedulerRole} */
export const WORKER = "worker";
/** @type {readonly SchedulerRole[]} */
const BOTH = Object.freeze([API, WORKER]);
/** @type {readonly SchedulerRole[]} */
const WORKER_ONLY = Object.freeze([WORKER]);

/**
 * Run `fn` with platform-wide (cross-tenant) database access.
 * @template T
 * @param {(client: import("../types/db.js").DbClient) => Promise<T>} fn
 */
const platformContext = (fn) => withDbClientContext({ platformAdmin: true, tenantId: null }, fn);

/** @param {unknown} e */
function errorMessage(e) {
  return e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
}

/**
 * Run one unit of scheduled work. Failures are logged with the error and never
 * propagate, so one job cannot stop its siblings or the process.
 * @param {ScheduledWork} entry
 * @param {SchedulerRole} role
 * @param {string} message
 * @param {{ warn: (ctx: object, msg: string) => void }} [log]
 */
export async function runGuarded(entry, role, message, log = logger) {
  try {
    await entry.run();
    return true;
  } catch (e) {
    log.warn({ err: errorMessage(e), job: entry.name, role }, message);
    return false;
  }
}

/**
 * Run entries one after another; a failing entry does not block the next one.
 * @param {readonly ScheduledWork[]} entries
 * @param {SchedulerRole} role
 * @param {string} message
 * @param {{ warn: (ctx: object, msg: string) => void }} [log]
 * @returns {Promise<string[]>} names of the entries that completed
 */
export async function runSequence(entries, role, message, log = logger) {
  const completed = [];
  for (const entry of entries) {
    if (await runGuarded(entry, role, message, log)) completed.push(entry.name);
  }
  return completed;
}

/**
 * @template {{ runsIn: readonly SchedulerRole[] }} T
 * @param {readonly T[]} entries
 * @param {SchedulerRole} role
 */
export function forRole(entries, role) {
  return entries.filter((entry) => entry.runsIn.includes(role));
}

// ---------------------------------------------------------------------------
// Handlers composed from several services.

async function rotateStoredSecrets() {
  await platformContext(async () => {
    const reencrypted = await WebhookRepo.encryptPlaintextSecrets();
    if (reencrypted > 0) {
      logger.info({ reencrypted }, "Encrypted plaintext webhook endpoint secrets");
    }
    const rotatedWebhookSecrets = await WebhookRepo.rotateSecretsToCurrentKey();
    if (rotatedWebhookSecrets > 0) {
      logger.info(
        { rotatedWebhookSecrets },
        "Rotated webhook endpoint secrets to current encryption key",
      );
    }
    const rotatedProgramSecrets = await BusinessRepo.rotateExternalAwardApiKeysToCurrent();
    if (rotatedProgramSecrets > 0) {
      logger.info(
        { rotatedProgramSecrets },
        "Rotated external award API keys to current encryption key",
      );
    }
  });
}

async function purgeSupportImages() {
  const result = await purgeExpiredSupportAttachments();
  logger.info({ deleted: result?.deleted ?? 0 }, "Expired support screenshots removed");
}

async function pruneMfaCounters() {
  const pruned = await platformContext(() => pruneExpiredMfaCounters());
  logger.info({ pruned }, "Pruned expired MFA single-use counters");
}

async function reconcileAndCertifyLedger() {
  const ids = await platformContext(() => BusinessRepo.listAllIds());
  const reconciliation = await platformContext(() =>
    runLedgerReconciliation({
      limit: config.LEDGER_RECONCILE_LIMIT,
      repair: config.LEDGER_RECONCILE_REPAIR,
      persist: true,
    }),
  );
  logger.info(
    {
      checkedCustomers: reconciliation.checkedCustomers,
      mismatchedCustomers: reconciliation.mismatchedCustomers,
      repairedCustomers: reconciliation.repairedCustomers,
      repairMode: config.LEDGER_RECONCILE_REPAIR,
    },
    "Ledger reconciliation completed",
  );
  if (reconciliation.mismatchedCustomers > 0 && !config.LEDGER_RECONCILE_REPAIR) {
    logger.warn(
      { mismatchedCustomers: reconciliation.mismatchedCustomers },
      "Ledger reconciliation detected drift requiring manual review",
    );
  }
  const period = resolveCertificationPeriod();
  const certificationArtifacts = [];
  for (const bid of ids) {
    const artifact = await writeLedgerCertificationArtifacts({
      businessId: bid,
      from: period.from,
      to: period.to,
    });
    certificationArtifacts.push({
      businessId: artifact.businessId,
      certificationStatus: artifact.certificationStatus,
      jsonPath: artifact.jsonPath,
      csvPath: artifact.csvPath,
    });
  }
  logger.info(
    { period, businesses: certificationArtifacts.length },
    "Wrote daily ledger certification artifacts",
  );
}

const guidedGrowthSteps = Object.freeze([
  { name: "second-visit.prepare", runsIn: WORKER_ONLY, run: runSecondVisitAutomationsOnce },
  { name: "owner-briefs.process", runsIn: WORKER_ONLY, run: processWeeklyOwnerBriefsOnce },
]);
let guidedGrowthRunning = false;
async function guidedGrowthTick() {
  if (guidedGrowthRunning) return;
  guidedGrowthRunning = true;
  try {
    await runSequence(guidedGrowthSteps, WORKER, "Guided growth step did not complete");
  } finally {
    guidedGrowthRunning = false;
  }
}

// The marketing tick guards against overlap internally; one instance per process.
const marketingTick = createMarketingTick();

// ---------------------------------------------------------------------------
// Registry.

/** One-off work run after the database is ready, before any timer starts. */
/** @type {readonly ScheduledWork[]} */
export const startupTasks = Object.freeze([
  { name: "support.purge-expired-attachments", runsIn: WORKER_ONLY, run: purgeSupportImages },
  { name: "secrets.rotate-to-current-key", runsIn: BOTH, run: rotateStoredSecrets },
]);

/** Steps of the daily maintenance cron, run sequentially in this order. */
/** @type {readonly ScheduledWork[]} */
export const dailySteps = Object.freeze([
  { name: "support.purge-expired-attachments", runsIn: WORKER_ONLY, run: purgeSupportImages },
  { name: "lifecycle.daily", runsIn: BOTH, run: () => runLifecycleOnce() },
  // Trial reminders, the day-14 soft lock and the purge dry run
  // (docs/product/2026-11-25-self-serve-trial.md, section 4.2).
  { name: "trial.daily", runsIn: WORKER_ONLY, run: () => runTrialDailyOnce() },
  { name: "mfa.prune-counters", runsIn: WORKER_ONLY, run: pruneMfaCounters },
  { name: "ledger.reconcile-and-certify", runsIn: WORKER_ONLY, run: reconcileAndCertifyLedger },
]);

/**
 * Daily maintenance keeps its established business-calendar schedule.
 * @param {{ CHURN_SEND_HOUR_LOCAL: number }} [settings]
 */
export function dailyCronExpression(settings = config) {
  const hour = String(settings.CHURN_SEND_HOUR_LOCAL).padStart(2, "0");
  return `0 ${hour} * * *`;
}

/** @type {readonly PeriodicJob[]} */
export const periodicJobs = Object.freeze([
  { name: "native-wallet.updates", everyMs: 60_000, runsIn: BOTH, run: processNativeWalletUpdates },
  {
    name: "mobile-push.updates",
    everyMs: 30_000,
    runsIn: WORKER_ONLY,
    run: processMobilePushUpdates,
  },
  { name: "webhooks.deliver", everyMs: 60_000, runsIn: BOTH, run: deliverPendingOnce },
  {
    name: "jobs.process",
    everyMs: config.JOB_WORKER_INTERVAL_MS,
    runsIn: BOTH,
    run: () => processPendingJobsOnce({ limit: config.JOB_WORKER_BATCH_SIZE }),
  },
  // Saved rule schedules are evaluated every minute; both outboxes are
  // processed independently even if incentive generation fails.
  { name: "marketing.tick", everyMs: 60_000, runsIn: BOTH, run: marketingTick },
  { name: "guided-growth.tick", everyMs: 60_000, runsIn: WORKER_ONLY, run: guidedGrowthTick },
  { name: "pos.sync", everyMs: 300_000, runsIn: BOTH, run: syncConfiguredPosOnce },
  {
    name: "daily.maintenance",
    cron: dailyCronExpression(),
    timezone: config.CRON_TZ,
    runsIn: BOTH,
    steps: dailySteps,
  },
]);

/**
 * Periodic jobs a process role runs. The API runs nothing unless in-process
 * workers are enabled; the worker always runs its share.
 * @param {SchedulerRole} role
 * @param {{ inProcessWorkers?: boolean }} [options]
 */
export function jobsFor(role, { inProcessWorkers = config.IN_PROCESS_WORKERS } = {}) {
  if (role === API && !inProcessWorkers) return [];
  return forRole(periodicJobs, role);
}

// ---------------------------------------------------------------------------
// Lifecycle.

/** @type {{ name: string, kind: "interval" | "cron", handle: unknown, stop: () => void }[]} */
const active = [];

/**
 * Run the startup tasks for a role, in registry order.
 * @param {SchedulerRole} role
 */
export async function runStartupMaintenance(role) {
  return runSequence(
    forRole(startupTasks, role),
    role,
    "Startup maintenance task did not complete",
  );
}

/**
 * Register every periodic job for a role. Timers are kept until stopScheduler().
 * @param {SchedulerRole} role
 * @param {{
 *   every?: (fn: () => void, ms: number) => unknown,
 *   clear?: (handle: unknown) => void,
 *   schedule?: (expression: string, fn: () => Promise<void>, options: { timezone?: string }) => { stop: () => void },
 * }} [timers] Overridable for tests; defaults to the process timers and node-cron.
 */
export function startScheduler(
  role,
  {
    every = (fn, ms) => setInterval(fn, ms),
    clear = (handle) => clearInterval(/** @type {any} */ (handle)),
    schedule = (expression, fn, options) => cron.schedule(expression, fn, options),
  } = {},
) {
  const started = [];
  for (const job of jobsFor(role)) {
    if (job.cron) {
      const steps = forRole(job.steps ?? [], role);
      const task = schedule(
        job.cron,
        async () => {
          await runSequence(steps, role, "Daily maintenance step did not complete");
        },
        { timezone: job.timezone },
      );
      active.push({ name: job.name, kind: "cron", handle: task, stop: () => task.stop() });
      logger.info(
        {
          role,
          job: job.name,
          cron: job.cron,
          timezone: job.timezone,
          steps: steps.map((s) => s.name),
        },
        "Scheduled daily maintenance",
      );
    } else {
      const { everyMs, run } = job;
      if (everyMs === undefined || !run)
        throw new Error(`Scheduled job ${job.name} needs everyMs and run`);
      const work = { name: job.name, runsIn: job.runsIn, run };
      const tick = () => runGuarded(work, role, "Scheduled job did not complete");
      const handle = every(tick, everyMs);
      active.push({ name: job.name, kind: "interval", handle, stop: () => clear(handle) });
      logger.info({ role, job: job.name, everyMs }, "Scheduled background job");
    }
    started.push(job.name);
  }
  return started;
}

/** Snapshot of the registered timers (name, kind and the timer handle). */
export function activeJobs() {
  return active.map(({ name, kind, handle }) => ({ name, kind, handle }));
}

/** Clear every interval and stop every cron task registered by startScheduler(). */
export function stopScheduler() {
  for (const job of active.splice(0)) job.stop();
}
