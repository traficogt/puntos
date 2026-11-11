/* eslint-disable security/detect-non-literal-fs-filename -- Reads only repository schema and ordered migration files. */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { orderMigrations } from "../../src/app/db/migration-order.js";

const databaseUrl = process.env.RLS_CHECK_TEST_DATABASE_URL;

test("RLS smoke completes the full migrated balance-trigger chain and rolls back its fixtures and grants", { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl);
  assert.equal(process.env.NODE_ENV, "test");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/rls_check_test(?:_[a-z0-9_]+)?$/);

  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  const name = `rls_check_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  try {
    await client.connect();
    for (const file of ["schema.sql", "schema-extensions.sql"]) {
      await client.query(await readFile(new URL(`../../src/app/${file}`, import.meta.url), "utf8"));
    }
    const directory = new URL("../../src/app/migrations/", import.meta.url);
    for (const file of orderMigrations((await readdir(directory)).filter((entry) => entry.endsWith(".sql")))) {
      await client.query("BEGIN");
      try {
        await client.query(await readFile(new URL(file, directory), "utf8"));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
      }
    }

    const snapshotSql = `SELECT
      (SELECT count(*)::int FROM businesses) AS businesses,
      (SELECT count(*)::int FROM customers) AS customers,
      (SELECT count(*)::int FROM customer_balances) AS balances,
      (SELECT count(*)::int FROM pg_roles WHERE rolname='rls_smoke') AS smoke_roles`;
    const before = (await client.query(snapshotSql)).rows[0];
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../src/scripts/rls-check.mjs", import.meta.url))], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        ...process.env,
        DB_HOST: url.hostname,
        DB_PORT: url.port || "5432",
        DB_NAME: name,
        DB_USER: decodeURIComponent(url.username),
        DB_PASSWORD: decodeURIComponent(url.password),
        DB_MIGRATIONS_USER: decodeURIComponent(url.username),
        DB_MIGRATIONS_PASSWORD: decodeURIComponent(url.password)
      },
      encoding: "utf8",
      timeout: 30000
    });
    assert.deepEqual((await client.query(snapshotSql)).rows[0], before, "The smoke check must not leave fixture rows or role grants behind");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /RLS check: PASS \(strict tenant isolation \+ platform admin access\)/);
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE ${pg.escapeIdentifier(name)}`);
    await admin.end();
  }
});
