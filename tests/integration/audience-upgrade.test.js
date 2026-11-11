import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.AUDIENCE_UPGRADE_TEST_DB_URL;
test("full-schema audience upgrade preserves legacy analytics segments and assignments", { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  assert.equal(url.pathname, "/audience_upgrade_test");
  const db = new pg.Pool({ connectionString: databaseUrl });
  const file = async name => {
    // Fixed repository schema/migration paths, never request values.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return readFile(new URL(name, import.meta.url), "utf8");
  };
  try {
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS app");
    await db.query("CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_tenant',true),'')::uuid $$; CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.platform_admin',true),'')='true' $$");
    for (const name of ["../../src/app/schema.sql", "../../src/app/schema-extensions.sql", "../../src/app/migrations/2026-11-10-customer-recovery.sql", "../../src/app/migrations/2026-11-10-growth-campaigns.sql", "../../src/app/migrations/2026-11-10-growth-messaging.sql", "../../src/app/migrations/2026-11-10-growth-limits.sql"])
      await db.query(await file(name));
    const businessId = randomUUID(), customerId = randomUUID(), legacyId = randomUUID(), staffId = randomUUID();
    await db.query("INSERT INTO businesses(id,name,slug,email,password_hash,plan) VALUES($1,'Fixture','upgrade-fixture','upgrade@example.invalid','unused','NEGOCIO')", [businessId]);
    await db.query("INSERT INTO staff_users(id,business_id,name,email,password_hash,role) VALUES($1,$2,'Owner','owner@example.invalid','unused','OWNER')", [staffId, businessId]);
    await db.query("INSERT INTO customers(id,business_id,name,phone) VALUES($1,$2,'Existing','50255554444')", [customerId, businessId]);
    await db.query("INSERT INTO customer_segments(id,business_id,name,criteria,segment_type) VALUES($1,$2,'Existing RFM','{\"legacy\":true}','rfm')", [legacyId, businessId]);
    await db.query("INSERT INTO customer_segment_assignments(customer_id,segment_id) VALUES($1,$2)", [customerId, legacyId]);
    const migration = await file("../../src/app/migrations/2026-11-10-reusable-audiences.sql");
    await db.query(migration);
    const { createCustomerSegment, listCustomerSegments, previewCustomerAudience } = await import("../../src/app/services/customer-audience-service.js");
    const deps = { query: db.query.bind(db), audit: async () => {}, getPlanFeatureOverrides: async () => ({}), transaction: async fn => {
      const client = await db.connect();
      try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
      catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } };
    const definition = { window_days: 90, include: { match: "all", rules: [{ field: "has_purchase", operator: "eq", value: false }] }, exclude: { match: "any", rules: [] } };
    const created = await createCustomerSegment({ businessId, staffId, requestId: randomUUID(), name: "Reusable", definition }, deps);
    await db.query(migration);
    assert.equal((await listCustomerSegments({ businessId }, deps)).segments[0].id, created.segment.id);
    const old = (await db.query("SELECT s.name,s.criteria,a.customer_id FROM customer_segments s JOIN customer_segment_assignments a ON a.segment_id=s.id WHERE s.id=$1", [legacyId])).rows[0];
    assert.deepEqual(old, { name: "Existing RFM", criteria: { legacy: true }, customer_id: customerId });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_segments' AND column_name='definition'")).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM merchant_audiences")).rows[0].n, 1);
    assert.equal((await previewCustomerAudience({ businessId, definition }, deps)).total, 1);
  } finally { await db.end(); }
});
