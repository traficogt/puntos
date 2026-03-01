import dotenv from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** @typedef {import("../types/config.js").AppConfig} AppConfig */

dotenv.config();
const IS_PROD = (process.env.NODE_ENV ?? "production") === "production";

/**
 * @param {unknown} v
 * @returns {string}
 */
function resolveFilePath(v) {
  const raw = String(v || "").trim();
  if (!raw) return "";
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

/**
 * @param {string} fileVarName
 * @returns {string | undefined}
 */
function readFileValue(fileVarName) {
  const fileRef = process.env[fileVarName];
  if (!fileRef) return undefined;
  const resolved = resolveFilePath(fileRef);
  try {
    // Secret file paths are runtime-configurable by design.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return fs.readFileSync(resolved, "utf8").trim();
  } catch (err) {
    const code = err && typeof err === "object" ? err.code : "";
    if (!IS_PROD && (code === "ENOENT" || code === "ENOTDIR")) {
      return undefined;
    }
    throw err;
  }
}

/**
 * @param {string} name
 * @param {string | undefined} [fallback]
 * @returns {string | undefined}
 */
function envValue(name, fallback = undefined) {
  const fileValue = readFileValue(`${name}_FILE`);
  if (fileValue !== undefined) return fileValue;
  return process.env[name] ?? fallback;
}

/**
 * @param {string} name
 * @param {string | undefined} [fallback]
 * @returns {string}
 */
function requireEnv(name, fallback = undefined) {
  const v = envValue(name, fallback);
  if (v === undefined || v === "") throw new Error(`Missing env: ${name}`);
  return v;
}

/**
 * @param {string} name
 * @param {string | undefined} fallback
 * @param {{ minLen?: number }} [options]
 * @returns {string}
 */
function requireSecret(name, fallback, { minLen = 16 } = {}) {
  const v = requireEnv(name, fallback);
  const isProd = (process.env.NODE_ENV ?? "production") === "production";
  const lower = String(v).toLowerCase();
  const placeholder = lower.includes("change_me") || lower.includes("changeme") || lower.includes("replace_me") || lower.includes("default");
  if (isProd) {
    // Fail fast if still using placeholders or obvious defaults
    if (placeholder) throw new Error(`Insecure secret for ${name}: replace placeholder value`);
    if (String(v).length < minLen) throw new Error(`Secret ${name} too short (min ${minLen})`);
  }
  return v;
}

/**
 * @param {string | undefined} v
 * @returns {string[]}
 */
function parseCsv(v) {
  if (!v) return [];
  return String(v)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * @param {string | undefined} v
 * @param {string} fallback
 * @returns {string[]}
 */
function parseOrigins(v, fallback) {
  const list = parseCsv(v);
  const origins = list.length ? list : [fallback];
  for (const o of origins) {
    if (!/^https?:\/\/[^ ]+$/i.test(o)) {
      throw new Error(`Invalid origin value: ${o}`);
    }
    if (o.trim() === "*") throw new Error("CORS origins cannot be '*'");
  }
  return origins;
}

/**
 * @param {string | undefined} v
 * @param {Record<string, unknown>} [fallback]
 * @returns {Record<string, unknown>}
 */
function parseJsonObject(v, fallback = {}) {
  if (!v) return fallback;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * @param {string | undefined} v
 * @returns {string[]}
 */
function parseMaybeCsvOrJsonArray(v) {
  if (!v) return [];
  const raw = String(v).trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  return parseCsv(raw);
}

/**
 * @param {string} name
 * @returns {string}
 */
function normalizePemEnv(name) {
  return String(envValue(name, "") || "").replace(/\\n/g, "\n").trim();
}

/**
 * @param {string} origin
 * @returns {boolean}
 */
function isHttpsOrigin(origin) {
  return String(origin).toLowerCase().startsWith("https://");
}

/** @type {AppConfig} */
export const config = {
  NODE_ENV: envValue("NODE_ENV", "production"),
  PORT: Number(process.env.PORT ?? 3001),
  WORKER_PORT: Number(process.env.WORKER_PORT ?? 3002),

  APP_ORIGIN: envValue("APP_ORIGIN", `http://localhost:${process.env.PORT ?? 3001}`),
  CORS_ORIGINS: parseOrigins(envValue("CORS_ORIGIN", ""), `http://localhost:${process.env.PORT ?? 3001}`),

  // When behind Caddy/Nginx reverse proxy, set TRUST_PROXY=1
  TRUST_PROXY: Number(process.env.TRUST_PROXY ?? 0),

  // Database
  DB_HOST: requireEnv("DB_HOST", "localhost"),
  DB_PORT: Number(process.env.DB_PORT ?? 5432),
  DB_NAME: requireEnv("DB_NAME", "puntos"),
  DB_USER: requireEnv("DB_USER", "loyalty"),
  DB_PASSWORD: requireSecret("DB_PASSWORD", "CHANGE_ME", { minLen: 12 }),
  DB_MIGRATIONS_USER: envValue("DB_MIGRATIONS_USER", envValue("DB_USER", "loyalty")),
  DB_MIGRATIONS_PASSWORD: envValue("DB_MIGRATIONS_PASSWORD", envValue("DB_PASSWORD", "CHANGE_ME")),

  // Auth (HS256)
  JWT_SECRET: requireSecret("JWT_SECRET", "CHANGE_ME_LONG_RANDOM", { minLen: 32 }),

  // Cookie names
  STAFF_COOKIE_NAME: process.env.STAFF_COOKIE_NAME ?? "pf_staff",
  CUSTOMER_COOKIE_NAME: process.env.CUSTOMER_COOKIE_NAME ?? "pf_customer",
  SUPER_COOKIE_NAME: process.env.SUPER_COOKIE_NAME ?? "pf_super",

  // Platform super admin (optional)
  SUPER_ADMIN_EMAIL: envValue("SUPER_ADMIN_EMAIL", ""),
  SUPER_ADMIN_PASSWORD: envValue("SUPER_ADMIN_PASSWORD", ""),
  SUPER_ADMIN_PASSWORD_HASH: envValue("SUPER_ADMIN_PASSWORD_HASH", ""),
  SIGNUP_CAPTCHA_SECRET: envValue("SIGNUP_CAPTCHA_SECRET", ""),

  // QR token signing (Ed25519)
  // In test runs, generate an ephemeral keypair when unset so e2e can run without secrets.
  // (Never do this in production.)
  QR_PRIVATE_KEY_PEM: "",
  QR_PUBLIC_KEY_PEM: "",

  // Messaging provider: dev | whatsapp_cloud | smtp_email | http_sms_gateway
  MESSAGE_PROVIDER: process.env.MESSAGE_PROVIDER ?? "dev",

  // WhatsApp Cloud API (optional)
  WA_PHONE_NUMBER_ID: envValue("WA_PHONE_NUMBER_ID", ""),
  WA_ACCESS_TOKEN: envValue("WA_ACCESS_TOKEN", ""),

  // SMTP Email (optional)
  SMTP_HOST: envValue("SMTP_HOST", ""),
  SMTP_PORT: Number(process.env.SMTP_PORT ?? 587),
  SMTP_USER: envValue("SMTP_USER", ""),
  SMTP_PASS: envValue("SMTP_PASS", ""),
  SMTP_FROM: envValue("SMTP_FROM", "PuntosFieles <no-reply@puntos.gt>"),

  // HTTP SMS Gateway (optional)
  SMS_GATEWAY_URL: envValue("SMS_GATEWAY_URL", ""),
  SMS_GATEWAY_TOKEN: envValue("SMS_GATEWAY_TOKEN", ""),

  // Rate limit
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX ?? 120),
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  RATE_LIMIT_DRIVER: process.env.RATE_LIMIT_DRIVER ?? "memory", // memory | redis

  REDIS_URL: envValue("REDIS_URL", ""),

  // Job queue driver: db | redis
  JOB_QUEUE_DRIVER: envValue("JOB_QUEUE_DRIVER", "db"),

  // Churn automation
  CHURN_DAYS: Number(process.env.CHURN_DAYS ?? 30),
  CHURN_SEND_HOUR_LOCAL: Number(process.env.CHURN_SEND_HOUR_LOCAL ?? 9),
  CRON_TZ: envValue("CRON_TZ", "America/Guatemala"),

  // Webhooks
  WEBHOOK_TIMEOUT_MS: Number(process.env.WEBHOOK_TIMEOUT_MS ?? 8000),
  WEBHOOK_CONCURRENCY: Number(process.env.WEBHOOK_CONCURRENCY ?? 5),
  WEBHOOK_MAX_ATTEMPTS: Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 3),
  WEBHOOK_REQUIRE_HTTPS: (process.env.WEBHOOK_REQUIRE_HTTPS ?? "true") !== "false",
  WEBHOOK_ALLOWLIST: parseCsv(process.env.WEBHOOK_ALLOWLIST ?? ""),
  WEBHOOK_SECRET_ENC_KEY: envValue("WEBHOOK_SECRET_ENC_KEY", ""),
  WEBHOOK_SECRET_ENC_KEY_PREVIOUS: parseMaybeCsvOrJsonArray(envValue("WEBHOOK_SECRET_ENC_KEY_PREVIOUS", "")),
  PAYMENT_WEBHOOK_SECRETS: parseJsonObject(envValue("PAYMENT_WEBHOOK_SECRETS", ""), {}),
  PAYMENT_WEBHOOK_HMAC_SECRETS: parseJsonObject(envValue("PAYMENT_WEBHOOK_HMAC_SECRETS", ""), {}),
  PAYMENT_WEBHOOK_ALLOWED_PROVIDERS: parseCsv(envValue("PAYMENT_WEBHOOK_ALLOWED_PROVIDERS", "cubo,paybi,qpaypro,neonet")),
  PAYMENT_WEBHOOK_REQUIRE_AUTH: (process.env.PAYMENT_WEBHOOK_REQUIRE_AUTH ?? "true") !== "false",
  METRICS_TOKEN: envValue("METRICS_TOKEN", (process.env.NODE_ENV ?? "production") === "test" ? "test-metrics-token" : ""),
  EXTERNAL_AWARD_API_KEY: envValue("EXTERNAL_AWARD_API_KEY", ""),
  REGISTRATION_API_KEY: envValue("REGISTRATION_API_KEY", ""),

  // Background jobs
  JOB_WORKER_INTERVAL_MS: Number(process.env.JOB_WORKER_INTERVAL_MS ?? 15000),
  JOB_WORKER_BATCH_SIZE: Number(process.env.JOB_WORKER_BATCH_SIZE ?? 10),

  // Plans
  DEFAULT_PLAN: envValue("DEFAULT_PLAN", "EMPRENDEDOR"),
  ENFORCE_TENANT_CONTEXT: (process.env.ENFORCE_TENANT_CONTEXT ?? "true") !== "false",

  // Schema extensions (tiers/referrals/gamification/analytics)
  AUTO_APPLY_SCHEMA_EXTENSIONS: (process.env.AUTO_APPLY_SCHEMA_EXTENSIONS ?? (IS_PROD ? "false" : "true")) === "true",
  AUTO_APPLY_MIGRATIONS: (process.env.AUTO_APPLY_MIGRATIONS ?? (IS_PROD ? "false" : "true")) === "true"
};

// Late-init derived config values that depend on NODE_ENV.
{
  const priv = normalizePemEnv("QR_PRIVATE_KEY_PEM");
  const pub = normalizePemEnv("QR_PUBLIC_KEY_PEM");
  if (config.NODE_ENV === "test" && (!priv || !pub)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" }
    });
    config.QR_PRIVATE_KEY_PEM = privateKey.trim();
    config.QR_PUBLIC_KEY_PEM = publicKey.trim();
  } else {
    config.QR_PRIVATE_KEY_PEM = priv;
    config.QR_PUBLIC_KEY_PEM = pub;
  }
}

