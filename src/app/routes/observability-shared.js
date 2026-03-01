import { createRequire } from "node:module";
import path from "node:path";
import { config } from "../../config/index.js";

const require = createRequire(import.meta.url);
const pkg = require(path.join(process.cwd(), "package.json"));

export function hasValidMetricsToken(req) {
  const configured = String(config.METRICS_TOKEN || "").trim();
  if (!configured) return false;

  const auth = String(req.headers.authorization || "");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const header = String(req.headers["x-metrics-token"] || "").trim();
  return bearer === configured || header === configured;
}

export function buildProbeErrorBody(baseBody) {
  return {
    ...baseBody,
    error: "Service unavailable",
    timestamp: new Date().toISOString()
  };
}

export function serviceInfo() {
  return {
    service: "PuntosFieles",
    version: pkg.version,
    environment: config.NODE_ENV,
    uptime_seconds: process.uptime(),
    node_version: process.version,
    timestamp: new Date().toISOString()
  };
}
