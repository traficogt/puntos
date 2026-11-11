import { createPublicPlans } from '../middleware/public-plans.js';
import { createGuides } from "../middleware/guides.js";
import { createSpanishWeb, createSpanishWebRedirects } from "../middleware/spanish-web.js";
import { createSearchVisibility } from "../middleware/search-visibility.js";
import express from "express";
import { createMobilePreview } from "../middleware/mobile-preview.js";
import { processNativeWalletUpdates } from "./services/native-wallet/runtime.js";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { isProbePath, requestComplexityLimit } from "../middleware/request-boundaries.js";
import path from "node:path";
import cron from "node-cron";
import { randomUUID } from "node:crypto";

import { logger, httpLogOptions } from "../utils/logger.js";
import { config } from "../config/index.js";
import { initDatabase, closeDatabase, withDbClientContext } from "./database.js";
import { apiRoutes } from "./routes/index.js";
import { defaultRequestBody, errorHandler, notFound } from "../middleware/common.js";
import { csrfInit } from "../middleware/csrf.js";
import { deliverPendingOnce } from "./services/webhook-service.js";
import { syncConfiguredPosOnce } from "./services/pos-integration-service.js";
import { BusinessRepo } from "./repositories/business-repository.js";
import { runLifecycleOnce, createMarketingTick } from "./services/lifecycle-service.js";
import { processPendingJobsOnce } from "./services/job-service.js";
import { WebhookRepo } from "./repositories/webhook-repository.js";
import { withPgClient } from "../middleware/pg-client.js";
import { metricsMiddleware } from "../middleware/metrics.js";
import { globalApiRateLimit } from "../middleware/rate-limit.js";
import { isAllowedApiOrigin } from "../utils/cors-origin.js";
import { resolveHostSplitRedirect, runtimeConfigForHost } from "../utils/app-host-routing.js";

const app = express();
// Preserve the existing bracket/array query contract across Express majors.
app.set("query parser", "extended");
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
const pinoMw = pinoHttp({
  ...httpLogOptions,
  genReqId(req, res) {
    const requestId = String(req.headers["x-request-id"] || randomUUID());
    res.setHeader("X-Request-Id", requestId);
    return requestId;
  },
  customProps(req) {
    return {
      request_id: String(req.id || req.requestId || ""),
      tenant_id: req.tenantId ?? null
    };
  }
});
app.use(pinoMw);

// Correlation id in every response for faster support/debugging
app.use((req, res, next) => {
  const requestId = req.id || req.headers["x-request-id"] || randomUUID();
  req.requestId = String(requestId);
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  next();
});

// Security
app.use(helmet({
  strictTransportSecurity: config.NODE_ENV === "production"
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://privatrack.com", "https://static.cloudflareinsights.com", "https://challenges.cloudflare.com"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://privatrack.com", "https://cloudflareinsights.com", "https://challenges.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["https://challenges.cloudflare.com"],
      upgradeInsecureRequests: config.NODE_ENV === "production" ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false, // Allow embedding resources
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use("/api", cors((req, callback) => {
  const origin = String(req.headers.origin || "").trim();
  const requestOrigin = `${req.protocol}://${req.get("host")}`;
  if (!origin || isAllowedApiOrigin(origin, config.CORS_ORIGINS, requestOrigin)) {
    return callback(null, { origin: true, credentials: true });
  }
  const err = new Error("CORS origin not allowed");
  // @ts-ignore express error typing
  err.statusCode = 403;
  return callback(err);
}));

app.use(cookieParser());
app.use(withPgClient);
app.use(csrfInit); // Initialize CSRF token for all requests
app.use(metricsMiddleware);
app.use("/api", globalApiRateLimit((req) => isProbePath(req.path)));
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buf) => {
    // @ts-ignore augment
    req.rawBody = buf.toString("utf8");
  }
}));
app.use(defaultRequestBody, requestComplexityLimit);

app.use(createSearchVisibility({ marketingOrigin: config.MARKETING_ORIGIN, appOrigin: config.APP_ORIGIN }));
app.use(createGuides({ marketingOrigin: config.MARKETING_ORIGIN }));

