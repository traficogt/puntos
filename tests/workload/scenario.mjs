// Private entrypoint: invoke through run-workload-isolated.mjs, never against an existing stack.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { runCommand } from '../../src/scripts/run-domain-integration-isolated.mjs';
import { assertFixtureState, parseWorkloadOptions, startResponseDropProxy, summarizeMeasurements } from '../../src/scripts/workload-lib.mjs';

assert.equal(process.env.PF_DISPOSABLE_WORKLOAD, '1', 'Use the isolated workload launcher');
assert.ok(existsSync('/.dockerenv') && process.cwd() === '/work', 'Requires the disposable runner container');
assert.equal(process.env.NODE_ENV, 'development');
assert.equal(process.env.DB_HOST, 'db'); assert.equal(process.env.DB_NAME, 'workload_test');
assert.equal(process.env.DB_USER, 'workload_app'); assert.equal(process.env.MESSAGE_PROVIDER, 'dev');
assert.equal(process.env.IN_PROCESS_WORKERS, 'false');

const options = parseWorkloadOptions(process.argv.slice(2));
const origin = 'http://127.0.0.1:3001';
const keys = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
process.env.QR_PRIVATE_KEY_PEM = keys.privateKey;
process.env.QR_PUBLIC_KEY_PEM = keys.publicKey;
const db = new pg.Client({ host: 'db', port: 5432, database: 'workload_test', user: 'postgres', password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 5000, statement_timeout: 10000 });
/** @type {import('../../src/scripts/workload-lib.mjs').Measurement[]} */
const measurements = [];
const report = { version: 1, options, correctness: { ok: false, checks: [] },
  recovery: { ok: false, droppedResponse: false, restarted: false, replay: false, restartReadyMs: 0 },
  performance: { ok: false, maxP95Ms: options.maxP95Ms, requests: [] }, counts: {} };
const businessId = randomUUID(), customerId = randomUUID(), staffId = randomUUID();
const purchaseIds = [], refunds = [];
const readLabels = ['customer-profile', 'customer-history', 'merchant-profile', 'merchant-program'];
let api, apiOutput = '', closeDatabase = async () => {};

async function runSetup(path, env) {
  const result = await runCommand(process.execPath, [path, ...(path.endsWith('migrations.mjs') ? ['apply'] : [])], {
    cwd: '/work', env, timeoutMs: 180000
  });
  assert.equal(result.code, 0, `Fixture setup failed: ${result.output.slice(-8000)}`);
}

