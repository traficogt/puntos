// Disposable local database ONLY. No HTTP provider calls or real business data.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import pg from "pg";
import * as refunds from "../../src/app/services/pos-refund-service.js";
import { closeDatabase, withDbClientContext, dbQuery } from "../../src/app/database.js";
import { posEventId } from "../../src/app/services/pos/common.js";
import { refundAwardTransaction } from "../../src/app/services/loyalty-ops-service.js";
import { syncConfiguredPosOnce } from "../../src/app/services/pos-integration-service.js";

assert.equal(process.env.NODE_ENV, "test");
assert.equal(process.env.DB_HOST, "127.0.0.1");
assert.equal(process.env.DB_PORT, "55451");
assert.equal(process.env.DB_NAME, "pos_refund_tests");
assert.equal(process.env.DB_USER, "pos_refund_app");
const db = new pg.Client({ host: "127.0.0.1", port: 55451, database: "pos_refund_tests", user: "pos_refund_test", password: "pos-refund-disposable-only" });
const bid = crypto.randomUUID(), other = crypto.randomUUID(), sid = crypto.randomUUID();
const tenant = fn => withDbClientContext({ tenantId: bid, platformAdmin: false }, fn);
const payload = (saleId, patch = {}) => ({ refundId: `refund-${saleId}`, originalSaleId: saleId, source: "register-1", amountQ: 40, currency: "GTQ", scope: "full", ...patch });
async function seed(saleId, { status = "POSTED", balance = 40, pending = 0, source = "register-1", businessId = bid, deleted = false } = {}) {
  const cid = crypto.randomUUID(), tid = crypto.randomUUID();
  await db.query("INSERT INTO customers(id,business_id,phone,deleted_at) VALUES($1,$2,$3,$4)", [cid, businessId, cid.slice(0, 8), deleted ? new Date() : null]);
  await db.query("INSERT INTO customer_balances(customer_id,points,pending_points,lifetime_points) VALUES($1,$2,$3,40)", [cid, balance, pending]);
  await db.query(`INSERT INTO transactions(id,business_id,customer_id,amount_q,points,status,source,visits,items,meta)
    VALUES($1,$2,$3,40,40,$4,'external',1,2,$5)`, [tid, businessId, cid, status, { external_event_id: posEventId({ source, saleId }), pos_sale: { saleId, source, amountQ: 40, items: 2 } }]);
  return { cid, tid };
}
async function balance(cid) { return (await db.query("SELECT points,pending_points,lifetime_points FROM customer_balances WHERE customer_id=$1", [cid])).rows[0]; }
async function receive(value) { const queued = await refunds.enqueuePosRefund(bid, value); return refunds.reconcilePosRefund(bid, queued.refund.id); }

