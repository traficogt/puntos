import { pino } from "pino";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkg = require(path.join(process.cwd(), "package.json"));

const levelFromEnv = process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info");

export const logger = pino({
  level: levelFromEnv,
  base: {
    service: "PuntosFieles",
    version: pkg.version,
    environment: process.env.NODE_ENV || "production"
  },
  redact: ["req.headers.authorization", "req.headers.cookie"]
});
