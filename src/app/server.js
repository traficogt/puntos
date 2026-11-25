import { createPublicPlans } from "../middleware/public-plans.js";
import { createSelfServiceWeb } from "../middleware/self-service-web.js";
import { createGuides } from "../middleware/guides.js";
import { createSpanishWeb, createSpanishWebRedirects } from "../middleware/spanish-web.js";
import { createSearchVisibility } from "../middleware/search-visibility.js";
import { createEditorialReview } from "../middleware/editorial-review.js";
import { createIllustrationReview } from "../middleware/illustration-review.js";
import express from "express";
import { createMobilePreview } from "../middleware/mobile-preview.js";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import { isProbePath, requestComplexityLimit } from "../middleware/request-boundaries.js";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { logger, httpLogOptions } from "../utils/logger.js";
import { config } from "../config/index.js";
import { initDatabase, closeDatabase } from "./database.js";
import { apiRoutes } from "./routes/index.js";
import { defaultRequestBody, errorHandler, notFound } from "../middleware/common.js";
import { csrfInit } from "../middleware/csrf.js";
import { closeJobQueueRedis } from "./services/job-service.js";
import { API, runStartupMaintenance, startScheduler, stopScheduler } from "./scheduler.js";
import { mountPgClient } from "../middleware/pg-client.js";
import { metricsMiddleware } from "../middleware/metrics.js";
import { closeRateLimitRedis, globalApiRateLimit } from "../middleware/rate-limit.js";
import { isAllowedApiOrigin } from "../utils/cors-origin.js";
import { resolveHostSplitRedirect, runtimeConfigForHost } from "../utils/app-host-routing.js";
import { setStaticCacheHeaders } from "../utils/static-cache-headers.js";

const app = express();
// Preserve the existing bracket/array query contract across Express majors.
app.set("query parser", "extended");

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
const pinoMw = pinoHttp({
  ...httpLogOptions,
  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  genReqId(req, res) {
    const requestId = String(req.headers["x-request-id"] || randomUUID());
    res.setHeader("X-Request-Id", requestId);
    return requestId;
  },
  /** @param {import("node:http").IncomingMessage} req */
  customProps(req) {
    // pino-http sees the raw IncomingMessage; Express has already decorated it.
    const request = /** @type {import("express").Request} */ (req);
    return {
      request_id: String(request.id || request.requestId || ""),
      tenant_id: request.tenantId ?? null,
    };
  },
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
app.use(
  helmet({
    strictTransportSecurity:
      config.NODE_ENV === "production"
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://privatrack.com",
          "https://static.cloudflareinsights.com",
          "https://challenges.cloudflare.com",
        ],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: [
          "'self'",
          "https://privatrack.com",
          "https://cloudflareinsights.com",
          "https://challenges.cloudflare.com",
          "https://raw.githubusercontent.com",
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["https://challenges.cloudflare.com"],
        upgradeInsecureRequests: config.NODE_ENV === "production" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false, // Allow embedding resources
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

/** @type {import("cors").CorsOptionsDelegate<import("express").Request>} */
const corsDelegate = (req, callback) => {
  const origin = String(req.headers.origin || "").trim();
  const requestOrigin = `${req.protocol}://${req.get("host")}`;
  if (!origin || isAllowedApiOrigin(origin, config.CORS_ORIGINS, requestOrigin)) {
    return callback(null, { origin: true, credentials: true });
  }
  // The error handler reads statusCode (see src/middleware/common.js).
  const err = Object.assign(new Error("CORS origin not allowed"), { statusCode: 403 });
  return callback(err);
};
app.use("/api", cors(corsDelegate));

app.use(cookieParser());
// Request-pinned DB connections only for API prefixes; static assets, HTML
// entry pages and marketing routes never touch the pool.
mountPgClient(app);
app.use(csrfInit); // Initialize CSRF token for all requests
app.use(metricsMiddleware);
app.use(
  "/api",
  globalApiRateLimit((req) => isProbePath(req.path)),
);
app.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      // The body parser sees the raw IncomingMessage; Express has already decorated it.
      /** @type {import("express").Request} */ (req).rawBody = buf.toString("utf8");
    },
  }),
);
app.use(defaultRequestBody, requestComplexityLimit);

app.use(
  createSearchVisibility({
    marketingOrigin: config.MARKETING_ORIGIN,
    appOrigin: config.APP_ORIGIN,
  }),
);
app.use(createEditorialReview({ marketingOrigin: config.MARKETING_ORIGIN }));
app.use(createIllustrationReview());
app.use(createGuides({ marketingOrigin: config.MARKETING_ORIGIN }));

// Static (PWA)
const publicDir = path.join(process.cwd(), "public");
app.use(
  createPublicPlans({
    publicDir,
    marketingOrigin: config.MARKETING_ORIGIN,
    appOrigin: config.APP_ORIGIN,
  }),
);
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
    marketingOrigin: config.MARKETING_ORIGIN,
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
    marketingOrigin: config.MARKETING_ORIGIN,
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
    marketingOrigin: config.MARKETING_ORIGIN,
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
app.use(createSelfServiceWeb(publicDir));
// Versioned asset requests (?v=<content hash>) are immutable for a year; documents and
// sw.js keep their headers (src/utils/static-cache-headers.js).
const setHeaders = setStaticCacheHeaders;
app.use(express.static(publicDir, { extensions: ["html"], redirect: false, setHeaders }));

// Friendly routes
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(publicDir, "admin.html")));
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

/** @type {import("node:http").Server | undefined} */
let server;

async function start() {
  await initDatabase();
  // Rotates stored secrets to the current encryption key (runs regardless of IN_PROCESS_WORKERS).
  await runStartupMaintenance(API);

  // Background jobs are declared once in ./scheduler.js. In production the API
  // runs none by default so horizontally scaled instances do not duplicate the worker.
  if (config.IN_PROCESS_WORKERS) {
    logger.info("Starting in-process job runners (IN_PROCESS_WORKERS=true)");
    startScheduler(API);
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

/** @param {NodeJS.Signals} signal */
function shutdown(signal) {
  logger.info({ signal }, "Shutting down gracefully");
  stopScheduler();
  server?.close?.(() => {
    logger.info("HTTP server closed");
  });
  Promise.allSettled([
    closeDatabase().catch((e) => logger.warn({ err: e?.message }, "Error closing DB pool")),
    closeJobQueueRedis(),
    closeRateLimitRedis(),
  ]).finally(() => {
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
