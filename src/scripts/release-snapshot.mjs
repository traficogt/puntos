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

async function fetchJson(baseUrl, pathname, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(pathname, baseUrl), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${pathname} returned HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function migrationFiles() {
  const migrationsDir = path.join(process.cwd(), "src", "app", "migrations");
  return fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
}

export async function captureReleaseSnapshot({
  baseUrl = process.env.SNAPSHOT_BASE_URL || "http://localhost:3001",
  outputPath = "",
  timeoutMs = Number(process.env.SNAPSHOT_TIMEOUT_MS || "5000"),
  imageRef = process.env.RELEASE_IMAGE_REF || "",
  buildSha = process.env.RELEASE_SHA || process.env.GITHUB_SHA || "",
  releaseTag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || "",
  allowPendingMigrations = false
} = {}) {
  const health = await fetchJson(baseUrl, "/api/health", timeoutMs);
  const ready = await fetchJson(baseUrl, "/api/ready", timeoutMs);
  const info = await fetchJson(baseUrl, "/api/info", timeoutMs);

  const { initDatabase, listManagedMigrations } = await loadDatabaseModule();
  await initDatabase();
  const applied = await listManagedMigrations();
  const files = migrationFiles();
  const appliedVersions = new Set(applied.map((entry) => entry.version));
  const pending = files.filter((file) => !appliedVersions.has(file));

  if (!allowPendingMigrations && pending.length) {
    throw new Error(`Refusing to snapshot release state with pending migrations: ${pending.join(", ")}`);
  }

  const snapshot = {
    captured_at: new Date().toISOString(),
    base_url: baseUrl,
    release: {
      version: info.version || null,
      build_sha: buildSha || info.build_sha || null,
      image_ref: imageRef || null,
      release_tag: releaseTag || null
    },
    health,
    ready,
    info,
    migrations: {
      applied_count: applied.length,
      applied_versions: applied.map((entry) => entry.version),
      pending_versions: pending
    }
  };

  const resolvedOutput = outputPath
    || path.join(process.cwd(), "artifacts", "releases", `release_snapshot_${nowStamp()}.json`);
  ensureDir(path.dirname(resolvedOutput));
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.writeFileSync(resolvedOutput, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return { snapshot, outputPath: resolvedOutput };
}

async function main() {
  const baseUrl = cliArg("--base-url", process.env.SNAPSHOT_BASE_URL || "http://localhost:3001");
  const outputPath = cliArg("--output", "");
  const timeoutMs = Number(cliArg("--timeout-ms", process.env.SNAPSHOT_TIMEOUT_MS || "5000"));
  const imageRef = cliArg("--image-ref", process.env.RELEASE_IMAGE_REF || "");
  const buildSha = cliArg("--build-sha", process.env.RELEASE_SHA || process.env.GITHUB_SHA || "");
  const releaseTag = cliArg("--release-tag", process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || "");
  const allowPendingMigrations = hasFlag("--allow-pending-migrations");

  try {
    const result = await captureReleaseSnapshot({
      baseUrl,
      outputPath,
      timeoutMs,
      imageRef,
      buildSha,
      releaseTag,
      allowPendingMigrations
    });
    console.log(`Release snapshot written to ${path.relative(process.cwd(), result.outputPath)}`);
  } finally {
    const { closeDatabase } = await loadDatabaseModule();
    await closeDatabase().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`Release snapshot: FAIL: ${error?.message || error}`);
    process.exit(1);
  });
}
