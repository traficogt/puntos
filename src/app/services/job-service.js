import { runCampaignPreparationJob } from "./campaign-preparation-service.js";
import { runCustomerImportJob } from "./customer-import-job-service.js";
import {
  RETRYABLE_JOB_TYPES,
  recoverJobLeases,
  heartbeatJob,
  completeClaimedJob,
  failClaimedJob,
} from "./job-recovery.js";
import crypto from "node:crypto";
import { withDbClientContext } from "../database.js";
import { JobRepo } from "../repositories/job-repository.js";
import { AnalyticsRepository } from "../repositories/analytics-repository.js";
import { runLifecycleOnce } from "./lifecycle-service.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { createClient } from "redis";
import { errorMessage } from "../../utils/error-shape.js";

/** @typedef {import("../../types/db.js").DbQueryClient} TxClient */
/**
 * A claimed background_jobs row, or a legacy Redis queue item carrying `jobType`.
 * @typedef {{
 *   id?: string,
 *   job_type?: string,
 *   jobType?: string,
 *   business_id?: string | null,
 *   payload?: { businessId?: string | null, [key: string]: unknown } | null,
 *   attempts?: number | string | null,
 *   status?: string | null,
 *   [key: string]: unknown,
 * }} JobLike
 */
/** @typedef {(payload: { businessId?: string | null, [key: string]: unknown }) => Promise<unknown>} JobHandler */
/**
 * @typedef {{
 *   jobRepo: {
 *     create: (row: {
 *       id: string,
 *       business_id?: string | null,
 *       job_type: string,
 *       payload?: Record<string, unknown>,
 *       run_after?: string | Date | null,
 *     }) => Promise<JobLike>,
 *   },
 *   redisClient: { lPush: (key: string, value: string) => Promise<unknown> } | null,
 *   logger: {
 *     warn: (context: Record<string, unknown>, message: string) => void,
 *     info?: (context: Record<string, unknown>, message: string) => void,
 *   },
 * }} EnqueueJobDeps
 */
/**
 * @typedef {{
 *   businessId?: string | null,
 *   jobType: string,
 *   payload?: Record<string, unknown>,
 *   runAfter?: string | Date | null,
 * }} EnqueueJobInput
 */

function id() {
  return crypto.randomUUID();
}

/**
 * @param {JobLike | null | undefined} job
 * @param {Record<string, unknown>} [extras]
 */
function jobLogContext(job, extras = {}) {
  return {
    jobId: job?.id ?? null,
    jobType: job?.job_type ?? job?.jobType ?? null,
    businessId: job?.business_id ?? job?.payload?.businessId ?? null,
    attempts: job?.attempts ?? null,
    status: job?.status ?? null,
    ...extras,
  };
}

/** @type {Record<string, typeof runCampaignPreparationJob | typeof runCustomerImportJob | JobHandler>} */
const HANDLERS = {
  "growth.campaign.prepare": runCampaignPreparationJob,
  "customer.import": runCustomerImportJob,
  /** @param {{ businessId?: string | null }} payload */
  "analytics.calculate": async ({ businessId }) => {
    if (!businessId) throw new Error("Missing businessId");
    await withDbClientContext({ tenantId: businessId, platformAdmin: false }, async () => {
      await AnalyticsRepository.calculateRFMScores(businessId);
      await AnalyticsRepository.calculateChurnRisk(businessId);
      await AnalyticsRepository.calculatePredictedLTV(businessId);
      await AnalyticsRepository.createCohorts(businessId, "monthly");
    });
    return { ok: true, message: "analytics recalculated" };
  },
  /** @param {{ businessId?: string | null }} [payload] */
  "lifecycle.run": async ({ businessId = null } = {}) => {
    const out = await runLifecycleOnce({ businessId });
    return { ok: true, runs: out.length };
  },
};

const REDIS_QUEUE_KEY = "pf:jobs:queue";

/** @type {ReturnType<typeof createClient<{}, {}, {}, 2, {}>> | null} */
let redis = null;
let redisRequested = false;

/**
 * Resolve the Redis queue client on first use, never at import time. Returns
 * null when the durable DB queue is in use (unset REDIS_URL, db driver, or
 * JOB_QUEUE_FORCE_DB). A failed initial connection falls back to the DB queue
 * for the rest of the process, as before.
 */
