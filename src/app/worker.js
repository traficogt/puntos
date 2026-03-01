import express from "express";
import cron from "node-cron";

import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { initDatabase, closeDatabase, withDbClientContext } from "./database.js";
import { deliverPendingOnce } from "./services/webhook-service.js";
import { processPendingJobsOnce } from "./services/job-service.js";
import { runChurnOnce } from "./services/churn-service.js";
import { runLifecycleOnce } from "./services/lifecycle-service.js";
import { BusinessRepo } from "./repositories/business-repository.js";
import { WebhookRepo } from "./repositories/webhook-repository.js";
import observabilityRoutes from "./routes/observability.js";

let webhookInterval;
let jobInterval;
let cronTask;
let server;

async function startWorkers() {
  await initDatabase();

  // Ensure secrets are rotated before processing jobs/webhooks
  try {
    await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
      const reencrypted = await WebhookRepo.encryptPlaintextSecrets();
      if (reencrypted > 0) {
        logger.info({ reencrypted }, "Worker: encrypted plaintext webhook endpoint secrets");
      }
      const rotatedWebhookSecrets = await WebhookRepo.rotateSecretsToCurrentKey();
      if (rotatedWebhookSecrets > 0) {
        logger.info({ rotatedWebhookSecrets }, "Worker: rotated webhook endpoint secrets to current encryption key");
      }
      const rotatedProgramSecrets = await BusinessRepo.rotateExternalAwardApiKeysToCurrent();
      if (rotatedProgramSecrets > 0) {
        logger.info({ rotatedProgramSecrets }, "Worker: rotated external award API keys to current encryption key");
      }
    });
  } catch (e) {
    logger.warn({ err: e?.message }, "Worker: secret encryption maintenance failed");
  }

  logger.info("Worker: starting webhook delivery loop (60s)");
  webhookInterval = setInterval(() => {
    deliverPendingOnce().catch((e) => logger.warn({ err: e?.message }, "Worker: deliverPendingOnce failed"));
  }, 60_000);

  logger.info("Worker: starting background job loop");
  jobInterval = setInterval(() => {
    processPendingJobsOnce({ limit: config.JOB_WORKER_BATCH_SIZE })
      .catch((e) => logger.warn({ err: e?.message }, "Worker: processPendingJobsOnce failed"));
  }, config.JOB_WORKER_INTERVAL_MS);

  logger.info("Worker: scheduling churn + lifecycle job");
  const hour = String(config.CHURN_SEND_HOUR_LOCAL).padStart(2, "0");
  cronTask = cron.schedule(`0 ${hour} * * *`, async () => {
    try {
      const ids = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => BusinessRepo.listAllIds());
      for (const bid of ids) {
        await runChurnOnce({ businessId: bid, days: config.CHURN_DAYS });
      }
      await runLifecycleOnce();
    } catch (e) {
      logger.warn({ err: e?.message }, "Worker: churn job failed");
    }
  }, { timezone: config.CRON_TZ });

  logger.info("Worker started; awaiting jobs...");

  // Lightweight observability server for health/metrics
  const app = express();
  app.use(observabilityRoutes);
  server = app.listen(config.WORKER_PORT, "0.0.0.0", () => {
    logger.info({ port: config.WORKER_PORT }, "Worker observability server listening");
  });
}

startWorkers().catch((e) => {
  logger.fatal({ err: e?.message, stack: e?.stack }, "Worker failed to start");
  process.exit(1);
});

function shutdown(signal) {
  logger.info({ signal }, "Worker shutting down gracefully");
  if (webhookInterval) clearInterval(webhookInterval);
  if (jobInterval) clearInterval(jobInterval);
  if (cronTask) cronTask.stop();
  server?.close?.(() => logger.info("Worker observability server closed"));
  closeDatabase()
    .catch((e) => logger.warn({ err: e?.message }, "Worker DB close failed"))
    .finally(() => setTimeout(() => process.exit(0), 2000).unref());
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
