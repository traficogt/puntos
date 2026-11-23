import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../../src/config/index.js";
import { pool, migrationPool } from "../../src/app/db/pools.js";
import {
  SCHEMA_LOCK_KEY,
  initDatabase,
  runManagedMigrations,
  withSchemaLock,
} from "../../src/app/db/migrations.js";

const LOCK_SQL = "SELECT pg_advisory_lock($1::bigint)";
const UNLOCK_SQL = "SELECT pg_advisory_unlock($1::bigint)";
const migrationsDir = path.join(process.cwd(), "src", "app", "migrations");

const originals = {
  poolQuery: pool.query,
  migrationConnect: migrationPool.connect,
  migrationQuery: migrationPool.query,
  autoApply: config.AUTO_APPLY_MIGRATIONS,
};
afterEach(() => {
  pool.query = originals.poolQuery;
  migrationPool.connect = originals.migrationConnect;
  migrationPool.query = originals.migrationQuery;
  config.AUTO_APPLY_MIGRATIONS = originals.autoApply;
});

/**
 * One chronological event log across the dedicated lock connection, the
 * migration pool and the runtime pool, so ordering can be asserted directly.
 * @param {{ lockClientQuery?: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} [options]
 */
function fixture({ lockClientQuery = async () => ({ rows: [] }) } = {}) {
  const events = [];
  const releases = [];
  let connects = 0;
  const lockClient = {
    async query(sql, params) {
      events.push({ via: "lock-client", sql, params });
      return lockClientQuery(sql, params);
    },
    release(destroy) {
      releases.push(Boolean(destroy));
      events.push({ via: "lock-client", release: Boolean(destroy) });
    },
  };
  migrationPool.connect = /** @type {any} */ (
    async () => {
      connects += 1;
      return lockClient;
    }
  );
  migrationPool.query = /** @type {any} */ (
    async (sql, params) => {
      events.push({ via: "migration-pool", sql, params });
      if (sql.startsWith("SELECT checksum FROM schema_migrations")) {
        // Every migration on disk reports as applied with its current checksum.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const body = fs.readFileSync(path.join(migrationsDir, params[0]), "utf-8");
        const checksum = crypto.createHash("sha256").update(body, "utf8").digest("hex");
        return { rows: [{ checksum }] };
      }
      return { rows: [] };
    }
  );
  pool.query = /** @type {any} */ (
    async (sql) => {
      events.push({ via: "pool", sql });
      if (sql.includes("rolsuper")) return { rows: [{ rolsuper: false }] };
      if (sql.includes("information_schema.tables")) return { rows: [{ exists: true }] };
      return { rows: [] };
    }
  );
  const lockSql = () => events.filter((e) => e.via === "lock-client" && e.sql).map((e) => e.sql);
  const indexOf = (predicate) => events.findIndex(predicate);
  return { events, releases, lockSql, indexOf, connects: () => connects };
}

test("withSchemaLock holds the advisory lock on one dedicated connection around fn", async () => {
  const f = fixture();
  const result = await withSchemaLock(async () => {
    f.events.push({ via: "fn" });
    return "done";
  });
  assert.equal(result, "done");
  assert.deepEqual(f.lockSql(), [LOCK_SQL, UNLOCK_SQL]);
  const lockAt = f.indexOf((e) => e.sql === LOCK_SQL);
  const fnAt = f.indexOf((e) => e.via === "fn");
  const unlockAt = f.indexOf((e) => e.sql === UNLOCK_SQL);
  assert.ok(lockAt < fnAt && fnAt < unlockAt, "fn runs strictly inside the lock window");
  const lockEvents = f.events.filter((e) => e.sql === LOCK_SQL || e.sql === UNLOCK_SQL);
  assert.deepEqual(
    lockEvents.map((e) => e.params),
    [[SCHEMA_LOCK_KEY], [SCHEMA_LOCK_KEY]],
    "lock and unlock use the same fixed key",
  );
  assert.equal(f.connects(), 1);
  assert.deepEqual(f.releases, [false]);
  assert.equal(f.events.at(-1).release, false, "the connection is released last");
});

