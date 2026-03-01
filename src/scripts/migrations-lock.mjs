#!/usr/bin/env node
/**
 * Enforces immutable managed SQL migrations by pinning file checksums in-repo.
 *
 * - Check mode (default): compares current checksums to src/app/migrations/checksums.json
 * - Write mode (--write): regenerates the lock file (use when adding a NEW migration)
 *
 * This prevents accidental edits to previously-applied migrations which would otherwise
 * surface as runtime checksum mismatches in schema_migrations.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");

const migrationsDir = path.join(process.cwd(), "src", "app", "migrations");
const lockPath = path.join(migrationsDir, "checksums.json");

function sha256File(filePath) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sql = fs.readFileSync(filePath, "utf-8");
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

function listMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function stableJson(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

function diffLock(expected, actual) {
  const out = [];
  const allKeys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const keys = Array.from(allKeys).sort();
  for (const k of keys) {
    if (!(k in expected)) out.push({ type: "extra_file", file: k, checksum: actual[k] });
    else if (!(k in actual)) out.push({ type: "missing_file", file: k, checksum: expected[k] });
    else if (expected[k] !== actual[k]) out.push({ type: "checksum_mismatch", file: k, expected: expected[k], actual: actual[k] });
  }
  return out;
}

async function main() {
  const files = listMigrationFiles();
  const computed = {};
  for (const f of files) {
    const p = path.join(migrationsDir, f);
    computed[f] = sha256File(p);
  }

  const lockPayload = {
    generated_at: new Date().toISOString(),
    files: computed
  };

  if (write) {
    fs.writeFileSync(lockPath, stableJson(lockPayload), "utf-8");
    console.log(`Migrations lock written: ${lockPath}`);
    return;
  }

  if (!fs.existsSync(lockPath)) {
    console.error(`Missing migrations lock file: ${lockPath}`);
    console.error("Run: npm run ops:migrate:lock");
    process.exitCode = 1;
    return;
  }

  const existing = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
  const existingFiles = existing?.files && typeof existing.files === "object" ? existing.files : {};

  const diffs = diffLock(existingFiles, computed);
  if (!diffs.length) {
    console.log("Migrations lock: OK");
    return;
  }

  console.error(`Migrations lock: FAIL (${diffs.length} difference(s))`);
  for (const d of diffs) {
    if (d.type === "checksum_mismatch") {
      console.error(`- CHECKSUM ${d.file}`);
      console.error(`  expected ${d.expected}`);
      console.error(`  actual   ${d.actual}`);
    } else if (d.type === "missing_file") {
      console.error(`- MISSING FILE ${d.file}`);
    } else if (d.type === "extra_file") {
      console.error(`- UNLOCKED FILE ${d.file}`);
    }
  }
  console.error("If you added a NEW migration, run: npm run ops:migrate:lock");
  console.error("If you edited an existing migration, revert it and create a new migration instead.");
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
