#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
dotenv.config();

function cliArg(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function nowStamp() {
  return new Date().toISOString().replaceAll(":", "-");
}

function ensureDir(dirPath) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.mkdirSync(dirPath, { recursive: true });
}

function prepareSecretFileEnv() {
  const secretsDir = String(process.env.SECRETS_DIR || "").trim();
  if (!secretsDir) return;

  for (const fileVar of Object.keys(process.env).filter((name) => name.endsWith("_FILE"))) {
    const current = String(process.env[fileVar] || "").trim();
    if (!current.startsWith("/app/.secrets/")) continue;
    const candidate = path.join(secretsDir, path.basename(current));
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (fs.existsSync(candidate)) {
      process.env[fileVar] = candidate;
    }
  }
}

async function loadDatabaseModule() {
  prepareSecretFileEnv();
  return import("../app/database.js");
}

function cookieHeader(response) {
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")] : []);
  return cookies
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

async function request(baseUrl, pathname, timeoutMs, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(new URL(pathname, baseUrl), {
      redirect: "manual",
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function expectJson(baseUrl, pathname, timeoutMs, init = {}) {
  const response = await request(baseUrl, pathname, timeoutMs, init);
  if (!response.ok) {
    throw new Error(`${pathname} returned HTTP ${response.status}`);
  }
  return await response.json();
}

function migrationFiles() {
  const migrationsDir = path.join(process.cwd(), "src", "app", "migrations");
  return fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
}

export async function runRollbackVerification({
  baseUrl = process.env.ROLLBACK_BASE_URL || "http://localhost:3001",
  outputPath = "",
  timeoutMs = Number(process.env.ROLLBACK_TIMEOUT_MS || "5000"),
  expectVersion = process.env.EXPECT_VERSION || "",
  expectBuildSha = process.env.EXPECT_BUILD_SHA || "",
  superEmail = process.env.SMOKE_SUPER_EMAIL || process.env.SUPER_ADMIN_EMAIL || "",
  superPassword = process.env.SMOKE_SUPER_PASSWORD || process.env.SUPER_ADMIN_PASSWORD || "",
  requireSuperLogin = false
} = {}) {
  const health = await expectJson(baseUrl, "/api/health", timeoutMs);
  const ready = await expectJson(baseUrl, "/api/ready", timeoutMs);
  const info = await expectJson(baseUrl, "/api/info", timeoutMs);

  if (health.service !== "ok" || health.database !== "ok") {
    throw new Error("Health check did not report service=ok and database=ok");
  }
  if (ready.ready !== true) {
    throw new Error("Readiness check did not report ready=true");
  }
  if (expectVersion && info.version !== expectVersion) {
    throw new Error(`Expected version ${expectVersion}, got ${info.version || "(empty)"}`);
  }
  if (expectBuildSha && info.build_sha !== expectBuildSha) {
    throw new Error(`Expected build_sha ${expectBuildSha}, got ${info.build_sha || "(empty)"}`);
  }

  let superSession = { checked: false, ok: false };
  if (requireSuperLogin) {
    if (!superEmail || !superPassword) {
      throw new Error("Super-login verification requested but credentials were not provided");
    }
    const loginResponse = await request(baseUrl, "/api/super/login", timeoutMs, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: superEmail, password: superPassword })
    });
    if (!loginResponse.ok) {
      throw new Error(`/api/super/login returned HTTP ${loginResponse.status}`);
    }
    const cookie = cookieHeader(loginResponse);
    if (!cookie.includes("__Host-pf_super=")) {
      throw new Error("Super login did not return the __Host-pf_super cookie");
    }
    const meResponse = await request(baseUrl, "/api/super/me", timeoutMs, { headers: { cookie } });
    if (!meResponse.ok) {
      throw new Error(`/api/super/me returned HTTP ${meResponse.status}`);
    }
    superSession = { checked: true, ok: true };
  }

  const { initDatabase, listManagedMigrations } = await loadDatabaseModule();
  await initDatabase();
  const applied = await listManagedMigrations();
  const files = migrationFiles();
  const appliedVersions = new Set(applied.map((entry) => entry.version));
  const pending = files.filter((file) => !appliedVersions.has(file));
  if (pending.length) {
    throw new Error(`Rollback target still has pending migrations: ${pending.join(", ")}`);
  }

  const report = {
    verified_at: new Date().toISOString(),
    base_url: baseUrl,
    expected: {
      version: expectVersion || null,
      build_sha: expectBuildSha || null,
      require_super_login: requireSuperLogin
    },
    observed: {
      version: info.version || null,
      build_sha: info.build_sha || null,
      health,
      ready,
      super_session: superSession
    },
    migrations: {
      applied_count: applied.length,
      applied_versions: applied.map((entry) => entry.version),
      pending_versions: pending
    }
  };

  const resolvedOutput = outputPath
    || path.join(process.cwd(), "artifacts", "rollback-verifications", `rollback_verify_${nowStamp()}.json`);
  ensureDir(path.dirname(resolvedOutput));
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.writeFileSync(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, outputPath: resolvedOutput };
}

async function main() {
  const baseUrl = cliArg("--base-url", process.env.ROLLBACK_BASE_URL || "http://localhost:3001");
  const outputPath = cliArg("--output", "");
  const timeoutMs = Number(cliArg("--timeout-ms", process.env.ROLLBACK_TIMEOUT_MS || "5000"));
  const expectVersion = cliArg("--expect-version", process.env.EXPECT_VERSION || "");
  const expectBuildSha = cliArg("--expect-build-sha", process.env.EXPECT_BUILD_SHA || "");
  const requireSuperLogin = hasFlag("--require-super-login");
  const superEmail = cliArg("--super-email", process.env.SMOKE_SUPER_EMAIL || process.env.SUPER_ADMIN_EMAIL || "");
  const superPassword = cliArg("--super-password", process.env.SMOKE_SUPER_PASSWORD || process.env.SUPER_ADMIN_PASSWORD || "");

  try {
    const result = await runRollbackVerification({
      baseUrl,
      outputPath,
      timeoutMs,
      expectVersion,
      expectBuildSha,
      superEmail,
      superPassword,
      requireSuperLogin
    });
    console.log(`Rollback verification written to ${path.relative(process.cwd(), result.outputPath)}`);
  } finally {
    const { closeDatabase } = await loadDatabaseModule();
    await closeDatabase().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`Rollback verification: FAIL: ${error?.message || error}`);
    process.exit(1);
  });
}
