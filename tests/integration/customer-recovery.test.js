import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, beforeEach, after, describe, it } from "node:test";
import pg from "pg";

const databaseUrl = process.env.CUSTOMER_RECOVERY_TEST_DB_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;
const businessId = randomUUID();
const otherBusiness = randomUUID();
const staffId = randomUUID();
const customerA = randomUUID();
const customerB = randomUUID();
const otherCustomer = randomUUID();
const now = new Date("2026-11-10T18:00:00.000Z");
const manualReadiness = {
  state: "recorded_only",
  source: "manual",
  inactivity_allowed: true,
  reason: null,
  last_completed_at: null,
  checked_at: now.toISOString(),
  summary: "El análisis usa únicamente las compras registradas en PF. Este método no tiene un plazo automático de sincronización.",
  action: { label: "Revisar conexión de caja", href: "#conectar-caja" }
};
const daysAgo = days => new Date(now.getTime() - days * 86400000).toISOString();
let db;
let recovery;
let auditEvents;
let deps;

integrationDescribe("customer recovery against disposable PostgreSQL", () => {
  before(async () => {
    const url = new URL(databaseUrl);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Use a disposable local PostgreSQL instance");
    assert.equal(url.pathname, "/customer_recovery_test", "Dedicated test database required");
    db = new pg.Pool({ connectionString: databaseUrl });
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    // Both fixture and migration paths are fixed; no user input reaches them.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await db.query(await readFile(new URL("../fixtures/customer-recovery.sql", import.meta.url), "utf8"));
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await db.query(await readFile(new URL("../../src/app/migrations/2026-11-10-customer-recovery.sql", import.meta.url), "utf8"));
    recovery = await import("../../src/app/services/customer-recovery-service.js");
    deps = {
      query: db.query.bind(db),
      transaction: async fn => {
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(client);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally { client.release(); }
      },
      audit: async event => { auditEvents.push(event); }
    };
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    auditEvents = [];
    await db.query("TRUNCATE businesses, staff_users, customers, transactions CASCADE");
    await db.query("INSERT INTO businesses VALUES ($1),($2)", [businessId, otherBusiness]);
    await db.query("INSERT INTO staff_users VALUES ($1,$2)", [staffId, businessId]);
    await db.query("INSERT INTO customers VALUES ($1,$2,'Ana','50255550001',NULL),($3,$2,'Beto','50255550002',NULL),($4,$5,'Other','50255550003',NULL)", [customerA, businessId, customerB, otherCustomer, otherBusiness]);
  });
  async function purchase(values = {}) {
    const tx = { id: randomUUID(), businessId, customerId: customerA, amount: 10, points: 0, visits: 0, items: 0, type: "PURCHASE", source: "online", status: "POSTED", at: daysAgo(40), original: null, reversed: null, ...values };
    await db.query(`INSERT INTO transactions (id,business_id,customer_id,amount_q,points,type,source,status,created_at,original_transaction_id,reversed_transaction_id,visits,items)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [tx.id, tx.businessId, tx.customerId, tx.amount, tx.points, tx.type, tx.source, tx.status, tx.at, tx.original, tx.reversed, tx.visits, tx.items]);
    return tx.id;
  }
  function audience(options = {}) {
    assert.equal(typeof recovery.getRecoveryAudience, "function", "Recovery audience service must exist");
    return recovery.getRecoveryAudience({ businessId, inactiveDays: 30, now, ...options }, deps);
  }
  function create(options = {}, dependencies = deps) {
    return recovery.createRecoveryRun({ businessId, staffId, requestId: randomUUID(), name: "Volver", notes: "", inactiveDays: 30, limit: 50, now, ...options }, dependencies);
  }
  function details(runId, options = {}) {
    return recovery.getRecoveryRun({ businessId, runId, now, ...options }, deps);
  }
  function update(runId, customerId, options = {}) {
    return recovery.updateRecoveryMember({ businessId, staffId, runId, customerId, status: "contacted", contactConfirmed: true, ...options }, deps);
  }

  it("selects active customers using genuine purchase activity, excluding reversals, future rows and other tenants", async () => {
    await purchase({ amount: 100 });
    await purchase({ amount: 50, source: "offline", status: "PENDING" });
    await purchase({ amount: 25, source: "external" });
    await purchase({ amount: 10, source: "order", type: null });
    await purchase({ amount: 0, visits: 1 });
    await purchase({ amount: 0, items: 1 });
    for (const source of ["redeem", "lifecycle", "expire", "reversal", "correction", "unknown"]) await purchase({ source, amount: 999, at: daysAgo(1) });
    for (const type of ["REWARD", "ACHIEVEMENT", "REFERRAL_REWARD", "MANUAL_ADJUSTMENT", "CHALLENGE"]) await purchase({ type, at: daysAgo(1) });
    for (const status of ["REVERSED", "CANCELLED"]) await purchase({ status, at: daysAgo(1) });
    await purchase({ original: randomUUID(), at: daysAgo(1) });
    await purchase({ reversed: randomUUID(), at: daysAgo(1) });
    await purchase({ amount: 0, points: 100, at: daysAgo(1) });
    await purchase({ amount: 999, at: daysAgo(-1) });
    await purchase({ customerId: otherCustomer, amount: 999 });
    await purchase({ businessId: otherBusiness, customerId: customerA, amount: 999 });
    const result = await audience();
    assert.equal(result.total, 1);
    assert.deepEqual(result.customers, [{ id: customerA, name: "Ana", last_purchase_at: daysAgo(40), recorded_sales_q: 185, purchases: 6 }]);
    await db.query("UPDATE customers SET deleted_at=now() WHERE id=$1", [customerA]);
    assert.deepEqual(await audience(), { total: 0, customers: [], paused: false, count_status: "available", data_readiness: manualReadiness });
  });

  it("uses elapsed 30/60/90 day cutoffs and the latest qualifying purchase", async () => {
    await purchase({ at: daysAgo(90) });
    await purchase({ customerId: customerB, at: daysAgo(60) });
    assert.equal((await audience({ inactiveDays: 90 })).total, 1);
    assert.equal((await audience({ inactiveDays: 60 })).total, 2);
    await purchase({ at: daysAgo(30) });
    assert.equal((await audience({ inactiveDays: 60 })).total, 1);
    assert.equal((await audience()).total, 2);
    await purchase({ at: new Date(Date.parse(daysAgo(30)) + 1).toISOString() });
    assert.equal((await audience()).total, 1);
    await purchase({ customerId: customerB, at: now.toISOString() });
    assert.equal((await audience()).total, 0);
  });

  it("orders by historical sales then ID, with a total unaffected by pagination", async () => {
    await purchase();
    await purchase({ customerId: customerB, amount: 20 });
    assert.equal((await audience({ limit: 1 })).customers[0].id, customerB);
    assert.deepEqual(await audience({ limit: 1, offset: 10 }), { total: 2, customers: [], paused: false, count_status: "available", data_readiness: manualReadiness });
    await purchase({ amount: 10 });
    assert.deepEqual((await audience()).customers.map(row => row.id), [customerA, customerB].sort());
  });

  it("atomically snapshots the top eligible customers and preserves retries after eligibility changes", async () => {
    await purchase();
    await purchase({ customerId: customerB, amount: 20 });
    const requestId = randomUUID();
    const first = await create({ requestId, limit: 1 });
    assert.equal(first.run.member_count, 1);
    const result = await details(first.run.id);
    assert.equal(result.members[0].customer_id, customerB);
    assert.equal(result.members[0].status, "pending");
    assert.equal(Number(result.members[0].recorded_sales_q), 20);
    assert.equal(result.members[0].last_purchase_at, daysAgo(40));
    await purchase({ customerId: customerB, at: daysAgo(1) });
    const repeat = await create({ requestId, limit: 1 });
    assert.deepEqual(repeat, first);
    assert.equal(auditEvents.length, 1);
    await assert.rejects(create({ requestId, limit: 2 }), { statusCode: 409 });
    await assert.rejects(create({ requestId, name: "Changed", limit: 1 }), { statusCode: 409 });
    await assert.rejects(create({ requestId, notes: "Changed", limit: 1 }), { statusCode: 409 });
    await assert.rejects(create({ requestId, inactiveDays: 60, limit: 1 }), { statusCode: 409 });
    const snapshot = await db.query("SELECT recorded_sales_q, purchases FROM recovery_members WHERE run_id=$1", [first.run.id]);
    assert.equal(Number(snapshot.rows[0].recorded_sales_q), 20);
    assert.equal(Number(snapshot.rows[0].purchases), 1);
  });

  it("rejects empty snapshots without persisting a run and rolls back on audit failure", async () => {
    await assert.rejects(create(), { statusCode: 400 });
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM recovery_runs")).rows[0].count), 0);
    await purchase();
    await assert.rejects(create({}, { ...deps, audit: async () => { throw new Error("audit unavailable"); } }), /audit unavailable/);
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM recovery_runs")).rows[0].count), 0);
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM recovery_members")).rows[0].count), 0);
  });

  it("serializes simultaneous request IDs, returning one snapshot or a payload conflict", async () => {
    await purchase();
    const requestId = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => create({ requestId })));
    assert.equal(new Set(results.map(result => result.run.id)).size, 1);
    assert.equal(auditEvents.length, 1);
    const conflictId = randomUUID();
    const conflicting = await Promise.allSettled([create({ requestId: conflictId }), create({ requestId: conflictId, name: "Other" })]);
    assert.equal(conflicting.filter(result => result.status === "fulfilled").length, 1);
    const rejected = conflicting.find(result => result.status === "rejected");
    assert.equal(rejected.reason.statusCode, 409);
  });

  it("requires explicit contact confirmation and records server time exactly once", async () => {
    await purchase();
    const { run } = await create();
    await assert.rejects(update(run.id, customerA, { contactConfirmed: false }), { statusCode: 400 });
    const beforeTime = Date.now();
    const first = await update(run.id, customerA);
    assert.equal(first.member.status, "contacted");
    assert.ok(Date.parse(first.member.contacted_at) >= beforeTime - 1000);
    assert.ok(Date.parse(first.member.contacted_at) <= Date.now());
    assert.deepEqual(await update(run.id, customerA), first);
    assert.equal(auditEvents.length, 2);
    await assert.rejects(update(run.id, customerA, { status: "skipped", contactConfirmed: false }), { statusCode: 409 });
  });

  it("serializes conflicting status updates and keeps skipped contacts without a timestamp", async () => {
    await purchase();
    const { run } = await create();
    const results = await Promise.allSettled([update(run.id, customerA), update(run.id, customerA, { status: "skipped", contactConfirmed: false })]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.find(result => result.status === "rejected").reason.statusCode, 409);
    const { run: second } = await create();
    const skipped = await update(second.id, customerA, { status: "skipped", contactConfirmed: false });
    assert.equal(skipped.member.contacted_at, null);
    assert.deepEqual(await update(second.id, customerA, { status: "skipped" }), skipped);
  });

  it("measures only genuine purchases strictly after contact through 30 elapsed days and never in the future", async () => {
    await purchase();
    await purchase({ customerId: customerB });
    const { run } = await create();
    await update(run.id, customerA);
    const contactedAt = daysAgo(31);
    await db.query("UPDATE recovery_members SET contacted_at=$1 WHERE run_id=$2 AND customer_id=$3", [contactedAt, run.id, customerA]);
    await purchase({ amount: 999, at: contactedAt });
    const firstReturn = new Date(Date.parse(contactedAt) + 1).toISOString();
    await purchase({ amount: 10, at: firstReturn });
    await purchase({ amount: 20, at: daysAgo(1), status: "PENDING" });
    await purchase({ amount: 999, at: new Date(Date.parse(daysAgo(1)) + 1).toISOString() });
    await purchase({ amount: 999, at: daysAgo(2), status: "REVERSED" });
    await purchase({ amount: 999, at: daysAgo(2), original: randomUUID() });
    await purchase({ amount: 999, at: daysAgo(2), type: "ACHIEVEMENT" });
    await purchase({ amount: 999, at: daysAgo(2), source: "redeem" });
    await purchase({ amount: 999, at: daysAgo(2), customerId: otherCustomer });
    await purchase({ amount: 999, at: daysAgo(2), businessId: otherBusiness });
    const result = await details(run.id);
    assert.equal(result.run.contacted_count, 1);
    assert.equal(result.run.returned_count, 1);
    assert.equal(result.run.recorded_sales_after_contact_q, 30);
    assert.equal(result.members.find(member => member.customer_id === customerA).returned_at, firstReturn);
    await db.query("UPDATE recovery_members SET contacted_at=$1 WHERE run_id=$2 AND status='contacted'", [daysAgo(1), run.id]);
    await purchase({ amount: 50, at: now.toISOString() });
    await purchase({ amount: 999, at: daysAgo(-1) });
    const futureBound = await details(run.id);
    assert.equal(futureBound.run.recorded_sales_after_contact_q, 1049); // prior 999 one millisecond after the new contact + today's 50
    assert.equal(futureBound.run.returned_count, 1);
  });

  it("excludes deleted members from PII, contact counts and results while retaining the original snapshot count", async () => {
    await purchase();
    await purchase({ customerId: customerB });
    const { run } = await create();
    await update(run.id, customerA);
    await db.query("UPDATE recovery_members SET contacted_at=$1 WHERE run_id=$2 AND status='contacted'", [daysAgo(1), run.id]);
    await purchase({ at: now.toISOString() });
    await db.query("UPDATE customers SET deleted_at=now() WHERE id=$1", [customerA]);
    const result = await details(run.id);
    assert.equal(result.total, 1);
    assert.equal(result.run.member_count, 2);
    assert.equal(result.run.contacted_count, 0);
    assert.equal(result.run.returned_count, 0);
    assert.equal(result.run.recorded_sales_after_contact_q, 0);
    assert.equal(result.members[0].customer_id, customerB);
    await assert.rejects(update(run.id, customerA), { statusCode: 404 });
    assert.deepEqual((await details(run.id, { offset: 10 })).members, []);
  });

  it("returns 404 for cross-tenant runs and members and limits history to twenty runs", async () => {
    await purchase();
    await purchase({ businessId: otherBusiness, customerId: otherCustomer });
    const { run } = await create();
    await assert.rejects(details(run.id, { businessId: otherBusiness }), { statusCode: 404 });
    await assert.rejects(update(run.id, customerA, { businessId: otherBusiness }), { statusCode: 404 });
    await assert.rejects(update(run.id, otherCustomer), { statusCode: 404 });
    for (let index = 0; index < 21; index += 1) await create({ name: `Run ${index}`, now: new Date(now.getTime() + index) });
    const list = await recovery.listRecoveryRuns({ businessId, now }, deps);
    assert.equal(list.runs.length, 20);
    assert.equal(list.runs[0].name, "Run 20");
    assert.deepEqual(await recovery.listRecoveryRuns({ businessId: otherBusiness, now }, deps), { runs: [] });
  });

  it("enforces tenant RLS and composite tenant foreign keys on both new tables", async () => {
    await purchase();
    const { run } = await create();
    const policies = await db.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('recovery_runs','recovery_members')");
    assert.equal(policies.rows.length, 2);
    assert.ok(policies.rows.every(row => row.relrowsecurity && row.relforcerowsecurity));
    await db.query("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='recovery_reader') THEN CREATE ROLE recovery_reader; END IF; END $$");
    await db.query("GRANT USAGE ON SCHEMA public,app TO recovery_reader; GRANT SELECT,INSERT,UPDATE ON recovery_runs,recovery_members TO recovery_reader");
    const client = await db.connect();
    try {
      await client.query("SET ROLE recovery_reader");
      assert.equal((await client.query("SELECT * FROM recovery_runs")).rows.length, 0);
      await client.query("SELECT set_config('app.current_tenant',$1,false)", [otherBusiness]);
      assert.equal((await client.query("SELECT * FROM recovery_members")).rows.length, 0);
      await assert.rejects(client.query("INSERT INTO recovery_members (business_id,run_id,customer_id,last_purchase_at,recorded_sales_q,purchases) VALUES ($1,$2,$3,$4,10,1)", [businessId, run.id, customerB, daysAgo(40)]), { code: "42501" });
      await client.query("SELECT set_config('app.current_tenant',$1,false)", [businessId]);
      assert.equal((await client.query("SELECT * FROM recovery_runs")).rows.length, 1);
      assert.equal((await client.query("SELECT * FROM recovery_members")).rows.length, 1);
    } finally {
      await client.query("RESET ROLE");
      await client.query("SELECT set_config('app.current_tenant','',false)");
      client.release();
    }
    await assert.rejects(db.query("INSERT INTO recovery_members (business_id,run_id,customer_id,last_purchase_at,recorded_sales_q,purchases) VALUES ($1,$2,$3,$4,10,1)", [businessId, run.id, otherCustomer, daysAgo(40)]), { code: "23503" });
    await assert.rejects(db.query("INSERT INTO recovery_members (business_id,run_id,customer_id,last_purchase_at,recorded_sales_q,purchases) VALUES ($1,$2,$3,$4,10,1)", [otherBusiness, run.id, otherCustomer, daysAgo(40)]), { code: "23503" });
  });
});
