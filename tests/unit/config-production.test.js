import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const baseEnv = {
  NODE_ENV: "production",
  DB_HOST: "localhost",
  DB_NAME: "puntos",
  DB_USER: "puntos_app",
  DB_PASSWORD_FILE: "",
  DB_PASSWORD: "db-password-12345",
  DB_MIGRATIONS_PASSWORD_FILE: "",
  JWT_SECRET: "jwt-secret-abcdefghijklmnopqrstuvwxyz",
  JWT_SECRET_FILE: "",
  APP_ORIGIN: "https://example.com",
  CORS_ORIGIN: "https://example.com",
  TRUST_PROXY: "1",
  SUPER_ADMIN_EMAIL: "",
  SUPER_ADMIN_PASSWORD: "",
  METRICS_TOKEN_FILE: "",
  METRICS_TOKEN: "metrics-token-12345",
  WEBHOOK_SECRET_ENC_KEY_FILE: "",
  WEBHOOK_SECRET_ENC_KEY: "webhook-secret-abcdefghijklmnopqrstuvwxyz",
  SUPER_ADMIN_PASSWORD_HASH_FILE: "",
  QR_PRIVATE_KEY_PEM_FILE: "",
  QR_PRIVATE_KEY_PEM: "private-key",
  QR_PUBLIC_KEY_PEM_FILE: "",
  QR_PUBLIC_KEY_PEM: "public-key",
};

function loadConfig(overrides = {}) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "await import('./src/config/index.js'); process.stdout.write('ok');",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        ...baseEnv,
        ...overrides,
      },
      encoding: "utf8",
    },
  );
}

test("production config rejects non-https app origins", () => {
  const result = loadConfig({ APP_ORIGIN: "http://example.com" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APP_ORIGIN must use https in production/);
});

test("production config requires TRUST_PROXY", () => {
  const result = loadConfig({ TRUST_PROXY: "0" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TRUST_PROXY must be enabled in production HTTPS deployments/);
});

test("production config requires a hashed super admin password", () => {
  const result = loadConfig({
    SUPER_ADMIN_EMAIL: "super@example.com",
    SUPER_ADMIN_PASSWORD_HASH: "",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SUPER_ADMIN_EMAIL requires SUPER_ADMIN_PASSWORD_HASH in production/);
});

test("production config loads with the hardened minimum env", () => {
  const result = loadConfig();
  assert.equal(result.status, 0, result.stderr);
});

function readConfigValue(expression, overrides = {}) {
  const env = { ...process.env, NODE_OPTIONS: "", ...baseEnv, ...overrides };
  for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete env[key];
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { config } = await import('./src/config/index.js'); process.stdout.write(JSON.stringify(${expression}));`,
    ],
    { cwd: process.cwd(), env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("in-process workers default off in production, on elsewhere, and honour an explicit value", () => {
  assert.equal(
    readConfigValue("config.IN_PROCESS_WORKERS", { IN_PROCESS_WORKERS: undefined }),
    false,
  );
  assert.equal(
    readConfigValue("config.IN_PROCESS_WORKERS", {
      IN_PROCESS_WORKERS: undefined,
      NODE_ENV: "development",
    }),
    true,
  );
  assert.equal(readConfigValue("config.IN_PROCESS_WORKERS", { IN_PROCESS_WORKERS: "true" }), true);
  assert.equal(
    readConfigValue("config.IN_PROCESS_WORKERS", {
      IN_PROCESS_WORKERS: "false",
      NODE_ENV: "development",
    }),
    false,
  );
});

test("session lifetimes come from config with blank values falling back to the defaults", () => {
  assert.deepEqual(
    readConfigValue(
      "[config.APP_SESSION_IDLE_MS, config.APP_SESSION_ABSOLUTE_MS, config.SUPER_SESSION_IDLE_MS, config.SUPER_SESSION_ABSOLUTE_MS, config.RECENT_REAUTH_WINDOW_MS]",
      {
        APP_SESSION_IDLE_MS: "1000",
        APP_SESSION_ABSOLUTE_MS: "",
        SUPER_SESSION_IDLE_MS: undefined,
        SUPER_SESSION_ABSOLUTE_MS: undefined,
        RECENT_REAUTH_WINDOW_MS: "2000",
      },
    ),
    [1000, 8 * 60 * 60 * 1000, 10 * 60 * 1000, 4 * 60 * 60 * 1000, 2000],
  );
});

test("production requires the Turnstile site key whenever the secret is configured", () => {
  const missing = loadConfig({
    CONTACT_TURNSTILE_SECRET: "turnstile-secret-value",
    CONTACT_TURNSTILE_SITE_KEY: "",
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /CONTACT_TURNSTILE_SITE_KEY is required in production/);
  const configured = loadConfig({
    CONTACT_TURNSTILE_SECRET: "turnstile-secret-value",
    CONTACT_TURNSTILE_SITE_KEY: "0xEXAMPLESITEKEY",
  });
  assert.equal(configured.status, 0, configured.stderr);
  assert.equal(readConfigValue("config.CONTACT_TURNSTILE_SITE_KEY", {}), "");
});
