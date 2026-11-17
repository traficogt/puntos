// Ledger reconciliation isolation, purchase statistics and cohort retention
// against a fully migrated disposable PostgreSQL, using a least-privilege
// NOBYPASSRLS runtime role exactly as the application and worker connect.
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { buildGrantPlan } from '../../src/scripts/create-app-role.mjs';

const url = process.env.ANALYTICS_LEDGER_TEST_DB_URL;
const suite = url ? describe : describe.skip;
const role = `analytics_rt_${randomUUID().replaceAll('-', '')}`;
const password = randomBytes(24).toString('hex');
const A = randomUUID(), B = randomUUID(), C = randomUUID(), D = randomUUID();
const ownerA = randomUUID(), secondOwnerA = randomUUID(), managerA = randomUUID(), ownerB = randomUUID(), ownerD = randomUUID();
const a1 = randomUUID(), a2 = randomUUID(), b1 = randomUUID(), b2 = randomUUID(), c1 = randomUUID();
let admin, roleCreated = false, server, origin, platformRunId;
let db, reconcile, corrections, certification, metrics, derived, recompute, health, analytics;

const staff = {
  [ownerA]: { id: ownerA, business_id: A, role: 'OWNER' },
  [secondOwnerA]: { id: secondOwnerA, business_id: A, role: 'OWNER' },
  [managerA]: { id: managerA, business_id: A, role: 'MANAGER' },
  [ownerB]: { id: ownerB, business_id: B, role: 'OWNER' },
  [ownerD]: { id: ownerD, business_id: D, role: 'OWNER' }
};
const asTenant = (tenantId, fn) => db.withDbClientContext({ tenantId, platformAdmin: false }, fn);
const asPlatform = fn => db.withDbClientContext({ tenantId: null, platformAdmin: true }, fn);
const tenantRows = (tenantId, sql, params = []) => asTenant(tenantId, async () => (await db.dbQuery(sql, params)).rows);
async function get(path, staffId) {
  const response = await fetch(`${origin}${path}`, { headers: { 'x-test-staff': staffId } });
  return { status: response.status, body: await response.json() };
}
async function seedBusiness(id, name) {
  await admin.query("INSERT INTO businesses(id,name,slug,email,password_hash,program_type,program_json) VALUES($1,$2,$3,$4,'fixture','SPEND','{\"points_per_q\":1}')",
    [id, name, `analytics-${id}`, `${id}@example.test`]);
}
async function seedCustomer(id, businessId, { points = 0, lifetime = 0, deleted = false } = {}) {
  await admin.query("INSERT INTO customers(id,business_id,phone,name,deleted_at) VALUES($1,$2,$3,'Cliente ficticio',$4)",
    [id, businessId, `502${randomInt(10_000_000, 100_000_000)}`, deleted ? new Date() : null]);
  await admin.query('INSERT INTO customer_balances(customer_id,points,pending_points,lifetime_points) VALUES($1,$2,0,$3) ON CONFLICT(customer_id) DO UPDATE SET points=$2,pending_points=0,lifetime_points=$3',
    [id, points, lifetime]);
}
async function seedTransaction(businessId, customerId, values = {}) {
  const t = { id: randomUUID(), type: 'PURCHASE', source: 'online', status: 'POSTED', points: 0, amount_q: 0, visits: 0, items: 0, created_at: null, original: null, ...values };
  await admin.query(`INSERT INTO transactions(id,business_id,customer_id,type,source,status,points,amount_q,visits,items,created_at,original_transaction_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz,now()),$12)`,
  [t.id, businessId, customerId, t.type, t.source, t.status, t.points, t.amount_q, t.visits, t.items, t.created_at, t.original]);
  return t.id;
}
// Mirrors the refund services: a reversal row, then the original marked reversed.
async function refund(businessId, customerId, originalId) {
  const reversal = await seedTransaction(businessId, customerId, { source: 'reversal', original: originalId });
  await admin.query("UPDATE transactions SET status='REVERSED', reversed_transaction_id=$2 WHERE id=$1", [originalId, reversal]);
}

