import { pino } from "pino";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkg = require(path.join(process.cwd(), "package.json"));

const levelFromEnv = process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info");

export function safeLogUrl(value) {
  return String(value || "").split("?")[0].replace(/(\/public\/marketing-unsubscribe\/)[^/]+/gi, "$1[REDACTED]").replace(/(\/wallet\/apple\/v1\/devices\/)[^/]+/gi, "$1[REDACTED]").replace(/(\/(?:registrations|passes)\/pass\.[^/]+\/)[^/]+/gi, "$1[REDACTED]").replace(/(\/magic\/(?:staff|customer)\/)[^/]+/gi, "$1[REDACTED]");
}

export function safeRequestSerializer(req) {
  return req ? { ...req, url: safeLogUrl(req.url) } : req;
}

export const logger = pino({
  level: levelFromEnv,
  base: {
    service: "PuntosFieles",
    version: pkg.version,
    environment: process.env.NODE_ENV || "production"
  },
  serializers: {
    req: safeRequestSerializer
  },
  redact: [
    "req.headers.authorization", "req.headers.cookie", "req.headers['x-csrf-token']",
    "req.headers['x-api-key']", "req.headers['x-pf-api-key']", "res.headers['set-cookie']",
    "req.headers['x-webhook-secret']", "req.headers['x-registration-token']", "req.headers['x-metrics-token']",
    "req.headers['x-signature']", "req.headers['x-provider-signature']",
    "req.query", "req.params"
  ]
});

// pino-http overrides logger child serializers unless explicitly configured.
export const httpLogOptions = { logger, serializers: { req: safeRequestSerializer } };