function getJobQueueRedis() {
  if (redisRequested) return redis;
  redisRequested = true;
  if (config.JOB_QUEUE_FORCE_DB || config.JOB_QUEUE_DRIVER !== "redis" || !config.REDIS_URL) {
    return null;
  }
  const client = createClient({ url: config.REDIS_URL, RESP: 2 });
  // Without a listener a socket error would be thrown as an uncaught exception.
  client.on("error", (err) => logger.warn({ err: err?.message }, "Job queue: Redis client error"));
  redis = client;
  client.connect().catch((err) => {
    logger.warn({ err: err?.message }, "Job queue: failed to connect to Redis, falling back to DB");
    if (redis === client) redis = null;
  });
  return redis;
}

/** Close the Redis queue client on shutdown (no-op when it was never created). */
export async function closeJobQueueRedis() {
  const client = redis;
  redis = null;
  if (!client) return;
  try {
    if (client.isOpen) await client.close();
    else client.destroy();
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, "Job queue: Redis client did not close cleanly");
  }
}

/** @param {JobLike | null | undefined} job */
function isTrackedJob(job) {
  return Boolean(
    job &&
    typeof job === "object" &&
    job.id &&
    ("status" in job || "job_type" in job || "created_at" in job),
  );
}

/** @param {unknown} item a Redis bulk-string reply */
function parseRedisQueueItem(item) {
  try {
    const parsed = JSON.parse(/** @type {string} */ (item));
    if (typeof parsed === "string") {
      return { jobId: parsed, legacyJob: null };
    }
    if (parsed && typeof parsed === "object") {
      return {
        jobId: typeof parsed.id === "string" ? parsed.id : null,
        legacyJob: parsed,
      };
    }
  } catch {
    // Not JSON: legacy queue items were bare job ids, which stay accepted.
    if (typeof item === "string" && item) {
      return { jobId: item, legacyJob: null };
    }
  }
  return { jobId: null, legacyJob: null };
}

/** @param {string} jobId */
async function claimQueuedJobById(jobId) {
  return withDbClientContext(
    { platformAdmin: true, tenantId: null },
    async (/** @type {TxClient} */ client) => {
      await client.query("BEGIN");
      try {
        const upd = await client.query(
          `UPDATE background_jobs
         SET status='RUNNING',
             locked_at=now(),
             started_at=now(),
             attempts=attempts+1
         WHERE id=$1
           AND status='QUEUED'
           AND run_after <= now()
         RETURNING *`,
          [jobId],
        );
        await client.query("COMMIT");
        return upd.rows[0] ?? null;
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Best effort: the original error below is the one worth surfacing.
        }
        throw e;
      }
    },
  );
}