// Enforce QR key presence in production (core flow depends on this)
if (config.NODE_ENV === "production") {
  for (const o of config.CORS_ORIGINS) {
    if (String(o).trim() === "*") throw new Error("CORS_ORIGIN cannot be '*' in production");
    if (!isHttpsOrigin(o)) throw new Error(`CORS_ORIGIN must use https in production: ${o}`);
  }
  if (!isHttpsOrigin(config.APP_ORIGIN)) {
    throw new Error(`APP_ORIGIN must use https in production: ${config.APP_ORIGIN}`);
  }
  if (config.TRUST_PROXY < 1) {
    throw new Error("TRUST_PROXY must be enabled in production HTTPS deployments");
  }
  if (!config.METRICS_TOKEN) {
    throw new Error("METRICS_TOKEN is required in production");
  }
  if (!config.WEBHOOK_SECRET_ENC_KEY || String(config.WEBHOOK_SECRET_ENC_KEY).length < 32) {
    throw new Error("WEBHOOK_SECRET_ENC_KEY is required in production and must be at least 32 characters");
  }
  if (config.SUPER_ADMIN_EMAIL && !config.SUPER_ADMIN_PASSWORD_HASH) {
    throw new Error("SUPER_ADMIN_EMAIL requires SUPER_ADMIN_PASSWORD_HASH in production");
  }
  if (config.SUPER_ADMIN_PASSWORD && !config.SUPER_ADMIN_PASSWORD_HASH) {
    throw new Error("SUPER_ADMIN_PASSWORD is not allowed in production; use SUPER_ADMIN_PASSWORD_HASH");
  }
  if (!config.QR_PRIVATE_KEY_PEM || !config.QR_PUBLIC_KEY_PEM) {
    throw new Error("Missing QR_PRIVATE_KEY_PEM / QR_PUBLIC_KEY_PEM in production");
  }
}
