import crypto from "node:crypto";
import { withDbClientContext } from "../database.js";
import { JobRepo } from "../repositories/job-repository.js";
import { AnalyticsRepository } from "../repositories/analytics-repository.js";
import { runLifecycleOnce } from "./lifecycle-service.js";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { createClient } from "redis";

function id() { return crypto.randomUUID(); }

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

export async function enqueueJob({ businessId = null, jobType, payload = {}, runAfter = null }) {
  if (redis && !runAfter) {
    const job = { id: id(), businessId, jobType, payload };
    await redis.lPush(REDIS_QUEUE_KEY, JSON.stringify(job));
    return job;
  }
  return JobRepo.create({
    id: id(),
    business_id: businessId,
    job_type: jobType,
    payload,
    run_after: runAfter
  });
}

async function claimNextJob() {
  if (redis) {
    const item = await redis.rPop(REDIS_QUEUE_KEY);
    if (item) {
      try {
        return JSON.parse(item);
      } catch {
        return null;
      }
    }
  }
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

export async function processPendingJobsOnce({ limit = 10 } = {}) {
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextJob();
    if (!job) break;

    const handler = HANDLERS[job.job_type || job.jobType];
    if (!handler) {
      if (!redis && job.id) {
        await withDbClientContext({ platformAdmin: true, tenantId: null }, async (client) => {
          await client.query(
            `UPDATE background_jobs
             SET status='FAILED',
                 error=$2,
                 completed_at=now()
             WHERE id=$1`,
            [job.id, `Unknown job type: ${job.job_type}`]
          );
        });
      } else {
        logger.warn({ jobType: job.job_type || job.jobType }, "Unknown job type (Redis queue)");
      }
      processed += 1;
      continue;
    }

    try {
      const businessId = job.business_id ?? job.payload?.businessId ?? null;
      const result = await handler({ ...(job.payload ?? {}), businessId });
      if (!redis && job.id) {
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
      } else {
        logger.info({ jobType: job.job_type || job.jobType, jobId: job.id || null }, "Job processed (Redis queue)");
      }
    } catch (e) {
      const message = e?.message ?? String(e);
      if (!redis && job.id) {
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
      } else {
        logger.warn({ jobType: job.job_type || job.jobType, err: message }, "Job failed (Redis queue)");
      }
    }

    processed += 1;
  }
  return { processed };
}

export async function redisHealth() {
  if (!redis) {
    return { driver: "db", queueDepth: 0 };
  }
  try {
    const depth = await redis.lLen(REDIS_QUEUE_KEY);
    return { driver: "redis", queueDepth: depth ?? 0 };
  } catch (err) {
    logger.warn({ err: err?.message }, "Job queue: redis health failed");
    return { driver: "redis", queueDepth: -1 };
  }
}
