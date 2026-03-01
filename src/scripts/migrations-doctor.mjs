#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { closeDatabase, listManagedMigrations } from "../app/database.js";
import { pool } from "../app/database.js";

const args = new Set(process.argv.slice(2));
const wantRepair = args.has("--repair");

const migrationsDir = path.join(process.cwd(), "src", "app", "migrations");

function checksumFile(filePath) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sql = fs.readFileSync(filePath, "utf-8");
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

async function main() {
  const applied = await listManagedMigrations();
  const appliedByVersion = new Map(applied.map((m) => [m.version, m.checksum]));

  const mismatches = [];
  const missing = [];

  for (const [version, dbChecksum] of appliedByVersion.entries()) {
    const filePath = path.join(migrationsDir, version);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(filePath)) {
      missing.push(version);
      continue;
    }
    const localChecksum = checksumFile(filePath);
    if (localChecksum !== dbChecksum) {
      mismatches.push({ version, dbChecksum, localChecksum });
    }
  }

  if (!missing.length && !mismatches.length) {
    console.log("Migrations doctor: OK (no missing files, no checksum mismatches)");
    return;
  }

  if (missing.length) {
    console.error(`Migrations doctor: missing ${missing.length} applied migration file(s):`);
    for (const v of missing) console.error(`- ${v}`);
  }
  if (mismatches.length) {
    console.error(`Migrations doctor: checksum mismatch for ${mismatches.length} migration(s):`);
    for (const m of mismatches) {
      console.error(`- ${m.version}`);
      console.error(`  db    ${m.dbChecksum}`);
      console.error(`  local ${m.localChecksum}`);
    }
  }

  if (!wantRepair) {
    console.error("Tip: run with --repair (dev/test only) to sync DB checksums to local files.");
    process.exitCode = 1;
    return;
  }

  const nodeEnv = process.env.NODE_ENV ?? "production";
  const allowProd = (process.env.ALLOW_PROD_MIGRATION_REPAIR ?? "false") === "true";
  const ok = (process.env.MIGRATION_REPAIR_OK ?? "false") === "true";

  if (!ok) {
    console.error("Refusing to repair: set MIGRATION_REPAIR_OK=true to proceed.");
    process.exitCode = 2;
    return;
  }
  if (nodeEnv === "production" && !allowProd) {
    console.error("Refusing to repair in production. Restore the original migration files instead.");
    process.exitCode = 2;
    return;
  }

  for (const m of mismatches) {
    await pool.query(
      "UPDATE schema_migrations SET checksum = $3 WHERE version = $1 AND checksum = $2",
      [m.version, m.dbChecksum, m.localChecksum]
    );
  }
  console.log(`Migrations doctor: repaired ${mismatches.length} checksum mismatch(es).`);
}

main()
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  })
  .finally(() => closeDatabase().catch(() => {}));