async function claimNextQueuedDbJob() {
  // Claim under platform-admin context; jobs can be cross-tenant and may have NULL business_id.
  return withDbClientContext(
    { platformAdmin: true, tenantId: null },
    async (/** @type {TxClient} */ client) => {
      await client.query("BEGIN");
      try {
        const lock = await client.query(
          `SELECT id
         FROM background_jobs
         WHERE status='QUEUED'
           AND run_after <= now()
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        );
        if (!lock.rowCount) {
          await client.query("ROLLBACK");
          return null;
        }

        const jobId = lock.rows[0].id;
        const upd = await client.query(
          `UPDATE background_jobs
         SET status='RUNNING',
             locked_at=now(),
             started_at=now(),
             attempts=attempts+1
         WHERE id=$1
         RETURNING *`,
          [jobId],
        );
        await client.query("COMMIT");
        return upd.rows[0] ?? null;
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Best effort: the original error below is the one worth surfacing.
        }
        throw e;
      }
    },
  );
}

/**
 * @param {EnqueueJobDeps} deps
 * @param {EnqueueJobInput} job
 */
export async function enqueueJobWithDeps(
  deps,
  { businessId = null, jobType, payload = {}, runAfter = null },
) {
  const jobRecord = await deps.jobRepo.create({
    id: id(),
    business_id: businessId,
    job_type: jobType,
    payload,
    run_after: runAfter,
  });

  if (deps.redisClient && !runAfter) {
    try {
      await deps.redisClient.lPush(REDIS_QUEUE_KEY, JSON.stringify({ id: jobRecord.id }));
    } catch (err) {
      deps.logger.warn(
        { err: errorMessage(err), jobId: jobRecord.id },
        "Job queue: redis enqueue failed, leaving job in DB queue",
      );
    }
  }

  deps.logger.info?.(
    jobLogContext(jobRecord, { queueDriver: deps.redisClient && !runAfter ? "redis" : "db" }),
    "Background job enqueued",
  );

  return jobRecord;
}

/** @param {EnqueueJobInput} job */
export async function enqueueJob({ businessId = null, jobType, payload = {}, runAfter = null }) {
  return enqueueJobWithDeps(
    {
      // JobRepo.create's `= null` defaults make TS infer null-only columns for
      // business_id/run_after; the repository accepts ids and timestamps.
      jobRepo: /** @type {EnqueueJobDeps["jobRepo"]} */ (/** @type {unknown} */ (JobRepo)),
      redisClient: getJobQueueRedis(),
      logger,
    },
    { businessId, jobType, payload, runAfter },
  );
}

async function claimNextJob() {
  const queue = getJobQueueRedis();
  if (queue) {
    while (true) {
      const item = await queue.rPop(REDIS_QUEUE_KEY);
      if (!item) break;
      const parsed = parseRedisQueueItem(item);
      if (parsed.jobId) {
        const claimed = await claimQueuedJobById(parsed.jobId);
        if (claimed) return claimed;
      }
      if (parsed.legacyJob) {
        return parsed.legacyJob;
      }
    }
  }
  return claimNextQueuedDbJob();
}

/** @param {{ limit?: number }} [options] */
export async function processPendingJobsOnce({ limit = 10 } = {}) {
  await withDbClientContext({ platformAdmin: true, tenantId: null }, recoverJobLeases);
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextJob();
    if (!job) break;

    const resolvedJobType = job.job_type || job.jobType;
    const handler = HANDLERS[resolvedJobType];
    const trackedJob = isTrackedJob(job);
    if (!handler) {
      if (trackedJob) {
        await withDbClientContext(
          { platformAdmin: true, tenantId: null },
          async (/** @type {TxClient} */ client) => {
            await client.query(
              `UPDATE background_jobs
             SET status='FAILED',
                 error=$2,
                 completed_at=now()
             WHERE id=$1`,
              [job.id, `Unknown job type: ${resolvedJobType}`],
            );
          },
        );
        logger.warn(jobLogContext(job), "Background job failed: unknown job type");
      } else {
        logger.warn({ jobType: resolvedJobType }, "Unknown job type (Redis queue)");
      }
      processed += 1;
      continue;
    }

    const recoverable = trackedJob && RETRYABLE_JOB_TYPES.includes(resolvedJobType);
    const heartbeat = recoverable
      ? setInterval(() => {
          withDbClientContext(
            { platformAdmin: true, tenantId: null },
            (/** @type {TxClient} */ client) => heartbeatJob(client, job),
          ).catch((err) =>
            logger.warn({ jobId: job.id, err: err?.message }, "Job heartbeat failed"),
          );
        }, 30000)
      : null;
    heartbeat?.unref();
    try {
      const businessId = job.business_id ?? job.payload?.businessId ?? null;
      logger.info(jobLogContext(job, { businessId }), "Processing background job");
      const result = await handler({ ...(job.payload ?? {}), businessId });
      if (trackedJob) {
        await withDbClientContext(
          { platformAdmin: true, tenantId: null },
          async (/** @type {TxClient} */ client) => {
            await completeClaimedJob(client, job, result);
          },
        );
        logger.info(jobLogContext(job, { businessId }), "Background job completed");
      } else {
        logger.info(
          { jobType: resolvedJobType, jobId: job.id || null },
          "Job processed (Redis queue)",
        );
      }
    } catch (e) {
      const message = errorMessage(e) ?? String(e);
      if (trackedJob) {
        await withDbClientContext(
          { platformAdmin: true, tenantId: null },
          async (/** @type {TxClient} */ client) => {
            if (recoverable) await failClaimedJob(client, job);
            else
              await client.query(
                "UPDATE background_jobs SET status='FAILED',error=$2,completed_at=now() WHERE id=$1 AND status='RUNNING' AND attempts=$3",
                [job.id, message, job.attempts],
              );
          },
        );
        logger.warn(jobLogContext(job, { err: message }), "Background job failed");
      } else {
        logger.warn({ jobType: resolvedJobType, err: message }, "Job failed (Redis queue)");
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }

    processed += 1;
  }
  return { processed };
}

export async function redisHealth() {
  const queue = getJobQueueRedis();
  if (!queue) {
    return { driver: "db", queueDepth: 0, healthy: true, redis: "disabled", lastError: null };
  }
  try {
    const depth = await queue.lLen(REDIS_QUEUE_KEY);
    return { driver: "redis", queueDepth: depth ?? 0, healthy: true, redis: "ok", lastError: null };
  } catch (err) {
    logger.warn({ err: errorMessage(err) }, "Job queue: redis health failed");
    return {
      driver: "redis",
      queueDepth: -1,
      healthy: false,
      redis: "error",
      lastError: errorMessage(err) ?? String(err),
    };
  }
}
