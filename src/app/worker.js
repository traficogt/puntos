import express from "express";
import { closeMobilePush } from "./services/mobile-push/runtime.js";

import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { initDatabase, closeDatabase } from "./database.js";
import { closeJobQueueRedis } from "./services/job-service.js";
import { WORKER, runStartupMaintenance, startScheduler, stopScheduler } from "./scheduler.js";
import observabilityRoutes from "./routes/observability.js";

/** @type {import("node:http").Server | undefined} */
let server;

async function startWorkers() {
  await initDatabase();
  // Purges stale support uploads and rotates stored secrets before any timer starts.
  await runStartupMaintenance(WORKER);

  startScheduler(WORKER);
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

/** @param {NodeJS.Signals} signal */
function shutdown(signal) {
  logger.info({ signal }, "Worker shutting down gracefully");
  stopScheduler();
  closeMobilePush();
  server?.close?.(() => logger.info("Worker observability server closed"));
  Promise.allSettled([
    closeDatabase().catch((e) => logger.warn({ err: e?.message }, "Worker DB close failed")),
    closeJobQueueRedis(),
  ]).finally(() => setTimeout(() => process.exit(0), 2000).unref());
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