test("POS durable refunds use the existing ledger under tenant RLS", async t => {
  assert.equal(typeof refunds.enqueuePosRefund, "function", "durable refund ingestion must exist");
  await db.connect();
  try {
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    for (const file of ["schema.sql", "schema-extensions.sql", "migrations/2026-02-27-tenant-rls_canonical.sql", "migrations/2026-11-10-pos-refunds.sql"]) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await db.query(await fs.readFile(new URL(`../../src/app/${file}`, import.meta.url), "utf8"));
    }
    await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pos_refund_app') THEN CREATE ROLE pos_refund_app LOGIN PASSWORD 'pos-refund-app-only'; END IF; END $$;
      GRANT USAGE ON SCHEMA public,app TO pos_refund_app;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO pos_refund_app;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO pos_refund_app`);
    for (const businessId of [bid, other]) await db.query("INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_json) VALUES($1::uuid,'Test',$1::text,$2,'test','EMPRESA',$3)", [businessId, `${businessId}@example.invalid`, { pos_integration: { enabled: true, mode: "api" }, external_awards: { enabled: true } }]);
    await db.query("INSERT INTO staff_users(id,business_id,name,role,password_hash) VALUES($1,$2,'Test owner','OWNER','test')", [sid, bid]);

    await t.test("complete refunds reverse once under concurrent duplicate deliveries and preserve evidence", async () => {
      const sale = await seed("full");
      const outcomes = await Promise.all(Array.from({ length: 5 }, () => tenant(() => receive(payload("full")))));
      assert.ok(outcomes.every(out => out.refund.status === "reconciled"));
      assert.equal(new Set(outcomes.map(out => out.refund.reversal_transaction_id)).size, 1);
      assert.equal((await balance(sale.cid)).points, 0);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM transactions WHERE original_transaction_id=$1", [sale.tid])).rows[0].n, 1);
      assert.equal((await db.query("SELECT actor_type,actor_id FROM audit_logs WHERE action='award.refund' ORDER BY created_at DESC LIMIT 1")).rows[0].actor_type, "SYSTEM");
      await tenant(async () => {
        await assert.rejects(refunds.enqueuePosRefund(bid, payload("full", { amountQ: 39 })), { statusCode: 409 });
        const list = await refunds.listPosRefunds(bid, {});
        assert.equal(list.summary.reconciled, 1);
        assert.equal(list.refunds[0].original_sale_id, "full");
      });
    });
    await t.test("pending points are cancelled without deducting available balance", async () => {
      const sale = await seed("pending", { status: "PENDING", balance: 3, pending: 40 });
      const result = await tenant(() => receive(payload("pending")));
      assert.equal(result.refund.status, "reconciled");
      assert.equal((await balance(sale.cid)).points, 3);
      assert.equal((await balance(sale.cid)).pending_points, 0);
    });
    await t.test("equal money does not turn an explicitly partial or unverified receipt into a full reversal", async () => {
      for (const [scope, reason] of [["partial", "partial_refund"], ["unknown", "scope_unverified"], [undefined, "scope_unverified"]]) {
        const name = `scope-${scope || "omitted"}`;
        const sale = await seed(name);
        const result = await tenant(() => receive(payload(name, { scope })));
        assert.equal(result.refund.reason, reason);
        assert.equal((await balance(sale.cid)).points, 40);
      }
    });
    await t.test("native original evidence can improve without changing immutable refund receipt data", async () => {
      const source = "loyverse:merchant-1:store-1";
      const sale = await seed("native-proof", { source });
      const options = { origin: "loyverse", nativeEvidence: "a".repeat(64) };
      const first = await tenant(() => refunds.enqueuePosRefund(bid, payload("native-proof", { source, scope: "unknown" }), options));
      assert.equal((await tenant(() => refunds.reconcilePosRefund(bid, first.refund.id))).refund.reason, "scope_unverified");
      const improved = await tenant(() => refunds.enqueuePosRefund(bid, payload("native-proof", { source }), options));
      assert.equal(improved.refund.id, first.refund.id);
      assert.equal((await tenant(() => refunds.reconcilePosRefund(bid, first.refund.id, { automatic: true }))).refund.status, "reconciled");
      assert.equal((await balance(sale.cid)).points, 0);
      await assert.rejects(tenant(() => refunds.enqueuePosRefund(bid, payload("native-proof", { source }), { ...options, nativeEvidence: "b".repeat(64) })), { statusCode: 409 });
    });
    await t.test("partial, excess and zero amounts stay reviewable without changing balances", async () => {
      for (const [suffix, amountQ, reason] of [["partial", 20, "partial_refund"], ["excess", 41, "amount_mismatch"], ["zero", 0, "amount_mismatch"]]) {
        const sale = await seed(suffix);
        const result = await tenant(() => receive(payload(suffix, { amountQ })));
        assert.equal(result.refund.status, "pending");
        assert.equal(result.refund.reason, reason);
        assert.equal((await balance(sale.cid)).points, 40);
      }
    });
    await t.test("automatic receipt replay does not keep retrying permanently unsupported partials", async () => {
      await seed("partial-repeat");
      const pending = await tenant(() => receive(payload("partial-repeat", { amountQ: 20 })));
      const again = await tenant(() => refunds.reconcilePosRefund(bid, pending.refund.id, { automatic: true }));
      assert.equal(again.refund.attempts, pending.refund.attempts);
      assert.equal(again.refund.status, "pending");
    });
    await t.test("missing original persists and resolves only when same-source sale appears", async () => {
      await seed("late", { source: "register-2" });
      const pending = await tenant(() => receive(payload("late")));
      assert.equal(pending.refund.reason, "original_not_found");
      const sale = await seed("late");
      const result = await tenant(() => refunds.reconcilePosRefund(bid, pending.refund.id));
      assert.equal(result.refund.status, "reconciled");
      assert.equal((await balance(sale.cid)).points, 0);
    });
    await t.test("insufficient policy balance rolls back the ledger and keeps the queue actionable", async () => {
      const sale = await seed("insufficient", { balance: 10 });
      const result = await tenant(() => receive(payload("insufficient")));
      assert.equal(result.refund.reason, "insufficient_balance");
      assert.equal((await balance(sale.cid)).points, 10);
      assert.equal((await db.query("SELECT status FROM transactions WHERE id=$1", [sale.tid])).rows[0].status, "POSTED");
      await db.query("UPDATE customer_balances SET points=40 WHERE customer_id=$1", [sale.cid]);
      assert.equal((await tenant(() => refunds.reconcilePosRefund(bid, result.refund.id))).refund.status, "reconciled");
    });
    await t.test("manual reversal is recognized from ledger evidence without a second deduction", async () => {
      const sale = await seed("manual");
      const original = await tenant(() => refundAwardTransaction({ staff: { id: sid, business_id: bid }, transactionId: sale.tid, requestId: crypto.randomUUID() }));
      const result = await tenant(() => receive(payload("manual")));
      assert.equal(result.refund.reason, "already_reversed");
      assert.equal(result.refund.reversal_transaction_id, original.reversalTransactionId);
      assert.equal((await balance(sale.cid)).points, 0);
    });
    await t.test("deleted customers and unmatched sources cannot be reversed", async () => {
      const sale = await seed("deleted", { deleted: true });
      assert.equal((await tenant(() => receive(payload("deleted")))).refund.reason, "customer_unavailable");
      assert.equal((await balance(sale.cid)).points, 40);
    });
    await t.test("cross-tenant IDs cannot expose or mutate another tenant queue or sale", async () => {
      const sale = await seed("foreign", { businessId: other });
      assert.equal((await tenant(() => receive(payload("foreign")))).refund.reason, "original_not_found");
      const list = await tenant(() => refunds.listPosRefunds(bid, {}));
      await withDbClientContext({ tenantId: other, platformAdmin: false }, async () => {
        await assert.rejects(refunds.reconcilePosRefund(other, list.refunds[0].id), { statusCode: 404 });
        assert.equal((await dbQuery("SELECT count(*)::int AS n FROM pos_refund_receipts")).rows[0].n, 0);
        await assert.rejects(refunds.enqueuePosRefund(bid, payload("foreign-new")), {statusCode:404});
      });
      assert.equal((await balance(sale.cid)).points, 40);
    });
    await t.test("failure saving reconciliation rolls back reversal while retaining the accepted receipt", async () => {
      const sale = await seed("rollback");
      const queued = await tenant(() => refunds.enqueuePosRefund(bid, payload("rollback")));
      await db.query(`CREATE FUNCTION reject_refund_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.refund_id='refund-rollback' AND NEW.status='reconciled' THEN RAISE EXCEPTION 'test completion failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER test_refund_failure BEFORE UPDATE ON pos_refund_receipts FOR EACH ROW EXECUTE FUNCTION reject_refund_completion()`);
      await assert.rejects(tenant(() => refunds.reconcilePosRefund(bid, queued.refund.id)), /test completion failure/);
      await db.query("DROP TRIGGER test_refund_failure ON pos_refund_receipts; DROP FUNCTION reject_refund_completion()");
      assert.equal((await balance(sale.cid)).points, 40);
      assert.equal((await db.query("SELECT status FROM pos_refund_receipts WHERE id=$1", [queued.refund.id])).rows[0].status, "pending");
      assert.equal((await tenant(() => refunds.reconcilePosRefund(bid, queued.refund.id))).refund.status, "reconciled");
    });
    await t.test("achievement and challenge rewards are reversed atomically, including their balance policy", async () => {
      for (const [suffix, startingBalance, expected] of [["bonus-full", 52, "reconciled"], ["bonus-spent", 40, "pending"]]) {
        const sale = await seed(suffix, { balance: Number(startingBalance) });
        const achievement = crypto.randomUUID(), challenge = crypto.randomUUID();
        const achievementTx = crypto.randomUUID(), challengeTx = crypto.randomUUID();
        await db.query("INSERT INTO achievements(id,business_id,name,requirement_type,requirement_value,points_reward) VALUES($1,$2,'Test spend','spend',40,7)", [achievement, bid]);
        await db.query("INSERT INTO challenges(id,business_id,name,challenge_type,requirement_type,requirement_value,reward_points,start_date) VALUES($1,$2,'Test visits','limited_time','visits',1,5,now()-interval '1 day')", [challenge, bid]);
        for (const [id, type, points, entity, entityId] of [[achievementTx, "ACHIEVEMENT", 7, "achievement_id", achievement], [challengeTx, "CHALLENGE", 5, "challenge_id", challenge]]) await db.query("INSERT INTO transactions(id,business_id,customer_id,amount_q,points,status,source,type,visits,meta) VALUES($1,$2,$3,0,$4,'POSTED','gamification',$5,0,$6)", [id, bid, sale.cid, points, type, { [entity]: entityId, source_transaction_id: sale.tid }]);
        await db.query("INSERT INTO customer_achievements(customer_id,achievement_id,source_transaction_id,reward_transaction_id) VALUES($1,$2,$3,$4)", [sale.cid, achievement, sale.tid, achievementTx]);
        await db.query("INSERT INTO customer_challenges(customer_id,challenge_id,progress,completed,completed_at,times_completed,last_source_transaction_id,last_reward_transaction_id) VALUES($1,$2,1,true,now(),1,$3,$4)", [sale.cid, challenge, sale.tid, challengeTx]);
        const result = await tenant(() => receive(payload(suffix)));
        assert.equal(result.refund.status, expected);
        assert.equal((await balance(sale.cid)).points, expected === "reconciled" ? 0 : startingBalance);
        const txRows = (await db.query("SELECT status FROM transactions WHERE id=ANY($1::uuid[])", [[sale.tid, achievementTx, challengeTx]])).rows;
        assert.ok(txRows.every(row => row.status === (expected === "reconciled" ? "REVERSED" : "POSTED")));
        if (expected === "pending") assert.equal(result.refund.reason, "insufficient_balance");
      }
    });
    await t.test("different refund receipts and a manual refund can race without double-reversing a sale", async () => {
      const sale = await seed("race");
      const outcomes = await Promise.allSettled([
        tenant(() => receive(payload("race"))),
        tenant(() => receive(payload("race", { refundId: "refund-race-second" }))),
        tenant(() => refundAwardTransaction({ staff: { id: sid, business_id: bid }, transactionId: sale.tid, requestId: crypto.randomUUID() }))
      ]);
      assert.equal(outcomes[0].status, "fulfilled");
      assert.equal(outcomes[1].status, "fulfilled");
      assert.equal((await balance(sale.cid)).points, 0);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM transactions WHERE original_transaction_id=$1", [sale.tid])).rows[0].n, 1);
    });
    await t.test("automatic missing-sale retries stop at ten attempts and partials remain untouched", async () => {
      const pending = await tenant(() => receive(payload("never-imported")));
      await db.query("UPDATE pos_refund_receipts SET attempts=10,last_attempt_at=now()-interval '1 hour' WHERE id=$1", [pending.refund.id]);
      const before = (await db.query("SELECT id,attempts FROM pos_refund_receipts WHERE reason='partial_refund' ORDER BY id")).rows;
      const outcomes = await tenant(() => refunds.retryPendingPosRefunds(bid));
      assert.ok(outcomes.length <= 25);
      assert.ok(outcomes.every(out => out.refund.id !== pending.refund.id));
      assert.deepEqual((await db.query("SELECT id,attempts FROM pos_refund_receipts WHERE reason='partial_refund' ORDER BY id")).rows, before);
    });
    await t.test("the existing POS worker retries API receipts locally and leaves paused connections alone", async () => {
      const sale = await seed("worker-api");
      await tenant(() => refunds.enqueuePosRefund(bid, payload("worker-api")));
      const oldFetch = globalThis.fetch;
      globalThis.fetch = () => { throw new Error("No provider calls permitted in disposable refund tests"); };
      try {
        await syncConfiguredPosOnce();
        assert.equal((await balance(sale.cid)).points, 0);
        const paused = await seed("worker-paused");
        await tenant(() => refunds.enqueuePosRefund(bid, payload("worker-paused")));
        await db.query("UPDATE businesses SET program_json=jsonb_set(program_json,'{pos_integration,enabled}','false') WHERE id=$1", [bid]);
        await syncConfiguredPosOnce();
        assert.equal((await balance(paused.cid)).points, 40);
      } finally {
        globalThis.fetch = oldFetch;
        await db.query("UPDATE businesses SET program_json=jsonb_set(program_json,'{pos_integration,enabled}','true') WHERE id=$1", [bid]);
      }
    });
  } finally { await db.end(); await closeDatabase(); }
});
