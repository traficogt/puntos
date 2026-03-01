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
  QR_PUBLIC_KEY_PEM: "public-key"
};

function loadConfig(overrides = {}) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "await import('./src/config/index.js'); process.stdout.write('ok');"
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        ...baseEnv,
        ...overrides
      },
      encoding: "utf8"
    }
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
    SUPER_ADMIN_PASSWORD_HASH: ""
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SUPER_ADMIN_EMAIL requires SUPER_ADMIN_PASSWORD_HASH in production/);
});

test("production config loads with the hardened minimum env", () => {
  const result = loadConfig();
  assert.equal(result.status, 0, result.stderr);
});
