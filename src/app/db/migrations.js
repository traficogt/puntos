import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { pool, migrationPool } from "./pools.js";

async function checkSchemaExtensions() {
  try {
    const hasExtensions = async () => {
      const result = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'loyalty_tiers'
        );
      `);
      return Boolean(result.rows?.[0]?.exists);
    };

    if (await hasExtensions()) {
      logger.info("✅ Schema extensions detected (v1.3.0+ features available)");
      return;
    }

    logger.warn("⚠️  Schema extensions not applied (loyalty_tiers missing).");
    if (!config.AUTO_APPLY_SCHEMA_EXTENSIONS) {
      logger.warn("⚠️  AUTO_APPLY_SCHEMA_EXTENSIONS=false, skipping auto-migration.");
      logger.warn("⚠️  Run: psql -U loyalty -d puntos -f app/schema-extensions.sql");
      return;
    }

    logger.info("Applying schema extensions automatically...");
    await applySchemaExtensions();

    if (await hasExtensions()) {
      logger.info("✅ Schema extensions applied and verified.");
    } else {
      logger.warn("⚠️  Schema extension auto-apply finished but verification failed.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Could not check schema extensions: ${message}`);
  }
}

async function ensureMigrationTable() {
  await migrationPool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      execution_ms INT NOT NULL DEFAULT 0
    )
  `);
}

function migrationChecksum(sql) {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

async function enforceNonSuperRuntime() {
  const { rows } = await pool.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
  const isSuper = rows[0]?.rolsuper === true;
  if (isSuper) {
    if (config.NODE_ENV === "test") {
      logger.warn("DB_USER is SUPERUSER (test env) — allow for e2e but do not use in prod.");
    } else {
      throw new Error("DB_USER must not be SUPERUSER; configure a least-privileged runtime role");
    }
  }
  if (config.DB_USER === (config.DB_MIGRATIONS_USER || config.DB_USER)) {
    logger.warn("DB_USER matches DB_MIGRATIONS_USER; consider separating runtime and migrations users.");
  }
}

export async function initDatabase() {
  const schemaPath = path.join(process.cwd(), "src", "app", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");

  await enforceNonSuperRuntime();

  logger.info("Initializing database schema (if needed)...");
  await migrationPool.query(sql);
  logger.info("Database ready.");

  await checkSchemaExtensions();

  if (config.AUTO_APPLY_MIGRATIONS) {
    await runManagedMigrations();
  } else {
    logger.info("AUTO_APPLY_MIGRATIONS=false, skipping managed migrations.");
  }
}

export async function applySchemaExtensions() {
  const extensionsPath = path.join(process.cwd(), "src", "app", "schema-extensions.sql");
  if (!fs.existsSync(extensionsPath)) {
    logger.warn("schema-extensions.sql not found. Skipping.");
    return;
  }

  const sql = fs.readFileSync(extensionsPath, "utf-8");
  logger.info("Applying schema extensions (v1.3.0+ features)...");
  logger.warn("⚠️  This will modify the database schema!");

  try {
    await migrationPool.query(sql);
    logger.info("✅ Schema extensions applied successfully");
    logger.info("✅ Tiers, referrals, gamification, and analytics features are now available");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`❌ Failed to apply schema extensions: ${message}`);
    throw error;
  }
}

export async function runManagedMigrations() {
  await ensureMigrationTable();
  const migrationsDir = path.join(process.cwd(), "src", "app", "migrations");

  if (!fs.existsSync(migrationsDir)) {
    logger.info("No app/migrations directory found; skipping managed migrations.");
    return;
  }

  const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  if (!files.length) {
    logger.info("No managed migrations to apply.");
    return;
  }

  let appliedCount = 0;
  for (const file of files) {
    const version = file;
    const migrationPath = path.join(migrationsDir, file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const sql = fs.readFileSync(migrationPath, "utf-8");
    const checksum = migrationChecksum(sql);
    const existing = await migrationPool.query(
      "SELECT checksum FROM schema_migrations WHERE version = $1",
      [version]
    );

    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(
          `Migration checksum mismatch for ${version}. Create a new migration instead of editing an applied one.`
        );
      }
      continue;
    }

    const startedAt = Date.now();
    const client = await migrationPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version, checksum, execution_ms) VALUES ($1, $2, $3)",
        [version, checksum, Date.now() - startedAt]
      );
      await client.query("COMMIT");
      appliedCount += 1;
      logger.info({ version }, "Applied migration");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  if (appliedCount === 0) {
    logger.info("Managed migrations already up to date.");
    return;
  }
  logger.info({ appliedCount }, "Managed migrations completed");
}

export async function listManagedMigrations() {
  await ensureMigrationTable();
  const rows = await migrationPool.query(
    "SELECT version, checksum, applied_at, execution_ms FROM schema_migrations ORDER BY version ASC"
  );
  return rows.rows;
}