async function startApi() {
  api = spawn(process.execPath, ['src/app/server.js'], { cwd: '/work', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  api.on('error', error => { apiOutput += error.message; });
  for (const stream of [api.stdout, api.stderr]) stream.on('data', chunk => { apiOutput = (apiOutput + chunk).slice(-12000); });
  const started = performance.now();
  for (let i = 0; i < 100; i++) {
    assert.equal(api.exitCode, null, `API exited: ${apiOutput}`);
    try { const response = await fetch(`${origin}/api/ready`, { signal: AbortSignal.timeout(1000) }); await response.text();
      if (response.ok) return performance.now() - started; } catch { /* Waiting for this child only. */ }
    await delay(100);
  }
  throw new Error(`Disposable API did not become ready: ${apiOutput}`);
}

async function stopApi(signal = 'SIGTERM') {
  if (!api?.pid || api.exitCode !== null || api.signalCode !== null) return;
  const exited = once(api, 'exit'); api.kill(signal);
  const forced = setTimeout(() => api.kill('SIGKILL'), 3000);
  try { await exited; } finally { clearTimeout(forced); }
}

function client(cookieName, token) {
  const jar = new Map([[cookieName, token]]);
  return async (path, { label = 'setup', body = undefined, validate = data => assert.equal(data.ok, true), baseUrl = origin, interrupt = false } = {}) => {
    const started = performance.now();
    let outcome = /** @type {'ok'|'error'|'interrupted'} */ ('error');
    try {
      const response = await fetch(`${baseUrl}${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(6000),
        headers: { cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '),
          origin, 'content-type': 'application/json', 'x-csrf-token': jar.get('pf_csrf_readable') || '' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      for (const raw of response.headers.getSetCookie()) { const pair = raw.split(';', 1)[0]; const equals = pair.indexOf('='); jar.set(pair.slice(0, equals), pair.slice(equals + 1)); }
      const data = await response.json();
      assert.equal(response.status, 200, `${path}: ${JSON.stringify(data)}`);
      assert.ok(!interrupt, 'Fault proxy unexpectedly delivered the response');
      validate(data); outcome = 'ok'; return data;
    } catch (error) {
      if (interrupt && error instanceof TypeError && error.cause && typeof error.cause === 'object' &&
        'code' in error.cause && error.cause.code === 'UND_ERR_SOCKET') { outcome = 'interrupted'; return null; }
      throw error;
    } finally {
      if (label !== 'setup') measurements.push({ label, outcome, durationMs: performance.now() - started });
    }
  };
}

async function checkState(stage) {
  const transactions = (await db.query('SELECT * FROM transactions WHERE customer_id=$1 ORDER BY created_at,id', [customerId])).rows;
  const balance = (await db.query('SELECT * FROM customer_balances WHERE customer_id=$1', [customerId])).rows[0];
  assertFixtureState({ transactions, balance }, { purchaseIds, refunds });
  report.correctness.checks.push({ stage, purchases: purchaseIds.length, refunds: refunds.length,
    transactions: transactions.length, points: Number(balance.points), pendingPoints: Number(balance.pending_points), lifetimePoints: Number(balance.lifetime_points) });
}

async function main() {
  try {
    await runSetup('src/scripts/migrations.mjs', { ...process.env, NODE_ENV: 'test', DB_USER: 'postgres', AUTO_APPLY_MIGRATIONS: 'true', AUTO_APPLY_SCHEMA_EXTENSIONS: 'true' });
    await runSetup('src/scripts/create-app-role.mjs', { ...process.env, APP_DB_USER: 'workload_app', APP_DB_PASSWORD: process.env.DB_PASSWORD });
    await db.connect();
    // Same fictional VISIT program and data shape as service-completion fixtures; no provider/customer enrollment.
    await db.query(`INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_type,program_json)
      VALUES($1,'Disposable workload cafe','workload-cafe','owner@example.invalid','fixture','EMPRESA','VISIT','{"points_per_visit":10}')`, [businessId]);
    await db.query(`INSERT INTO staff_users(id,business_id,name,email,password_hash,role) VALUES($1,$2,'Fictional owner','owner@example.invalid','fixture','OWNER')`, [staffId, businessId]);
    await db.query(`INSERT INTO customers(id,business_id,name,phone) VALUES($1,$2,'Fictional workload customer','fixture-workload-customer')`, [customerId, businessId]);
    await db.query('INSERT INTO customer_balances(customer_id,points) VALUES($1,0) ON CONFLICT(customer_id) DO NOTHING', [customerId]);
    const { createBrowserSession } = await import('../../src/app/services/auth-session-service.js');
    ({ closeDatabase } = await import('../../src/app/database.js'));
    const ownerSession = await createBrowserSession({ actorType: 'STAFF', actorId: staffId, businessId, role: 'OWNER' }, db.query.bind(db));
    const customerSession = await createBrowserSession({ actorType: 'CUSTOMER', actorId: customerId, businessId }, db.query.bind(db));
    const owner = client('pf_staff', ownerSession.token), customer = client('pf_customer', customerSession.token);
    await startApi();
    await owner('/api/staff/me'); await customer('/api/customer/me');
    await checkState('initial');
    const assertProfile = points => data => { assert.equal(data.customer.id, customerId); assert.equal(data.business.id, businessId); assert.equal(Number(data.customer.points), points); };
    const reads = [
      () => customer('/api/customer/me', { label: 'customer-profile', validate: data => { assert.equal(data.customer.id, customerId); assert.equal(data.business.id, businessId); assert.ok(Number.isFinite(Number(data.customer.points))); } }),
      () => customer('/api/customer/history', { label: 'customer-history', validate: data => { assert.equal(data.ok, true); assert.ok(Array.isArray(data.transactions)); assert.ok(data.transactions.every(row => row.customer_id === customerId)); } }),
      () => owner('/api/staff/me', { label: 'merchant-profile', validate: data => { assert.equal(data.staff.id, staffId); assert.equal(data.staff.business_id, businessId); } }),
      () => owner('/api/admin/program', { label: 'merchant-program', validate: data => { assert.equal(data.program_type, 'VISIT'); assert.equal(data.program_json.points_per_visit, 10); } })
    ];
    let cursor = 0;
    async function readWorker() { while (cursor < options.reads) await reads[cursor++ % reads.length](); }
    async function awardBody() {
      const qr = await customer('/api/public/customer/qr', { body: {}, label: 'customer-qr', validate: data => assert.equal(typeof data.token, 'string') });
      return { customerQrToken: qr.token, amount_q: 50, visits: 1, txId: randomUUID() };
    }
    async function purchases() {
      for (let i = 0; i < options.purchases; i++) {
        const body = await awardBody();
        const first = await owner('/api/staff/award', { body, label: 'purchase' });
        assert.equal(first.transactionId, body.txId); assert.equal(Number(first.pointsAwarded), 10);
        purchaseIds.push(body.txId);
        const retried = await owner('/api/staff/award', { body, label: 'purchase-retry' });
        assert.equal(retried.replay, true); assert.equal(retried.transactionId, first.transactionId);
        await checkState(`purchase-${i + 1}-retry`);
      }
    }
    // Reads overlap the supported purchase/retry workflow, bounded by a small worker pool.
    const concurrent = await Promise.allSettled([...Array.from({ length: options.concurrency }, readWorker), purchases()]);
    for (const result of concurrent) if (result.status === 'rejected') throw result.reason;
    await customer('/api/customer/me', { label: 'customer-profile-check', validate: assertProfile(purchaseIds.length * 10) });

    const body = await awardBody();
    const proxy = await startResponseDropProxy(origin);
    try {
      await owner('/api/staff/award', { body, label: 'recovery-interrupted', baseUrl: proxy.url, interrupt: true });
      const observed = await proxy.observed;
      assert.equal(observed.status, 200); assert.equal(observed.body.transactionId, body.txId);
      purchaseIds.push(body.txId); report.recovery.droppedResponse = true;
    } finally { await proxy.close(); }
    await checkState('response-lost-after-commit');
    await stopApi('SIGKILL'); report.recovery.restarted = true;
    report.recovery.restartReadyMs = Number((await startApi()).toFixed(2));
    const recovered = await owner('/api/staff/award', { body, label: 'recovery-retry' });
    assert.equal(recovered.replay, true); assert.equal(recovered.transactionId, body.txId);
    report.recovery.replay = true;
    await checkState('restart-retry');
    await customer('/api/customer/me', { label: 'customer-profile-check', validate: assertProfile(purchaseIds.length * 10) });
    report.recovery.ok = true;

    for (const transactionId of purchaseIds) {
      const refund = { transactionId, requestId: randomUUID(), reason: 'Disposable workload refund' };
      const first = await owner('/api/staff/refund', { body: refund, label: 'refund' });
      refunds.push(refund);
      const retried = await owner('/api/staff/refund', { body: refund, label: 'refund-retry' });
      assert.equal(retried.replay, true); assert.equal(retried.reversalTransactionId, first.reversalTransactionId);
      await checkState(`refund-${refunds.length}-retry`);
    }
    await customer('/api/customer/me', { label: 'customer-profile-check', validate: assertProfile(0) });
    await customer('/api/customer/history', { label: 'customer-history-check', validate: data => {
      assert.equal(data.transactions.length, purchaseIds.length * 2);
      assert.deepEqual(new Set(data.transactions.filter(row => row.source === 'online').map(row => row.id)), new Set(purchaseIds));
    } });
    assert.equal(measurements.filter(row => readLabels.includes(row.label)).length, options.reads);
    assert.equal(measurements.filter(row => row.outcome === 'error').length, 0);
    assert.equal(measurements.filter(row => row.outcome === 'interrupted').length, 1);
    report.correctness.ok = true;
  } catch (error) {
    report.correctness.error = error.message;
    console.error(`[workload] Scenario failed: ${error.message}`);
    if (apiOutput) console.error(apiOutput);
  } finally {
    report.counts = { purchases: purchaseIds.length, refunds: refunds.length,
      transactionsAtLastCheck: report.correctness.checks.at(-1)?.transactions ?? null,
      reads: measurements.filter(row => readLabels.includes(row.label)).length, requests: measurements.length,
      unexpectedErrors: measurements.filter(row => row.outcome === 'error').length,
      interruptedResponses: measurements.filter(row => row.outcome === 'interrupted').length };
    await stopApi(); await db.end(); await closeDatabase();
    report.performance.requests = summarizeMeasurements(measurements);
    const normal = report.performance.requests.filter(row => row.interrupted === 0);
    report.performance.ok = normal.length > 0 && normal.every(row => row.errors === 0 && row.p95Ms <= options.maxP95Ms);
    console.log(`WORKLOAD_REPORT ${JSON.stringify(report)}`);
  }
  process.exitCode = report.correctness.ok && report.recovery.ok && report.performance.ok ? 0 : 1;
}
await main();
