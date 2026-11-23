import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, after, it, describe } from "node:test";
import pg from "pg";
import { recordPosMeasurementReceipts } from "../../src/app/services/pos-measurement-receipts.js";

const url = process.env.PURCHASE_EVENT_TIME_TEST_DB_URL;
const suite = url ? describe : describe.skip;
suite("purchase time and observed receipt evidence in disposable PostgreSQL", () => {
  let db;
  const tenant = randomUUID(),
    other = randomUUID(),
    transaction = randomUUID(),
    foreign = randomUUID();
  before(async () => {
    const target = new URL(url);
    assert.equal(target.hostname, "127.0.0.1");
    assert.ok(
      target.port && target.port !== "5432",
      "Use an explicit non-default PostgreSQL port for the disposable test database",
    );
    assert.equal(target.pathname, "/measurement_ingestion_test");
    db = new pg.Client({ connectionString: url });
    await db.connect();
    await db.query(`DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public; CREATE SCHEMA app;
      CREATE TABLE businesses(id uuid PRIMARY KEY);
      CREATE TABLE transactions(id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),customer_id uuid,created_at timestamptz DEFAULT now(),status text DEFAULT 'POSTED');
      CREATE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('app.tenant_id',true),'')::uuid$$;
      CREATE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
      DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='loyalty_app') THEN CREATE ROLE loyalty_app; END IF; END$$;
      GRANT USAGE ON SCHEMA public,app TO loyalty_app;
      GRANT SELECT,INSERT,UPDATE ON transactions TO loyalty_app;`);
    await db.query(
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await readFile(
        new URL("../../src/app/migrations/2026-11-14-a-purchase-event-time.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.query("INSERT INTO businesses VALUES($1),($2)", [tenant, other]);
    await db.query(
      `INSERT INTO transactions(id,business_id,purchase_occurred_at,purchase_time_source) VALUES($1,$2,'2026-01-01T12:00:00Z','pos_receipt'),($3,$4,NULL,NULL)`,
      [transaction, tenant, foreign, other],
    );
    await db.query("SET ROLE loyalty_app");
    await db.query("SELECT set_config('app.tenant_id',$1,false)", [tenant]);
  });
  after(async () => {
    await db?.end();
  });

  it("preserves created_at and event provenance while permitting normal ledger reversals", async () => {
    const before = (await db.query("SELECT * FROM transactions WHERE id=$1", [transaction]))
      .rows[0];
    for (const patch of [
      "created_at=created_at-interval '1 day'",
      "purchase_occurred_at='2026-01-02T12:00:00Z'",
      "purchase_time_source='client_reported'",
    ]) {
      await assert.rejects(
        db.query(`UPDATE transactions SET ${patch} WHERE id=$1`, [transaction]),
        { code: "23514" },
      );
    }
    await db.query("UPDATE transactions SET status='REVERSED' WHERE id=$1", [transaction]);
    const after = (await db.query("SELECT * FROM transactions WHERE id=$1", [transaction])).rows[0];
    assert.equal(after.created_at.toISOString(), before.created_at.toISOString());
    assert.equal(after.purchase_occurred_at.toISOString(), "2026-01-01T12:00:00.000Z");
    assert.equal(after.status, "REVERSED");
    await assert.rejects(
      db.query(
        "INSERT INTO transactions(id,business_id,purchase_occurred_at) VALUES($1,$2,now())",
        [randomUUID(), tenant],
      ),
      { code: "23514" },
    );
  });

  it("keeps an observed receipt once, settles a later match, and does not regress after rejected retries", async () => {
    const query = db.query.bind(db);
    const receipt = {
      source: "register",
      saleId: "sale-1",
      occurredAt: "2026-01-01T12:00:00.000Z",
      status: "unmatched",
      transactionId: null,
    };
    await recordPosMeasurementReceipts(tenant, [receipt, receipt], query);
    const first = (await query("SELECT * FROM pos_measurement_receipts")).rows[0];
    await recordPosMeasurementReceipts(
      tenant,
      [{ ...receipt, status: "matched", transactionId: transaction }],
      query,
    );
    await recordPosMeasurementReceipts(
      tenant,
      [{ ...receipt, status: "rejected", occurredAt: "2026-01-02T12:00:00Z" }],
      query,
    );
    const rows = (await query("SELECT * FROM pos_measurement_receipts")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "matched");
    assert.equal(rows[0].transaction_id, transaction);
    assert.equal(rows[0].first_seen_at.toISOString(), first.first_seen_at.toISOString());
    assert.equal(rows[0].occurred_at.toISOString(), first.occurred_at.toISOString());
    await assert.rejects(query("UPDATE pos_measurement_receipts SET status='unmatched'"), {
      code: "23514",
    });
  });

  it("enforces tenant RLS and prevents a receipt from linking another business transaction", async () => {
    const query = db.query.bind(db);
    const privileges = (
      await query(
        "SELECT has_table_privilege(current_user,'pos_measurement_receipts','DELETE') AS can_delete,has_function_privilege(current_user,'app.protect_purchase_event_time()','EXECUTE') AS can_call_guard",
      )
    ).rows[0];
    assert.equal(privileges.can_delete, false);
    assert.equal(privileges.can_call_guard, false);
    await assert.rejects(
      recordPosMeasurementReceipts(
        tenant,
        [{ source: "register", saleId: "foreign-link", status: "matched", transactionId: foreign }],
        query,
      ),
      { code: "23514" },
    );
    await assert.rejects(
      recordPosMeasurementReceipts(
        other,
        [{ source: "register", saleId: "foreign-write", status: "unmatched" }],
        query,
      ),
      { code: "42501" },
    );
    await query("SELECT set_config('app.tenant_id',$1,false)", [other]);
    assert.equal(
      (await query("SELECT count(*)::int AS n FROM pos_measurement_receipts")).rows[0].n,
      0,
    );
  });
});
