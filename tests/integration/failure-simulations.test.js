import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, describe, it, mock } from 'node:test';
import pg from 'pg';
import { assertFailureFixtureEnvironment, failureWorkerEnvironment } from './_support/failure-fixture.js';

const coverage = [
  'database-session-loss', 'worker-interruption-reclaim', 'queue-enqueue-outage',
  'provider-outage-and-event-replay', 'overlapping-writers-after-rollback'
];
const results = [];
let db, app, awards, jobs, imports, recovery, pos, loyverse, jobRepo;
const tenant = (businessId, fn) => app.withDbClientContext({ tenantId: businessId, platformAdmin: false }, fn);
const admin = fn => app.withDbClientContext({ tenantId: null, platformAdmin: true }, fn);
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0];

function scenario(id, description, run) {
  it(description, { timeout: 30000 }, async t => {
    const result = { scenario: id, status: 'fail' };
    results.push(result);
    try { result.counters = await run(); result.status = 'pass'; }
    finally { t.diagnostic(JSON.stringify(result)); }
  });
}

async function until(check, description) {
  const deadline = Date.now() + 8000;
  do {
    const result = await check();
    if (result) return result;
    await delay(20);
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for ${description}`);
}

async function fixture({ customer = true, mode = 'api' } = {}) {
  const businessId = randomUUID(), customerId = randomUUID(), staffId = randomUUID();
  const slug = `failure-${businessId}`;
  const program = { points_per_visit: 10, external_awards: { enabled: true, api_key: 'fictional-only' },
    pos_integration: { enabled: true, mode, revision: 'fixture-revision',
      connected_at: '2026-11-09T00:00:00.000Z', pending_receipts: [],
      loyverse: { access_token: 'fictional-only', merchant_id: 'fixture-merchant', store_id: 'fixture-store' } } };
  await db.query(`INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_type,program_json)
    VALUES($1,'Fictional failure fixture',$2,$3,'fixture-only','EMPRESA','VISIT',$4)`,
  [businessId, slug, `${businessId}@example.invalid`, program]);
  await db.query("INSERT INTO staff_users(id,business_id,name,role,password_hash) VALUES($1,$2,'Fictional owner','OWNER','fixture-only')", [staffId, businessId]);
  if (customer) {
    await db.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,'50255551234','Fictional customer')", [customerId, businessId]);
    await db.query('INSERT INTO customer_balances(customer_id) VALUES($1)', [customerId]);
  }
  return { businessId, customerId, staffId, slug };
}

async function ledgerState(f) {
  const balance = await one('SELECT points,pending_points,lifetime_points FROM customer_balances WHERE customer_id=$1', [f.customerId]);
  const ledger = (await db.query('SELECT id,points,status,source,original_transaction_id,reversed_transaction_id FROM transactions WHERE business_id=$1 ORDER BY created_at,id', [f.businessId])).rows;
  return { balance, ledger };
}

function award(f, eventId) {
  return tenant(f.businessId, () => awards.awardFromExternalEventTrusted({
    businessSlug: f.slug, customerId: f.customerId, externalEventId: eventId, amount_q: 20, visits: 1
  }));
}

async function blockedPids(key) {
  return (await db.query(`SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
    WHERE l.locktype='advisory' AND NOT l.granted AND l.classid=0 AND l.objid=$1
    AND a.datname=current_database()`, [key])).rows.map(row => row.pid);
}

describe('deterministic failures in an isolated, fictional PostgreSQL fixture', { concurrency: false }, () => {
  before(async () => {
    const url = assertFailureFixtureEnvironment();
    mock.method(globalThis, 'fetch', async () => { throw new Error('Live HTTP is disabled in failure fixtures'); });
    db = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 3000, statement_timeout: 10000 });
    assert.equal((await one('SELECT current_database() AS name')).name, 'failure_simulations_test');
    // Bounds blocked SQL, including in the deliberately interrupted worker.
    await db.query('ALTER DATABASE failure_simulations_test SET statement_timeout = 10000');
    [app, awards, jobs, imports, recovery, pos, loyverse, { JobRepo: jobRepo }] = await Promise.all([
      import('../../src/app/database.js'), import('../../src/app/services/external-award-service.js'),
      import('../../src/app/services/job-service.js'), import('../../src/app/services/customer-import-job-service.js'),
      import('../../src/app/services/job-recovery.js'), import('../../src/app/services/pos-integration-service.js'),
      import('../../src/app/services/pos/loyverse.js'), import('../../src/app/repositories/job-repository.js')
    ]);
  });

  after(async t => {
    try {
      t.diagnostic(JSON.stringify({ kind: 'failure-simulation-coverage', expected: coverage,
        scenarios: results, ok: results.length === coverage.length && results.every(value => value.status === 'pass') }));
      assert.deepEqual(results.map(value => value.scenario), coverage, 'Every required scenario must execute');
    } finally { await app?.closeDatabase(); await db?.end(); mock.restoreAll(); }
  });

  scenario(coverage[0], 'terminating the active ledger connection rolls back its insert; retry commits once', async () => {
    const f = await fixture(), eventId = 'fixture-session-loss';
    // AFTER INSERT is before the balance update and transaction COMMIT. This
    // terminates only the session executing this fixture's marked operation.
    await db.query(`CREATE FUNCTION fixture_disconnect() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.meta->>'external_event_id'='fixture-session-loss' THEN
        PERFORM pg_terminate_backend(pg_backend_pid()); END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_disconnect AFTER INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION fixture_disconnect()`);
    try { await assert.rejects(award(f, eventId), { code: '57P01' }); }
    finally { await db.query('DROP TRIGGER fixture_disconnect ON transactions; DROP FUNCTION fixture_disconnect()'); }
    const rolledBack = await ledgerState(f);
    assert.equal(rolledBack.ledger.length, 0);
    assert.deepEqual(rolledBack.balance, { points: 0, pending_points: 0, lifetime_points: 0 });
    const first = await award(f, eventId), replay = await award(f, eventId);
    assert.equal(replay.replay, true);
    assert.equal(first.transactionId, replay.transactionId);
    const final = await ledgerState(f);
    assert.equal(final.ledger.length, 1);
    assert.equal(final.ledger[0].id, first.transactionId);
    assert.equal(final.ledger[0].points, 10);
    assert.deepEqual(final.balance, { points: 10, pending_points: 0, lifetime_points: 10 });
    return { terminatedSessions: 1, rolledBackTransactions: 1, committedAwards: 1, replayedAwards: 1, points: 10 };
  });

  scenario(coverage[1], 'a killed import worker resumes after lease expiry without duplicating its committed chunk', async () => {
    const f = await fixture({ customer: false });
    const created = await tenant(f.businessId, () => imports.createCustomerImportJob({ businessId: f.businessId, staffId: f.staffId,
      input: { csv: 'phone,name,points\n' + Array.from({ length: 101 }, (_, i) => `+502${55550000 + i},Fictional ${i},2`).join('\n'),
        columns: { phone: 'phone', name: 'name', points: 'points' }, existing_policy: 'skip', label: 'Fictional opening balances',
        confirmed: true, request_id: randomUUID() } }));
    const importId = created.job.id, key = 8116101, lock = await db.connect();
    let child, exit, oldClaim, interruptedPid;
    await lock.query('SELECT pg_advisory_lock($1)', [key]);
    await db.query(`CREATE FUNCTION fixture_pause_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS(SELECT 1 FROM customer_import_jobs WHERE business_id=NEW.business_id AND processed=100 AND status='running')
      THEN PERFORM pg_advisory_xact_lock(8116101); END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_pause_import BEFORE INSERT ON customer_migration_batches FOR EACH ROW EXECUTE FUNCTION fixture_pause_import()`);
    try {
      child = spawn(process.execPath, [fileURLToPath(new URL('./_support/failure-worker.mjs', import.meta.url))], {
        cwd: process.cwd(), env: failureWorkerEnvironment(), stdio: ['ignore', 'ignore', 'pipe']
      });
      let stderr = '';
      child.stderr.on('data', value => { stderr = (stderr + value).slice(-4000); });
      exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
      interruptedPid = await until(async () => (await blockedPids(key))[0], 'the second import chunk to block');
      const progress = await one('SELECT processed,imported,opening_points FROM customer_import_jobs WHERE id=$1', [importId]);
      assert.deepEqual(progress, { processed: 100, imported: 100, opening_points: '200' });
      oldClaim = await one('SELECT * FROM background_jobs WHERE business_id=$1', [f.businessId]);
      assert.equal(oldClaim.status, 'RUNNING'); assert.equal(oldClaim.attempts, 1);
      child.kill('SIGKILL');
      assert.deepEqual(await exit, { code: null, signal: 'SIGKILL' }, stderr);
      // PostgreSQL notices a closed client socket after the blocked statement
      // resumes. The child is already dead, so it cannot send COMMIT.
      await lock.query('SELECT pg_advisory_unlock($1)', [key]);
      await until(async () => !(await one('SELECT 1 AS alive FROM pg_stat_activity WHERE pid=$1', [interruptedPid])), 'the killed worker connection to close');
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (exit) await exit;
      await lock.query('SELECT pg_advisory_unlock($1)', [key]); lock.release();
      await db.query('DROP TRIGGER fixture_pause_import ON customer_migration_batches; DROP FUNCTION fixture_pause_import()');
    }
    assert.equal((await one('SELECT count(*)::int AS n FROM transactions WHERE business_id=$1', [f.businessId])).n, 100);
    await db.query("UPDATE background_jobs SET locked_at=now()-interval '16 minutes' WHERE id=$1", [oldClaim.id]);
    assert.equal(await recovery.recoverJobLeases(db), 1);
    const recovered = await one('SELECT status,attempts,error FROM background_jobs WHERE id=$1', [oldClaim.id]);
    assert.deepEqual(recovered, { status: 'QUEUED', attempts: 1, error: 'worker_lease_expired' });
    for (const action of [recovery.heartbeatJob, recovery.completeClaimedJob, recovery.failClaimedJob]) {
      assert.equal((await action(db, oldClaim, { stale: true })).rowCount, 0, 'The expired claim must not mutate the requeued job');
    }
    assert.deepEqual(await jobs.processPendingJobsOnce({ limit: 1 }), { processed: 1 });
    const final = await one('SELECT status,processed,imported,opening_points,batch_ids,rows_json FROM customer_import_jobs WHERE id=$1', [importId]);
    assert.equal(final.status, 'completed'); assert.equal(final.processed, 101); assert.equal(final.imported, 101);
    assert.equal(final.opening_points, '202'); assert.equal(final.batch_ids.length, 2); assert.deepEqual(final.rows_json, []);
    const counts = await one(`SELECT count(*)::int AS customers,count(DISTINCT c.phone)::int AS phones,
      sum(b.points)::int AS points,sum(b.pending_points)::int AS pending,sum(b.lifetime_points)::int AS lifetime
      FROM customers c JOIN customer_balances b ON b.customer_id=c.id WHERE c.business_id=$1`, [f.businessId]);
    assert.deepEqual(counts, { customers: 101, phones: 101, points: 202, pending: 0, lifetime: 202 });
    const tx = await one('SELECT count(*)::int AS n,count(DISTINCT customer_id)::int AS customers,sum(points)::int AS points FROM transactions WHERE business_id=$1', [f.businessId]);
    assert.deepEqual(tx, { n: 101, customers: 101, points: 202 });
    const done = await one('SELECT status,attempts,result FROM background_jobs WHERE id=$1', [oldClaim.id]);
    assert.equal(done.status, 'DONE'); assert.equal(done.attempts, 2); assert.equal(done.result.processed, 101);
    assert.equal((await recovery.completeClaimedJob(db, oldClaim, { stale: true })).rowCount, 0);
    assert.deepEqual(await jobs.processPendingJobsOnce({ limit: 1 }), { processed: 0 });
    return { killedWorkers: 1, recoveredLeases: 1, attempts: 2, committedChunks: 2, customers: 101, ledgerRows: 101, points: 202, staleClaimsRejected: 4 };
  });

  scenario(coverage[2], 'an unavailable queue pointer leaves a durable job that the database worker completes', async () => {
    const f = await fixture({ customer: false });
    let attempts = 0, warnings = 0;
    const queued = await admin(() => jobs.enqueueJobWithDeps({ jobRepo,
      redisClient: { lPush: async () => { attempts++; throw new Error('fixture queue unavailable'); } },
      logger: { info() {}, warn() { warnings++; } }
    }, { businessId: f.businessId, jobType: 'analytics.calculate', payload: { trigger: 'fictional-recovery' } }));
    assert.equal(attempts, 1); assert.equal(warnings, 1);
    assert.equal((await one('SELECT status FROM background_jobs WHERE id=$1', [queued.id])).status, 'QUEUED');
    assert.deepEqual(await jobs.processPendingJobsOnce({ limit: 1 }), { processed: 1 });
    const done = await one('SELECT status,attempts,result FROM background_jobs WHERE id=$1', [queued.id]);
    assert.equal(done.status, 'DONE'); assert.equal(done.attempts, 1); assert.equal(done.result.ok, true);
    assert.deepEqual(await jobs.processPendingJobsOnce({ limit: 1 }), { processed: 0 });
    assert.equal((await one('SELECT count(*)::int AS n FROM transactions WHERE business_id=$1', [f.businessId])).n, 0);
    return { failedQueuePushes: attempts, durableJobs: 1, completedJobs: 1, attempts: done.attempts, ledgerRows: 0 };
  });

  scenario(coverage[3], 'Loyverse outage and replay reconcile an earlier refund once without advancing failed syncs', async () => {
    const f = await fixture({ mode: 'loyverse' });
    const occurredAt = '2026-11-09T00:15:00.000Z';
    const sale = { receipt_number: 'fixture-sale', receipt_type: 'SALE', store_id: 'fixture-store', customer_id: 'fixture-customer',
      total_money: 20, cancelled_at: null, refund_for: null, created_at: occurredAt, receipt_date: occurredAt,
      line_items: [{ item_id: 'fixture-item', variant_id: 'fixture-variant', quantity: 1 }],
      payments: [{ payment_type_id: 'cash', money_amount: 20, paid_at: occurredAt }] };
    const refund = { ...sale, receipt_number: 'fixture-refund', receipt_type: 'REFUND', refund_for: sale.receipt_number, customer_id: null };
    let records = [refund], unavailable = false, loseAwardReply = false, providerRequests = 0, failedRequests = 0, lostReplies = 0;
    let syncTime = Date.parse('2026-11-09T01:00:00.000Z');
    const fetchImpl = async input => {
      const url = new URL(input); providerRequests++;
      assert.equal(url.origin, 'https://api.loyverse.com');
      if (unavailable) { failedRequests++; return Response.json({}, { status: 503 }); }
      const bodies = { '/v1.0/merchant/': { id: 'fixture-merchant', currency: { code: 'GTQ', decimal_places: 2 } },
        '/v1.0/stores/fixture-store': { id: 'fixture-store' }, '/v1.0/receipts': { receipts: records, cursor: null },
        '/v1.0/receipts/fixture-sale': sale, '/v1.0/customers': { customers: [{ id: 'fixture-customer', phone_number: '+50255551234' }] } };
      assert.ok(Object.hasOwn(bodies, url.pathname), 'Unexpected fixture provider endpoint');
      return Response.json(bodies[url.pathname]);
    };
    const service = pos.createPosIntegrationService({
      fetchSales: input => loyverse.fetchLoyverseSales({ ...input, fetchImpl }),
      fetchRetrySales: input => loyverse.fetchLoyverseSalesByReceiptIds({ ...input, fetchImpl }),
      now: () => new Date(syncTime),
      award: async input => {
        const result = await awards.awardFromExternalEventTrusted(input);
        if (loseAwardReply) { loseAwardReply = false; lostReplies++; throw new Error('fixture lost award response'); }
        return result;
      }
    });
    const sync = () => tenant(f.businessId, () => service.syncLoyverseBusiness(f.businessId));
    const config = async () => (await one('SELECT program_json FROM businesses WHERE id=$1', [f.businessId])).program_json.pos_integration;
    const first = await sync();
    assert.equal(first.result.refunds_pending, 1);
    assert.equal((await one('SELECT reason FROM pos_refund_receipts WHERE business_id=$1', [f.businessId])).reason, 'original_not_found');
    assert.equal((await ledgerState(f)).ledger.length, 0);
    const checkpoint = (await config()).last_completed_at;
    records = [sale]; unavailable = true; syncTime += 300000;
    await assert.rejects(sync(), /Loyverse/); unavailable = false;
    assert.equal(failedRequests, 1); assert.equal((await config()).last_completed_at, checkpoint);
    assert.equal((await config()).last_sync.status, 'error');
    loseAwardReply = true; syncTime += 300000;
    await assert.rejects(sync(), /fixture lost award response/);
    assert.equal(lostReplies, 1); assert.equal((await config()).last_completed_at, checkpoint);
    assert.equal((await ledgerState(f)).ledger.length, 1);
    assert.equal((await ledgerState(f)).balance.points, 10);
    records = [refund, sale, sale];
    for (let attempt = 0; attempt < 2; attempt++) {
      syncTime += 300000;
      const replay = await sync();
      assert.equal(replay.result.awarded, 0); assert.equal(replay.result.duplicates, 2);
      assert.equal(replay.result.errors, 0); assert.equal(replay.result.refunds_received, 1);
      assert.equal(replay.result.refunds_reconciled, 1); assert.equal(replay.result.refunds_pending, 0);
      assert.equal((await config()).last_completed_at, new Date(syncTime).toISOString());
    }
    const final = await ledgerState(f);
    assert.equal(final.ledger.length, 2);
    const original = final.ledger.find(row => row.source === 'external'), reversal = final.ledger.find(row => row.source === 'reversal');
    assert.equal(original.status, 'REVERSED'); assert.equal(original.points, 10);
    assert.equal(reversal.points, -10); assert.equal(reversal.status, 'POSTED');
    assert.equal(original.reversed_transaction_id, reversal.id); assert.equal(reversal.original_transaction_id, original.id);
    assert.deepEqual(final.balance, { points: 0, pending_points: 0, lifetime_points: 0 });
    assert.equal((await one('SELECT count(*)::int AS n FROM pos_refund_receipts WHERE business_id=$1', [f.businessId])).n, 1);
    assert.equal((await config()).last_sync.status, 'ok');
    return { providerRequests, failedRequests, lostReplies, duplicateSalesOnReplay: 4, refundReceipts: 1, ledgerRows: 2, points: 0 };
  });

  scenario(coverage[4], 'waiting duplicate awards recover after the first writer rolls back', async () => {
    const f = await fixture(), key = 8116102, eventId = 'fixture-overlap';
    const lock = await db.connect(), requests = [];
    await lock.query('SELECT pg_advisory_lock($1)', [key]);
    await db.query(`CREATE FUNCTION fixture_pause_award() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.meta->>'external_event_id'='fixture-overlap' THEN PERFORM pg_advisory_xact_lock(8116102); END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_pause_award AFTER INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION fixture_pause_award()`);
    let firstPid, outcomes;
    try {
      const settle = promise => promise.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
      requests.push(settle(award(f, eventId)));
      firstPid = await until(async () => (await blockedPids(key))[0], 'the first award to hold its transaction');
      for (let i = 0; i < 3; i++) requests.push(settle(award(f, eventId)));
      await until(async () => (await one(`SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
        WHERE l.locktype='advisory' AND NOT l.granted AND a.datname=current_database()`)).n === 4, 'all four awards to overlap');
      assert.equal((await one('SELECT pg_cancel_backend($1) AS cancelled', [firstPid])).cancelled, true);
      const first = await requests[0];
      assert.equal(first.status, 'rejected'); assert.equal(first.reason.code, '57014');
      assert.equal((await ledgerState(f)).ledger.length, 0);
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1)', [key]); lock.release();
      outcomes = await Promise.all(requests);
      await db.query('DROP TRIGGER fixture_pause_award ON transactions; DROP FUNCTION fixture_pause_award()');
    }
    assert.equal(outcomes.length, 4);
    const successes = outcomes.filter(value => value.status === 'fulfilled').map(value => value.value);
    assert.equal(successes.length, 3); assert.equal(new Set(successes.map(value => value.transactionId)).size, 1);
    assert.equal(successes.filter(value => value.replay).length, 2);
    const final = await ledgerState(f);
    assert.equal(final.ledger.length, 1); assert.equal(final.ledger[0].id, successes[0].transactionId);
    assert.deepEqual(final.balance, { points: 10, pending_points: 0, lifetime_points: 10 });
    return { overlappingRequests: 4, cancelledWriters: 1, successfulRequests: 3, replayedRequests: 2, ledgerRows: 1, points: 10 };
  });
});
