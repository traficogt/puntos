import {runSecondVisitAutomationsOnce} from './services/second-visit-service.js';
import {processWeeklyOwnerBriefsOnce} from './services/weekly-owner-brief-service.js';
import express from "express";
import { processNativeWalletUpdates } from "./services/native-wallet/runtime.js";
import cron from "node-cron";
import { processMobilePushUpdates, closeMobilePush } from "./services/mobile-push/runtime.js";

import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { initDatabase, closeDatabase, withDbClientContext } from "./database.js";
import { deliverPendingOnce } from "./services/webhook-service.js";
import { syncConfiguredPosOnce } from "./services/pos-integration-service.js";
import { processPendingJobsOnce } from "./services/job-service.js";
import { runLifecycleOnce, createMarketingTick } from "./services/lifecycle-service.js";
import { runLedgerReconciliation } from "./services/ledger-reconciliation-service.js";
import { resolveCertificationPeriod, writeLedgerCertificationArtifacts } from "./services/ledger-certification-service.js";
import { BusinessRepo } from "./repositories/business-repository.js";
import { WebhookRepo } from "./repositories/webhook-repository.js";
import observabilityRoutes from "./routes/observability.js";

let webhookInterval;
let jobInterval;
let campaignMessageInterval;
let guidedGrowthInterval;
let guidedGrowthRunning = false;
const marketingTick = createMarketingTick();
let posInterval;
let nativeWalletInterval;
let mobilePushInterval;
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

  nativeWalletInterval = setInterval(processNativeWalletUpdates, 60_000);
  mobilePushInterval = setInterval(processMobilePushUpdates, 30_000);

  logger.info("Worker: starting webhook delivery loop (60s)");
  webhookInterval = setInterval(() => {
    deliverPendingOnce().catch((e) => logger.warn({ err: e?.message }, "Worker: deliverPendingOnce failed"));
  }, 60_000);

  logger.info("Worker: starting background job loop");
  jobInterval = setInterval(() => {
    processPendingJobsOnce({ limit: config.JOB_WORKER_BATCH_SIZE })
      .catch((e) => logger.warn({ err: e?.message }, "Worker: processPendingJobsOnce failed"));
  }, config.JOB_WORKER_INTERVAL_MS);

  campaignMessageInterval = setInterval(marketingTick, 60_000);
  guidedGrowthInterval = setInterval(async () => {
    if (guidedGrowthRunning) return;
    guidedGrowthRunning = true;
    try {
      try { await runSecondVisitAutomationsOnce(); }
      catch { logger.warn('Worker: second-visit preparation did not complete'); }
      try { await processWeeklyOwnerBriefsOnce(); }
      catch { logger.warn('Worker: owner brief processing did not complete'); }
    } finally { guidedGrowthRunning = false; }
  }, 60_000);

  logger.info("Worker: scheduling daily lifecycle maintenance");
  posInterval = setInterval(() => {
    syncConfiguredPosOnce().catch(() => logger.warn("Worker: POS polling did not complete"));
  }, 300_000);
  const hour = String(config.CHURN_SEND_HOUR_LOCAL).padStart(2, "0");
  cronTask = cron.schedule(`0 ${hour} * * *`, async () => {
    try { await runLifecycleOnce(); }
    catch { logger.warn("Worker: daily lifecycle maintenance did not complete"); }
    try {
      const ids = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => BusinessRepo.listAllIds());
      const reconciliation = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => (
        runLedgerReconciliation({
          limit: config.LEDGER_RECONCILE_LIMIT,
          repair: config.LEDGER_RECONCILE_REPAIR,
          persist: true
        })
      ));
      logger.info({
        checkedCustomers: reconciliation.checkedCustomers,
        mismatchedCustomers: reconciliation.mismatchedCustomers,
        repairedCustomers: reconciliation.repairedCustomers,
        repairMode: config.LEDGER_RECONCILE_REPAIR
      }, "Worker: ledger reconciliation completed");
      if (reconciliation.mismatchedCustomers > 0 && !config.LEDGER_RECONCILE_REPAIR) {
        logger.warn({
          mismatchedCustomers: reconciliation.mismatchedCustomers
        }, "Worker: ledger reconciliation detected drift requiring manual review");
      }
      const period = resolveCertificationPeriod();
      const certificationArtifacts = [];
      for (const bid of ids) {
        const artifact = await writeLedgerCertificationArtifacts({
          businessId: bid,
          from: period.from,
          to: period.to
        });
        certificationArtifacts.push({
          businessId: artifact.businessId,
          certificationStatus: artifact.certificationStatus,
          jsonPath: artifact.jsonPath,
          csvPath: artifact.csvPath
        });
      }
      logger.info({
        period,
        businesses: certificationArtifacts.length
      }, "Worker: wrote daily ledger certification artifacts");
    } catch (e) {
      logger.warn({ err: e?.message }, "Worker: daily ledger maintenance failed");
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
  if (campaignMessageInterval) clearInterval(campaignMessageInterval);
  if (guidedGrowthInterval) clearInterval(guidedGrowthInterval);
  if (posInterval) clearInterval(posInterval);
  if (nativeWalletInterval) clearInterval(nativeWalletInterval);
  if (mobilePushInterval) clearInterval(mobilePushInterval);
  closeMobilePush();
  if (cronTask) cronTask.stop();
  server?.close?.(() => logger.info("Worker observability server closed"));
  closeDatabase()
    .catch((e) => logger.warn({ err: e?.message }, "Worker DB close failed"))
    .finally(() => setTimeout(() => process.exit(0), 2000).unref());
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
