import { pino } from "pino";

const levelFromEnv = process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info");

export const logger = pino({
  level: levelFromEnv,
  redact: ["req.headers.authorization", "req.headers.cookie"]
});
