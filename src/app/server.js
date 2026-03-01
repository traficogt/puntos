import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import cron from "node-cron";
import { randomUUID } from "node:crypto";

import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { initDatabase, closeDatabase, withDbClientContext } from "./database.js";
import { apiRoutes } from "./routes/index.js";
import { errorHandler, notFound } from "../middleware/common.js";
import { csrfInit } from "../middleware/csrf.js";
import { deliverPendingOnce } from "./services/webhook-service.js";
import { BusinessRepo } from "./repositories/business-repository.js";
import { runChurnOnce } from "./services/churn-service.js";
import { runLifecycleOnce } from "./services/lifecycle-service.js";
import { processPendingJobsOnce } from "./services/job-service.js";
import { WebhookRepo } from "./repositories/webhook-repository.js";
import { withPgClient } from "../middleware/pg-client.js";
import { metricsMiddleware } from "../middleware/metrics.js";
import { globalApiRateLimit } from "../middleware/rate-limit.js";

const app = express();
// Default to off in production to avoid duplicate workers when horizontally scaling.
const ENABLE_IN_PROCESS_JOBS = (process.env.IN_PROCESS_WORKERS ?? (config.NODE_ENV === "production" ? "false" : "true")) === "true";

// Prevent 304 responses on API endpoints (breaks fetch() logic in staff UI)
app.set("etag", false);

// Also tell browsers/proxies not to cache API responses
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  next();
});

// If behind a reverse proxy (Caddy/Nginx), enable correct client IP handling for rate-limit/audit logs.
if (config.TRUST_PROXY) {
  app.set("trust proxy", config.TRUST_PROXY);
}

// Logging
// @ts-ignore
const pinoMw = pinoHttp({ logger });
app.use(pinoMw);

// Correlation id in every response for faster support/debugging
app.use((req, res, next) => {
  const requestId = req.id || req.headers["x-request-id"] || randomUUID();
  req.requestId = String(requestId);
  res.setHeader("X-Request-Id", String(requestId));
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  next();
});

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for simplicity
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: config.NODE_ENV === "production" ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false, // Allow embedding resources
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow same-origin/non-browser tools
    if (config.CORS_ORIGINS.includes(origin)) return callback(null, true);
    const err = new Error("CORS origin not allowed");
    // @ts-ignore express error typing
    err.statusCode = 403;
    callback(err);
  },
  credentials: true
}));

app.use(cookieParser());
app.use(withPgClient);
app.use(csrfInit); // Initialize CSRF token for all requests
app.use(metricsMiddleware);
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buf) => {
    // @ts-ignore augment
    req.rawBody = buf.toString("utf8");
  }
}));

// Apply global limiter to API only (avoid throttling static assets/PWA files).
app.use("/api", globalApiRateLimit((req) => {
  // Do not throttle health/observability probes (both /api/* and /api/v1/*).
  const url = String(req.originalUrl || req.url || "");
  const p = String(req.path || "");
  return ["/health", "/ready", "/live", "/metrics", "/info"].some((s) =>
    p === s || p.endsWith(s) || url.includes(`/api/v1${s}`) || url.includes(`/api${s}`)
  );
}));

// Static (PWA)
const publicDir = path.join(process.cwd(), "public");

// Ensure SW isn't aggressively cached
app.get("/sw.js", (req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  next();
});
app.use(express.static(publicDir, { extensions: ["html"] }));

// Friendly routes
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(publicDir, "admin.html")));
app.get("/staff/login", (req, res) => res.sendFile(path.join(publicDir, "staff-login.html")));
app.get("/staff", (req, res) => res.sendFile(path.join(publicDir, "staff.html")));
app.get("/join/:slug", (req, res) => res.sendFile(path.join(publicDir, "join.html")));
app.get("/c", (req, res) => res.sendFile(path.join(publicDir, "customer.html")));
app.get("/super", (req, res) => res.sendFile(path.join(publicDir, "super.html")));

// API
app.use(apiRoutes);

// Errors
app.use(notFound);
app.use(errorHandler);

let server;
let webhookInterval;
let jobInterval;
let cronTask;

async function start() {
  await initDatabase();
  try {
    await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
      const reencrypted = await WebhookRepo.encryptPlaintextSecrets();
      if (reencrypted > 0) {
        logger.info({ reencrypted }, "Encrypted plaintext webhook endpoint secrets");
      }
      const rotatedWebhookSecrets = await WebhookRepo.rotateSecretsToCurrentKey();
      if (rotatedWebhookSecrets > 0) {
        logger.info({ rotatedWebhookSecrets }, "Rotated webhook endpoint secrets to current encryption key");
      }
      const rotatedProgramSecrets = await BusinessRepo.rotateExternalAwardApiKeysToCurrent();
      if (rotatedProgramSecrets > 0) {
        logger.info({ rotatedProgramSecrets }, "Rotated external award API keys to current encryption key");
      }
    });
  } catch (e) {
    logger.warn({ err: e?.message }, "Failed to run secret encryption maintenance");
  }

  if (ENABLE_IN_PROCESS_JOBS) {
    logger.info("Starting in-process job runners (IN_PROCESS_WORKERS=true)");
    // Webhook delivery worker (every minute)
    webhookInterval = setInterval(() => {
      deliverPendingOnce().catch((e) => logger.warn({ err: e?.message }, "deliverPendingOnce failed"));
    }, 60_000);

    // Background job worker
    jobInterval = setInterval(() => {
      processPendingJobsOnce({ limit: config.JOB_WORKER_BATCH_SIZE })
        .catch((e) => logger.warn({ err: e?.message }, "processPendingJobsOnce failed"));
    }, config.JOB_WORKER_INTERVAL_MS);

    // Churn worker: daily at CHURN_SEND_HOUR_LOCAL (server local time)
    const hour = String(config.CHURN_SEND_HOUR_LOCAL).padStart(2, "0");
    cronTask = cron.schedule(`0 ${hour} * * *`, async () => {
      try {
        const ids = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => BusinessRepo.listAllIds());
        for (const bid of ids) {
          await runChurnOnce({ businessId: bid, days: config.CHURN_DAYS });
        }
        await runLifecycleOnce();
      } catch (e) {
        logger.warn({ err: e?.message }, "churn job failed");
      }
    }, { timezone: config.CRON_TZ });
  } else {
    logger.info("IN_PROCESS_WORKERS=false: no background jobs started in API process");
  }

  server = app.listen(config.PORT, "0.0.0.0", () => {
    logger.info(`PuntosFieles listening on :${config.PORT}`);
  });
}

start().catch((e) => {
  logger.fatal({ err: e?.message, stack: e?.stack }, "Failed to start");
  process.exit(1);
});

function shutdown(signal) {
  logger.info({ signal }, "Shutting down gracefully");
  if (webhookInterval) clearInterval(webhookInterval);
  if (jobInterval) clearInterval(jobInterval);
  if (cronTask) cronTask.stop();
  server?.close?.(() => {
    logger.info("HTTP server closed");
  });
  closeDatabase()
    .catch((e) => logger.warn({ err: e?.message }, "Error closing DB pool"))
    .finally(() => {
      setTimeout(() => process.exit(0), 2000).unref();
    });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