// Static (PWA)
const publicDir = path.join(process.cwd(), "public");
app.use(createPublicPlans({publicDir,marketingOrigin:config.MARKETING_ORIGIN,appOrigin:config.APP_ORIGIN}));
app.use(createSpanishWebRedirects());

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const redirectTo = resolveHostSplitRedirect({
    host: req.get("host"),
    path: req.path,
    originalUrl: req.originalUrl,
    forwardedProto: req.get("x-forwarded-proto"),
    protocol: req.protocol,
    appOrigin: config.APP_ORIGIN,
    marketingOrigin: config.MARKETING_ORIGIN
  });
  if (!redirectTo) return next();
  return res.redirect(302, redirectTo);
});

app.get("/runtime-config.js", (req, res) => {
  const runtimeConfig = runtimeConfigForHost({
    host: req.get("host"),
    forwardedProto: req.get("x-forwarded-proto"),
    protocol: req.protocol,
    appOrigin: config.APP_ORIGIN,
    marketingOrigin: config.MARKETING_ORIGIN
  });
  res.setHeader("Cache-Control", "no-store");
  res.type("application/javascript");
  res.send(`window.__PF_RUNTIME_CONFIG__ = ${JSON.stringify(runtimeConfig, null, 2)};\n`);
});

app.get("/sitio", (req, res) => {
  const runtimeConfig = runtimeConfigForHost({
    host: req.get("host"),
    forwardedProto: req.get("x-forwarded-proto"),
    protocol: req.protocol,
    appOrigin: config.APP_ORIGIN,
    marketingOrigin: config.MARKETING_ORIGIN
  });
  return res.redirect(302, new URL("/", runtimeConfig.marketingOrigin).toString());
});

// Ensure SW isn't aggressively cached
app.get("/sw.js", (req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  next();
});
app.use("/app-preview", createMobilePreview(publicDir));
app.use(createSpanishWeb(publicDir));
app.use(express.static(publicDir, { extensions: ["html"], redirect: false }));

// Friendly routes
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(publicDir, "admin.html")));
app.get("/admin-dashboard", (req, res) => res.sendFile(path.join(publicDir, "admin-dashboard.html")));
app.get("/staff/login", (req, res) => res.sendFile(path.join(publicDir, "staff-login.html")));
app.get("/staff", (req, res) => res.sendFile(path.join(publicDir, "staff.html")));
app.get("/registro/:slug", (req, res) => res.sendFile(path.join(publicDir, "join.html")));
app.get("/ingresar/:slug", (req, res) => res.sendFile(path.join(publicDir, "ingresar.html")));
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
let marketingInterval;
const marketingTick = createMarketingTick();
let posInterval;
let nativeWalletInterval;
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
    nativeWalletInterval = setInterval(processNativeWalletUpdates, 60_000);
    logger.info("Starting in-process job runners (IN_PROCESS_WORKERS=true)");
    posInterval = setInterval(() => {
      syncConfiguredPosOnce().catch(() => logger.warn("POS polling did not complete"));
    }, 300_000);
    // Webhook delivery worker (every minute)
    webhookInterval = setInterval(() => {
      deliverPendingOnce().catch((e) => logger.warn({ err: e?.message }, "deliverPendingOnce failed"));
    }, 60_000);

    // Background job worker
    jobInterval = setInterval(() => {
      processPendingJobsOnce({ limit: config.JOB_WORKER_BATCH_SIZE })
        .catch((e) => logger.warn({ err: e?.message }, "processPendingJobsOnce failed"));
    }, config.JOB_WORKER_INTERVAL_MS);

    // Saved rule schedules are evaluated every minute; both outboxes are
    // processed independently even if incentive generation fails.
    marketingInterval = setInterval(marketingTick, 60_000);

    // Daily maintenance keeps its established business-calendar schedule.
    const hour = String(config.CHURN_SEND_HOUR_LOCAL).padStart(2, "0");
    cronTask = cron.schedule(`0 ${hour} * * *`, async () => {
      try {
        await runLifecycleOnce();
      } catch {
        logger.warn("Daily lifecycle maintenance did not complete");
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
  if (marketingInterval) clearInterval(marketingInterval);
  if (posInterval) clearInterval(posInterval);
  if (nativeWalletInterval) clearInterval(nativeWalletInterval);
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