test("a failing critical section still unlocks and returns the connection to the pool", async () => {
  const f = fixture();
  const failure = new Error("fixture schema failure");
  await assert.rejects(
    withSchemaLock(async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(f.lockSql(), [LOCK_SQL, UNLOCK_SQL]);
  assert.deepEqual(f.releases, [false]);
});

test("a failed unlock discards the connection so the session lock dies with it", async () => {
  const f = fixture({
    lockClientQuery: async (sql) => {
      if (sql === UNLOCK_SQL) throw new Error("fixture connection lost");
      return { rows: [] };
    },
  });
  assert.equal(await withSchemaLock(async () => "ok"), "ok");
  assert.deepEqual(f.releases, [true]);
});

test("a failed lock acquisition never runs fn, discards the connection and propagates", async () => {
  const lockError = new Error("fixture lock failure");
  const f = fixture({
    lockClientQuery: async (sql) => {
      if (sql === LOCK_SQL) throw lockError;
      return { rows: [] };
    },
  });
  let ran = false;
  await assert.rejects(
    withSchemaLock(async () => {
      ran = true;
    }),
    (error) => error === lockError,
  );
  assert.equal(ran, false);
  assert.deepEqual(f.lockSql(), [LOCK_SQL], "no unlock is attempted for a lock never held");
  assert.deepEqual(f.releases, [true]);
});

test("initDatabase runs schema.sql and the managed migration scan inside one lock window", async () => {
  config.AUTO_APPLY_MIGRATIONS = true;
  const f = fixture();
  await initDatabase();

  const lockAt = f.indexOf((e) => e.sql === LOCK_SQL);
  const unlockAt = f.indexOf((e) => e.sql === UNLOCK_SQL);
  const schemaAt = f.indexOf(
    (e) => e.via === "migration-pool" && e.sql.includes("CREATE TABLE IF NOT EXISTS businesses"),
  );
  const migrationTableAt = f.indexOf(
    (e) =>
      e.via === "migration-pool" && e.sql.includes("CREATE TABLE IF NOT EXISTS schema_migrations"),
  );
  assert.ok(lockAt !== -1 && unlockAt !== -1, "the lock is taken and released");
  assert.ok(lockAt < schemaAt, "schema.sql executes after the lock is held");
  assert.ok(schemaAt < migrationTableAt, "managed migrations follow schema.sql");
  assert.ok(migrationTableAt < unlockAt, "the lock outlives the migration scan");

  const scans = f.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.sql?.startsWith("SELECT checksum FROM schema_migrations"));
  assert.ok(scans.length > 0, "every migration on disk is checked");
  assert.ok(
    scans.every(({ index }) => index > lockAt && index < unlockAt),
    "no migration is inspected outside the lock window",
  );
  assert.equal(f.connects(), 1, "with nothing pending the lock holder is the only connection");
  assert.deepEqual(f.releases, [false]);
  assert.equal(f.events.at(-1).release, false);
});

test("initDatabase still locks around schema.sql when managed migrations are disabled", async () => {
  config.AUTO_APPLY_MIGRATIONS = false;
  const f = fixture();
  await initDatabase();
  const lockAt = f.indexOf((e) => e.sql === LOCK_SQL);
  const unlockAt = f.indexOf((e) => e.sql === UNLOCK_SQL);
  const schemaAt = f.indexOf(
    (e) => e.via === "migration-pool" && e.sql.includes("CREATE TABLE IF NOT EXISTS businesses"),
  );
  assert.ok(lockAt < schemaAt && schemaAt < unlockAt);
  assert.equal(
    f.indexOf((e) => e.sql?.startsWith("SELECT checksum FROM schema_migrations")),
    -1,
    "AUTO_APPLY_MIGRATIONS=false keeps skipping the migration scan",
  );
  assert.deepEqual(f.releases, [false]);
});

test("runManagedMigrations (the CLI path) takes the same lock around the migration scan", async () => {
  const f = fixture();
  await runManagedMigrations();
  assert.equal(f.lockSql()[0], LOCK_SQL);
  assert.equal(f.lockSql().at(-1), UNLOCK_SQL);
  const lockAt = f.indexOf((e) => e.sql === LOCK_SQL);
  const unlockAt = f.indexOf((e) => e.sql === UNLOCK_SQL);
  const migrationTableAt = f.indexOf(
    (e) =>
      e.via === "migration-pool" && e.sql.includes("CREATE TABLE IF NOT EXISTS schema_migrations"),
  );
  assert.ok(lockAt < migrationTableAt && migrationTableAt < unlockAt);
  assert.equal(f.connects(), 1);
  assert.deepEqual(f.releases, [false]);
});
