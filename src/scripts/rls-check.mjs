#!/usr/bin/env node
/**
 * Smoke-check tenant RLS policies.
 * Creates temporary rows inside a transaction, asserts row filtering, then rolls back.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const {
  DB_HOST = "localhost",
  DB_PORT = 5432,
  DB_NAME = "puntos",
  DB_USER = "postgres",
  DB_PASSWORD = "postgres",
  DB_MIGRATIONS_USER,
  DB_MIGRATIONS_PASSWORD
} = process.env;

const client = new pg.Client({
  host: DB_HOST,
  port: Number(DB_PORT),
  database: DB_NAME,
  user: DB_MIGRATIONS_USER || DB_USER,
  password: DB_MIGRATIONS_PASSWORD || DB_PASSWORD
});

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

async function main() {
  await client.connect();
  await client.query("BEGIN");
  try {
    // Ensure a non-super, non-bypass role exists for the check.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_smoke') THEN
          CREATE ROLE rls_smoke;
          GRANT USAGE ON SCHEMA public TO rls_smoke;
          GRANT INSERT, SELECT ON ALL TABLES IN SCHEMA public TO rls_smoke;
        END IF;
      END$$;
    `);
    await client.query("SET LOCAL ROLE rls_smoke");

    const b1 = randomUUID();
    const b2 = randomUUID();
    const c1 = randomUUID();
    const c2 = randomUUID();

    // Seed under platform-admin mode (simulates trusted internal worker/super admin).
    await client.query("SELECT set_config('app.platform_admin', 'true', true)");

    const baseline = await client.query("SELECT count(*)::int AS c FROM customers");
    const baselineCount = baseline.rows[0].c;

    await client.query(
      `INSERT INTO businesses (id, name, slug, email, password_hash) VALUES
       ($1,'Biz1',$3,$5,'hash1'),
       ($2,'Biz2',$4,$6,'hash2')`,
      [b1, b2, `biz-${b1.slice(0, 6)}`, `biz-${b2.slice(0, 6)}`, `${b1}@x.test`, `${b2}@x.test`]
    );

    await client.query(
      `INSERT INTO customers (id, business_id, phone) VALUES
       ($1, $3, '+50211111111'),
       ($2, $4, '+50222222222')`,
      [c1, c2, b1, b2]
    );

    await client.query(
      `INSERT INTO customer_balances (customer_id, points) VALUES
       ($1, 10),
       ($2, 20)`,
      [c1, c2]
    );

    // Drop platform mode; strict RLS should hide everything until tenant is set.
    await client.query("SELECT set_config('app.platform_admin', '', true)");
    await client.query("SELECT set_config('app.current_tenant', '', true)");

    const none = await client.query("SELECT count(*)::int AS c FROM customers");
    assertEqual(none.rows[0].c, 0, "Strict RLS should hide tenant rows when no tenant is set");

    // Tenant-scoped view
    await client.query(`SELECT set_config('app.current_tenant', '${b1}', true)`);
    const { rows: ctRows } = await client.query("SELECT current_setting('app.current_tenant', true) AS ct");
    assertEqual(ctRows[0].ct, b1, "app.current_tenant GUC should be set");
    const onlyB1 = await client.query("SELECT count(*)::int AS c FROM customers");
    assertEqual(onlyB1.rows[0].c, 1, "RLS should restrict customers to current tenant");
    const balB1 = await client.query("SELECT count(*)::int AS c FROM customer_balances");
    assertEqual(balB1.rows[0].c, 1, "Derived-tenant RLS should restrict customer_balances to current tenant");

    // Platform-admin global view
    await client.query("SELECT set_config('app.current_tenant', '', true)");
    await client.query("SELECT set_config('app.platform_admin', 'true', true)");
    const allTenants = await client.query("SELECT count(*)::int AS c FROM customers");
    assertEqual(allTenants.rows[0].c, baselineCount + 2, "Platform admin should see all tenants");

    console.log("RLS check: PASS (strict tenant isolation + platform admin access)");
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

main().catch((err) => {
  console.error("RLS check: FAIL", err.message || err);
  process.exit(1);
});
