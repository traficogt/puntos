import crypto from "node:crypto";
import { withDbClientContext } from "../database.js";
import { JobRepo } from "../repositories/job-repository.js";
import { AnalyticsRepository } from "../repositories/analytics-repository.js";
import { runLifecycleOnce } from "./lifecycle-service.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { createClient } from "redis";

function id() { return crypto.randomUUID(); }

function jobLogContext(job, extras = {}) {
  return {
    jobId: job?.id ?? null,
    jobType: job?.job_type ?? job?.jobType ?? null,
    businessId: job?.business_id ?? job?.payload?.businessId ?? null,
    attempts: job?.attempts ?? null,
    status: job?.status ?? null,
    ...extras
  };
}

const HANDLERS = {
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
  "lifecycle.run": async ({ businessId = null } = {}) => {
    const out = await runLifecycleOnce({ businessId });
    return { ok: true, runs: out.length };
  }
};

const REDIS_QUEUE_KEY = "pf:jobs:queue";
const REDIS_FORCE_DB = (process.env.JOB_QUEUE_FORCE_DB ?? "false") === "true";

let redis = null;
if (!REDIS_FORCE_DB && config.JOB_QUEUE_DRIVER === "redis" && config.REDIS_URL) {
  redis = createClient({ url: config.REDIS_URL });
  redis.connect().catch((err) => {
    logger.warn({ err: err?.message }, "Job queue: failed to connect to Redis, falling back to DB");
    redis = null;
  });
}

function isTrackedJob(job) {
  return Boolean(job && typeof job === "object" && job.id && ("status" in job || "job_type" in job || "created_at" in job));
}

function parseRedisQueueItem(item) {
  try {
    const parsed = JSON.parse(item);
    if (typeof parsed === "string") {
      return { jobId: parsed, legacyJob: null };
    }
    if (parsed && typeof parsed === "object") {
      return {
        jobId: typeof parsed.id === "string" ? parsed.id : null,
        legacyJob: parsed
      };
    }
  } catch {
    if (typeof item === "string" && item) {
      return { jobId: item, legacyJob: null };
    }
  }
  return { jobId: null, legacyJob: null };
}

async function claimQueuedJobById(jobId) {
  return withDbClientContext({ platformAdmin: true, tenantId: null }, async (client) => {
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
        [jobId]
      );
      await client.query("COMMIT");
      return upd.rows[0] ?? null;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      throw e;
    }
  });
}

async function claimNextQueuedDbJob() {
  // Claim under platform-admin context; jobs can be cross-tenant and may have NULL business_id.
  return withDbClientContext({ platformAdmin: true, tenantId: null }, async (client) => {
    await client.query("BEGIN");
    try {
      const lock = await client.query(
        `SELECT id
         FROM background_jobs
         WHERE status='QUEUED'
           AND run_after <= now()
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1`
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
        [jobId]
      );
      await client.query("COMMIT");
      return upd.rows[0] ?? null;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      throw e;
    }
  });
}

export async function enqueueJobWithDeps(
  deps,
  { businessId = null, jobType, payload = {}, runAfter = null }
) {
  const jobRecord = await deps.jobRepo.create({
    id: id(),
    business_id: businessId,
    job_type: jobType,
    payload,
    run_after: runAfter
  });

  if (deps.redisClient && !runAfter) {
    try {
      await deps.redisClient.lPush(REDIS_QUEUE_KEY, JSON.stringify({ id: jobRecord.id }));
    } catch (err) {
      deps.logger.warn({ err: err?.message, jobId: jobRecord.id }, "Job queue: redis enqueue failed, leaving job in DB queue");
    }
  }

  deps.logger.info?.(
    jobLogContext(jobRecord, { queueDriver: deps.redisClient && !runAfter ? "redis" : "db" }),
    "Background job enqueued"
  );

  return jobRecord;
}

export async function enqueueJob({ businessId = null, jobType, payload = {}, runAfter = null }) {
  return enqueueJobWithDeps(
    {
      jobRepo: JobRepo,
      redisClient: redis,
      logger
    },
    { businessId, jobType, payload, runAfter }
  );
}

async function claimNextJob() {
  if (redis) {
    while (true) {
      const item = await redis.rPop(REDIS_QUEUE_KEY);
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

export async function processPendingJobsOnce({ limit = 10 } = {}) {
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextJob();
    if (!job) break;

    const resolvedJobType = job.job_type || job.jobType;
    const handler = HANDLERS[resolvedJobType];
    const trackedJob = isTrackedJob(job);
    if (!handler) {
      if (trackedJob) {
        await withDbClientContext({ platformAdmin: true, tenantId: null }, async (client) => {
          await client.query(
            `UPDATE background_jobs
             SET status='FAILED',
                 error=$2,
                 completed_at=now()
             WHERE id=$1`,
            [job.id, `Unknown job type: ${resolvedJobType}`]
          );
        });
        logger.warn(jobLogContext(job), "Background job failed: unknown job type");
      } else {
        logger.warn({ jobType: resolvedJobType }, "Unknown job type (Redis queue)");
      }
      processed += 1;
      continue;
    }

    try {
      const businessId = job.business_id ?? job.payload?.businessId ?? null;
      logger.info(jobLogContext(job, { businessId }), "Processing background job");
      const result = await handler({ ...(job.payload ?? {}), businessId });
      if (trackedJob) {
        await withDbClientContext({ platformAdmin: true, tenantId: null }, async (client) => {
          await client.query(
            `UPDATE background_jobs
             SET status='DONE',
                 result=$2,
                 completed_at=now()
             WHERE id=$1`,
            [job.id, result ?? {}]
          );
        });
        logger.info(jobLogContext(job, { businessId }), "Background job completed");
      } else {
        logger.info({ jobType: resolvedJobType, jobId: job.id || null }, "Job processed (Redis queue)");
      }
    } catch (e) {
      const message = e?.message ?? String(e);
      if (trackedJob) {
        await withDbClientContext({ platformAdmin: true, tenantId: null }, async (client) => {
          await client.query(
            `UPDATE background_jobs
             SET status='FAILED',
                 error=$2,
                 completed_at=now()
             WHERE id=$1`,
            [job.id, message]
          );
        });
        logger.warn(jobLogContext(job, { err: message }), "Background job failed");
      } else {
        logger.warn({ jobType: resolvedJobType, err: message }, "Job failed (Redis queue)");
      }
    }

    processed += 1;
  }
  return { processed };
}

export async function redisHealth() {
  if (!redis) {
    return { driver: "db", queueDepth: 0, healthy: true, redis: "disabled", lastError: null };
  }
  try {
    const depth = await redis.lLen(REDIS_QUEUE_KEY);
    return { driver: "redis", queueDepth: depth ?? 0, healthy: true, redis: "ok", lastError: null };
  } catch (err) {
    logger.warn({ err: err?.message }, "Job queue: redis health failed");
    return { driver: "redis", queueDepth: -1, healthy: false, redis: "error", lastError: err?.message ?? String(err) };
  }
}