suite('analytics ledger isolation and purchase analytics with a NOBYPASSRLS runtime role', () => {
  before(async () => {
    const target = new URL(url);
    assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
    assert.equal(target.pathname, '/analytics_ledger_test', 'Dedicated disposable database required');
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    roleCreated = true;
    const plan = buildGrantPlan({ appDbUser: role, dbName: 'analytics_ledger_test' });
    for (const statement of plan.statements) await admin.query(statement);
    await admin.query(plan.grantFunctionsSql);

    for (const [id, name] of [[A, 'Café A'], [B, 'Panadería B'], [C, 'Tienda C'], [D, 'Comedor D']]) await seedBusiness(id, name);
    for (const member of Object.values(staff)) {
      await admin.query("INSERT INTO staff_users(id,business_id,name,role,password_hash) VALUES($1,$2,'Personal ficticio',$3,'fixture')", [member.id, member.business_id, member.role]);
    }
    // a1 and b1/b2 have drifted balances; a2 and c1 match their ledger.
    await seedCustomer(a1, A, { points: 80, lifetime: 80 });
    await seedCustomer(a2, A, { points: 50, lifetime: 50 });
    await seedCustomer(b1, B, { points: 10, lifetime: 10 });
    await seedCustomer(b2, B, { points: 0, lifetime: 0 });
    await seedCustomer(c1, C, { points: 20, lifetime: 20 });
    for (const [businessId, customerId, points] of [[A, a1, 100], [A, a2, 50], [B, b1, 30], [B, b2, 7], [C, c1, 20]]) {
      await seedTransaction(businessId, customerId, { points, amount_q: points, visits: 1 });
    }

    Object.assign(process.env, { DB_USER: role, DB_PASSWORD: password, DB_PASSWORD_FILE: '', DB_MIGRATIONS_USER: role, DB_MIGRATIONS_PASSWORD: password });
    db = await import('../../src/app/database.js');
    reconcile = await import('../../src/app/services/ledger-reconciliation-service.js');
    corrections = await import('../../src/app/services/ledger-correction-service.js');
    certification = await import('../../src/app/services/ledger-certification-service.js');
    metrics = await import('../../src/app/routes/observability-shared.js');
    derived = await import('../../src/app/services/customer-derived-state.js');
    recompute = await import('../../src/scripts/recompute-customer-purchase-stats.mjs');
    health = await import('../../src/app/services/platform-health-service.js');
    ({ AnalyticsRepository: analytics } = await import('../../src/app/repositories/analytics-repository.js'));
    const { default: express } = await import('express');
    const { withPgClient } = await import('../../src/middleware/pg-client.js');
    const { tenantContext } = await import('../../src/middleware/tenant.js');
    const { errorHandler } = await import('../../src/middleware/common.js');
    const { analyticsLedgerRoutes } = await import('../../src/app/routes/analytics/ledger.js');
    const { analyticsAnomalyRoutes } = await import('../../src/app/routes/analytics/anomalies.js');
    const { analyticsCohortRoutes } = await import('../../src/app/routes/analytics/cohorts.js');
    const app = express();
    app.use(withPgClient);
    app.use((req, _res, next) => { req.staff = staff[String(req.get('x-test-staff'))]; next(); });
    app.use('/api/admin/analytics', tenantContext);
    app.use('/api', analyticsLedgerRoutes, analyticsAnomalyRoutes, analyticsCohortRoutes);
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await db?.closeDatabase().catch(() => {});
    if (admin) {
      if (roleCreated) { await admin.query(`DROP OWNED BY ${role}`); await admin.query(`DROP ROLE ${role}`); }
      await admin.end();
    }
  });

  it('forces tenant RLS on every reconciliation and correction table', async () => {
    const actor = (await admin.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=$1', [role])).rows[0];
    assert.deepEqual(actor, { rolsuper: false, rolbypassrls: false });
    for (const table of ['ledger_reconciliation_runs', 'ledger_reconciliation_findings', 'ledger_balance_corrections', 'ledger_balance_adjustments']) {
      const flags = (await admin.query('SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', [table])).rows[0];
      assert.deepEqual(flags, { relrowsecurity: true, relforcerowsecurity: true }, table);
    }
  });

  it('reconciles each business under its own tenant context and hides platform-wide runs from tenants', async () => {
    for (const businessId of [A, B, C]) {
      const out = await asTenant(businessId, () => reconcile.runLedgerReconciliation({ businessId, persist: true }));
      assert.equal(out.scope, 'business');
    }
    // An operator platform-wide run (business_id NULL) completes after the tenant runs.
    platformRunId = (await asPlatform(() => reconcile.runLedgerReconciliation({ persist: true }))).runId;
    const platformRun = (await admin.query('SELECT business_id, mismatched_customers FROM ledger_reconciliation_runs WHERE id=$1', [platformRunId])).rows[0];
    assert.deepEqual(platformRun, { business_id: null, mismatched_customers: 3 });

    const runsA = await tenantRows(A, 'SELECT business_id, scope, checked_customers, mismatched_customers FROM ledger_reconciliation_runs');
    assert.deepEqual(runsA, [{ business_id: A, scope: 'business', checked_customers: 2, mismatched_customers: 1 }]);
    assert.deepEqual((await tenantRows(A, 'SELECT DISTINCT business_id FROM ledger_reconciliation_findings')).map(row => row.business_id), [A]);
    assert.equal((await db.dbQuery('SELECT count(*)::int AS n FROM ledger_reconciliation_runs')).rows[0].n, 0, 'no context sees no runs');
    assert.equal((await asPlatform(async () => (await db.dbQuery('SELECT count(*)::int AS n FROM ledger_reconciliation_runs')).rows[0].n)), 4);
    await assert.rejects(
      asTenant(A, () => db.dbQuery("INSERT INTO ledger_reconciliation_runs(id,scope,status,business_id) VALUES($1,'business','COMPLETED',$2)", [randomUUID(), B])),
      { code: '42501' }
    );
  });

  it('returns only the owner business runs, totals and findings with computed deltas', async () => {
    // A later single-customer operator check must not stand in for the business run.
    const single = await asTenant(A, () => reconcile.runLedgerReconciliation({ businessId: A, customerId: a2, persist: true }));
    assert.equal(single.scope, 'customer');
    const forA = await get('/api/admin/analytics/ledger-reconciliation', ownerA);
    assert.equal(forA.status, 200, JSON.stringify(forA.body));
    assert.equal(forA.body.latest_run.scope, 'business');
    assert.equal(forA.body.latest_run.checked_customers, 2);
    assert.equal(forA.body.latest_run.mismatched_customers, 1);
    assert.equal(forA.body.recent_runs.length, 1);
    assert.equal(forA.body.latest_findings.length, 1);
    assert.deepEqual(
      { ...forA.body.latest_findings[0], created_at: undefined },
      { customer_id: a1, business_id: A, stored_points: 80, expected_points: 100, stored_pending_points: 0, expected_pending_points: 0,
        stored_lifetime_points: 80, expected_lifetime_points: 100, delta_points: 20, delta_pending_points: 0, delta_lifetime_points: 20,
        repaired: false, created_at: undefined }
    );
    const forB = await get('/api/admin/analytics/ledger-reconciliation', ownerB);
    assert.equal(forB.status, 200);
    assert.equal(forB.body.latest_run.mismatched_customers, 2);
    assert.deepEqual(forB.body.latest_findings.map(row => row.customer_id).sort(), [b1, b2].sort());
    assert.equal(JSON.stringify(forB.body).includes(a1), false);
    assert.equal((await get('/api/admin/analytics/ledger-reconciliation', managerA)).status, 403);
  });

  it('scopes anomaly and certification mismatch counts to the business', async () => {
    const anomalies = await get('/api/admin/analytics/anomalies', ownerA);
    assert.equal(anomalies.status, 200, JSON.stringify(anomalies.body));
    assert.equal(anomalies.body.summary.latest_reconciliation_mismatches, 1);
    // Operator certification runs as platform admin and can see the platform-wide run.
    const clean = await asPlatform(() => certification.readLedgerCertificationReport(C, '2026-11-01', '2026-11-02'));
    assert.equal(clean.summary.latest_reconciliation_mismatches, 0);
    assert.equal(clean.certification_status, 'OK');
    const drifted = await asTenant(B, () => certification.readLedgerCertificationReport(B, '2026-11-01', '2026-11-02'));
    assert.equal(drifted.business.name, 'Panadería B');
    assert.equal(drifted.summary.latest_reconciliation_mismatches, 2);
    assert.equal(drifted.certification_status, 'REVIEW_REQUIRED');
    // Daily rows carry ISO dates, not a truncated JS Date string such as "Mon Nov 01".
    assert.deepEqual(drifted.daily_rows.map(row => row.date), ['2026-11-01', '2026-11-02']);
  });

  it('keeps operator ledger gauges cross-business under RLS without a tenant context', async () => {
    const lines = [];
    await metrics.appendSharedMetrics(lines);
    const value = name => Number(lines.find(line => line.startsWith(`${name} `))?.split(' ')[1]);
    assert.ok(value('puntos_ledger_reconciliation_last_completed_timestamp') > 0);
    assert.equal(value('puntos_ledger_reconciliation_checked_customers_total'), 5);
    assert.equal(value('puntos_ledger_reconciliation_mismatched_customers_total'), 3);
    assert.equal(value('puntos_pending_ledger_corrections_total'), 0);
  });

  it('reads every operator gauge across businesses under RLS without a tenant context', async () => {
    const endpoint = randomUUID();
    await admin.query("INSERT INTO webhook_endpoints(id,business_id,url,secret) VALUES($1,$2,'https://hooks.example.test/pf','fixture')", [endpoint, B]);
    await admin.query("INSERT INTO webhook_deliveries(id,endpoint_id,event,payload,status) VALUES($1,$2,'points.awarded','{}','FAILED')", [randomUUID(), endpoint]);
    await admin.query(`INSERT INTO payment_webhook_events(id,provider,provider_event_id,business_id,status,created_at)
      VALUES($1,'fixture','evt-metrics',$2,'PENDING_MAPPING',now() - interval '10 minutes')`, [randomUUID(), C]);
    await admin.query("INSERT INTO billing_events(id,business_id,event_type) VALUES($1,$2,'message.failed')", [randomUUID(), A]);
    await admin.query(`INSERT INTO background_jobs(id,business_id,job_type,status,run_after,completed_at)
      VALUES($1,$2,'fixture','QUEUED',now() - interval '10 minutes',NULL),($3,$4,'fixture','FAILED',now(),now())`, [randomUUID(), A, randomUUID(), B]);
    await admin.query("INSERT INTO message_logs(id,business_id,channel,to_addr,body,status) VALUES($1,$2,'CHURN','50200000000','Mensaje ficticio','SENT')", [randomUUID(), D]);

    const lines = [];
    await metrics.appendSharedMetrics(lines);
    await metrics.appendBillingMetrics(lines);
    await metrics.appendBackgroundJobMetrics(lines);
    const value = series => Number(lines.find(line => line.startsWith(`${series} `))?.slice(series.length + 1));
    // Seeded across businesses A, B and C; the runtime role reads them only as platform admin.
    assert.equal(value('puntos_table_rows_customers'), 5);
    assert.equal(value('puntos_table_rows_transactions'), 5);
    assert.equal(value('puntos_customers_total'), 5);
    assert.equal(value('puntos_points_total'), 160);
    assert.equal(value('puntos_negative_balances_total'), 0);
    assert.equal(value('puntos_webhook_deliveries_24h{status="failed"}'), 1);
    assert.equal(value('puntos_payment_webhook_events_24h{status="pending_mapping"}'), 1);
    assert.ok(value('puntos_payment_webhook_pending_mapping_oldest_age_seconds') >= 600);
    assert.equal(value('puntos_billing_events_24h{type="message.failed"}'), 1);
    assert.equal(value('puntos_jobs_total{status="queued"}'), 1);
    assert.equal(value('puntos_jobs_total{status="failed"}'), 1);
    assert.equal(value('puntos_jobs_failed_24h'), 1);
    assert.ok(value('puntos_jobs_oldest_age_seconds') >= 600);
    assert.ok(value('puntos_churn_last_sent_timestamp') > 0);
    // The metrics context does not leak into later queries on this connection pool.
    assert.equal((await db.dbQuery('SELECT count(*)::int AS n FROM customers')).rows[0].n, 0);
  });

  it('rejects correction requests that cite another business run or finding', async () => {
    const runId = async businessId => (await admin.query("SELECT id FROM ledger_reconciliation_runs WHERE business_id=$1 AND scope='business' ORDER BY completed_at LIMIT 1", [businessId])).rows[0].id;
    const findingId = async (run, customerId) => (await admin.query('SELECT id FROM ledger_reconciliation_findings WHERE run_id=$1 AND customer_id=$2', [run, customerId])).rows[0].id;
    const [runA, runB] = [await runId(A), await runId(B)];
    const request = source => asTenant(A, () => corrections.requestLedgerCorrection({
      businessId: A, customerId: a1, requestedByStaffId: ownerA, reason: 'Saldo descuadrado en conciliación', ...source
    }));
    for (const source of [
      { sourceRunId: runB },
      { sourceFindingId: await findingId(runB, b1) },
      { sourceRunId: platformRunId, sourceFindingId: await findingId(platformRunId, b1) },
      // A platform-wide run is cited through this business's own finding only.
      { sourceRunId: platformRunId },
      // The finding must belong to the cited run and the corrected customer.
      { sourceRunId: runA, sourceFindingId: await findingId(platformRunId, a1) }
    ]) {
      await assert.rejects(request(source), { statusCode: 400, message: 'Invalid reconciliation source' }, JSON.stringify(source));
    }
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM ledger_balance_corrections')).rows[0].n, 0);
  });

  it('requests and applies a correction under tenant RLS while other tenants cannot see it', async () => {
    const finding = (await admin.query('SELECT id FROM ledger_reconciliation_findings WHERE run_id=$1 AND customer_id=$2', [platformRunId, a1])).rows[0];
    const requested = await asTenant(A, () => corrections.requestLedgerCorrection({
      businessId: A, customerId: a1, requestedByStaffId: ownerA, reason: 'Saldo descuadrado en conciliación', sourceRunId: platformRunId, sourceFindingId: finding.id
    }));
    assert.equal(requested.correction.delta_points, 20);
    assert.equal((await asTenant(B, () => corrections.listLedgerCorrections({ businessId: A }))).length, 0);
    const lines = [];
    await metrics.appendSharedMetrics(lines);
    assert.ok(lines.includes('puntos_pending_ledger_corrections_total 1'));
    const applied = await asTenant(A, () => corrections.applyLedgerCorrection({ businessId: A, correctionId: requested.correction.id, resolvedByStaffId: secondOwnerA }));
    assert.equal(applied.correction.status, 'APPLIED');
    const after = await asTenant(A, () => reconcile.runLedgerReconciliation({ businessId: A, persist: true }));
    assert.equal(after.mismatchedCustomers, 0);
    const listed = await asTenant(A, () => corrections.listLedgerCorrections({ businessId: A }));
    assert.deepEqual(listed.map(row => row.status), ['APPLIED']);
  });

  it('derives customer value statistics from recorded purchases only', async () => {
    const shopper = randomUUID();
    await seedCustomer(shopper, A, { points: 0 });
    const purchaseAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await seedTransaction(A, shopper, { amount_q: 60, points: 60, visits: 1, created_at: purchaseAt });
    const refunded = await seedTransaction(A, shopper, { amount_q: 500, points: 500, visits: 1, created_at: new Date(Date.now() - 30 * 86_400_000).toISOString() });
    await refund(A, shopper, refunded);
    // Rows that default to type PURCHASE but are not sales.
    await seedTransaction(A, shopper, { source: 'expire', points: -60 });
    await seedTransaction(A, shopper, { source: 'lifecycle', points: 25 });
    await seedTransaction(A, shopper, { source: 'redeem', points: -10 });
    await seedTransaction(A, shopper, { type: 'OPENING_BALANCE', source: 'migration', points: 40 });
    const expected = { total_spend: '60.00', total_visits: 1, total_transactions: 1, avg_transaction_value: '60.00', last_purchase_at: new Date(purchaseAt).toISOString() };
    const read = async () => {
      const row = (await tenantRows(A, 'SELECT total_spend, total_visits, total_transactions, avg_transaction_value, last_purchase_at, churn_risk_score FROM customer_ltv WHERE customer_id=$1', [shopper]))[0];
      return { ...row, last_purchase_at: row.last_purchase_at?.toISOString() ?? null };
    };
    const { churn_risk_score: _triggerChurn, ...fromTrigger } = await read();
    assert.deepEqual(fromTrigger, expected, 'trigger');

    await asTenant(A, () => db.withTransaction(client => derived.refreshCustomerDerivedState(client, shopper)));
    const { churn_risk_score: churn, ...fromService } = await read();
    assert.deepEqual(fromService, expected, 'derived state');
    assert.ok(Number(churn) > 0.2, 'a 40-day absence must not look like a purchase today');

    await admin.query("UPDATE customer_ltv SET last_purchase_at=now(), total_transactions=6, total_spend=999 WHERE customer_id=$1", [shopper]);
    const recomputed = await recompute.recomputeBusinessPurchaseStats(A, { batchSize: 2 });
    assert.equal(recomputed.customers, 3);
    const { churn_risk_score: _recomputedChurn, ...fromScript } = await read();
    assert.deepEqual(fromScript, expected, 'operator recompute');
  });

  it('rebuilds cohorts from recorded purchases and leaves unfinished months empty', async () => {
    const month = offset => `date_trunc('month', now()) - interval '${offset} months' + interval '10 days'`;
    const at = async offset => (await admin.query(`SELECT (${month(offset)})::timestamptz AS at`)).rows[0].at.toISOString();
    const [d1, d2, d3, d4] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const id of [d1, d2, d4]) await seedCustomer(id, D);
    await seedCustomer(d3, D, { deleted: true });
    for (const id of [d1, d2, d3, d4]) await seedTransaction(D, id, { amount_q: 10, visits: 1, created_at: await at(3) });
    await seedTransaction(D, d1, { amount_q: 15, visits: 1, created_at: await at(2) });
    await seedTransaction(D, d3, { amount_q: 15, visits: 1, created_at: await at(2) });
    await refund(D, d2, await seedTransaction(D, d2, { amount_q: 200, visits: 1, created_at: await at(2) }));
    await seedTransaction(D, d1, { source: 'expire', points: -5, created_at: await at(1) });
    // Legacy state: a stale cohort and a second assignment for d4.
    const stale = (await admin.query("INSERT INTO customer_cohorts(business_id,cohort_name,cohort_date,cohort_type,customer_count) VALUES($1,'stale',(date_trunc('month', now()) - interval '5 months')::date,'monthly',9) RETURNING id", [D])).rows[0].id;
    await admin.query('INSERT INTO customer_cohort_assignments(customer_id,cohort_id) VALUES($1,$2)', [d4, stale]);

    await asTenant(D, () => analytics.createCohorts(D, 'monthly'));
    await asTenant(D, () => analytics.createCohorts(D, 'monthly'));
    const cohorts = (await admin.query("SELECT customer_count FROM customer_cohorts WHERE business_id=$1 AND cohort_type='monthly'", [D])).rows;
    assert.deepEqual(cohorts, [{ customer_count: 3 }]);
    const assignments = (await admin.query('SELECT a.customer_id, count(*)::int AS n FROM customer_cohort_assignments a JOIN customers c ON c.id=a.customer_id WHERE c.business_id=$1 GROUP BY 1', [D])).rows;
    assert.deepEqual(assignments.map(row => row.n), [1, 1, 1]);
    assert.equal(assignments.some(row => row.customer_id === d3), false);

    // The later expiry and reversal rows are not the business's latest purchase.
    const report = await asPlatform(() => health.getPlatformOperationsHealth({ limit: 10, offset: 0 }));
    assert.equal(new Date(report.businesses.find(business => business.id === D).last_purchase_at).toISOString(), await at(2));

    const out = await get('/api/admin/analytics/cohorts?months=5', ownerD);
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const rows = out.body.cohorts.map(row => ({ size: row.cohort_size, month: row.month_number, active: row.active_customers, rate: row.retention_rate, revenue: row.revenue }));
    assert.deepEqual(rows, [
      { size: 3, month: 0, active: '3', rate: '100.00', revenue: '30.00' },
      { size: 3, month: 1, active: '1', rate: '33.33', revenue: '15.00' },
      { size: 3, month: 2, active: '0', rate: '0.00', revenue: '0' },
      { size: 3, month: 3, active: null, rate: null, revenue: null },
      { size: 3, month: 4, active: null, rate: null, revenue: null },
      { size: 3, month: 5, active: null, rate: null, revenue: null }
    ]);
  });
});
