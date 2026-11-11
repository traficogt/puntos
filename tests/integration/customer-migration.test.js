import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, describe, it } from 'node:test';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { runWithDbContext } from '../../src/app/database.js';
import { CustomerRepo } from '../../src/app/repositories/customer-repository.js';
import { VerifyCodeRepo } from '../../src/app/repositories/verify-code-repository.js';
import { verifyJoinCodeWithDeps } from '../../src/app/services/customer-service.js';

const databaseUrl = process.env.CUSTOMER_MIGRATION_TEST_DB_URL;
const integration = databaseUrl ? describe : describe.skip;
const businessId = randomUUID(), otherBusiness = randomUUID(), staffId = randomUUID();
const columns = { phone: 'Teléfono', name: 'Nombre', points: 'Saldo' };
const csv = 'Teléfono,Nombre,Saldo\n55550001,Ana,100\n55550002,Beto,0';
let db, migration;
const scoped = tenantId => async fn => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE migration_launch_tenant');
    await client.query("SELECT set_config('app.current_tenant',$1,true)", [tenantId]);
    const result = await runWithDbContext({ client, tenantId, platformAdmin: false }, () => fn(client));
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
};
const deps = (tenantId = businessId) => ({ transaction: scoped(tenantId), query: (sql, values) => scoped(tenantId)(client => client.query(sql, values)) });
const input = (extra = {}) => ({ businessId, staffId, requestId: randomUUID(), label: 'Saldo anterior', csv, columns, existingPolicy: 'skip', confirmed: true, ...extra });
const commit = (extra = {}, dependencies = deps()) => {
  assert.equal(typeof migration.commitCustomerMigration, 'function', 'Atomic customer migration service must exist');
  return migration.commitCustomerMigration(input(extra), dependencies);
};

integration('customer migration against restricted tenant role in disposable PostgreSQL', () => {
  before(async () => {
    const url = new URL(databaseUrl);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/migration_launch_test');
    db = new pg.Pool({ connectionString: databaseUrl });
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    // Fixed repository fixtures; the database guard above prevents production execution.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await db.query(await readFile(new URL('../fixtures/customer-migration.sql', import.meta.url), 'utf8'));
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await db.query(await readFile(new URL('../../src/app/migrations/2026-11-10-customer-migration.sql', import.meta.url), 'utf8'));
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await db.query(await readFile(new URL('../../src/app/migrations/2026-11-10-merchant-pilots.sql', import.meta.url), 'utf8'));
    await db.query('GRANT SELECT,INSERT ON customer_migration_batches TO migration_launch_tenant; GRANT SELECT ON merchant_pilots,merchant_pilot_checks TO migration_launch_tenant');
    migration = await import('../../src/app/services/customer-migration-service.js');
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    await db.query('TRUNCATE businesses,staff_users,customers,customer_balances,transactions,audit_logs,verify_codes,ledger_balance_adjustments,customer_marketing_preferences,branches,rewards,redemptions,customer_ltv CASCADE');
    await db.query('INSERT INTO businesses VALUES($1),($2)', [businessId, otherBusiness]);
    await db.query('INSERT INTO staff_users VALUES($1,$2)', [staffId, businessId]);
  });

  it('imports one atomic opening ledger entry per new customer and exactly reconciles posted/lifetime/pending totals', async () => {
    const { batch } = await commit();
    assert.equal(batch.imported_count, 2);
    assert.equal(batch.opening_points, 100);
    assert.equal(batch.skipped_count, 0);
    const rows = (await db.query(`SELECT c.*,b.points,b.pending_points,b.lifetime_points,t.type,t.source,t.status,t.amount_q,t.visits,t.items,t.meta
      FROM customers c JOIN customer_balances b ON b.customer_id=c.id JOIN transactions t ON t.customer_id=c.id ORDER BY c.phone`)).rows;
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.ok(row.imported_at);
      assert.equal(row.last_visit_at, null);
      assert.equal(row.type, 'OPENING_BALANCE');
      assert.equal(row.source, 'migration');
      assert.equal(row.status, 'POSTED');
      assert.equal(Number(row.amount_q), 0);
      assert.equal(row.visits + row.items + row.pending_points, 0);
      assert.equal(row.points, row.lifetime_points);
      assert.equal(row.meta.migration_batch_id, batch.id);
    }
    const reconciliation = (await db.query(`SELECT c.id FROM customers c JOIN customer_balances b ON b.customer_id=c.id
      LEFT JOIN LATERAL(SELECT COALESCE(SUM(points) FILTER(WHERE status='POSTED'),0) AS posted,
      COALESCE(SUM(points) FILTER(WHERE status='PENDING'),0) AS pending,
      COALESCE(SUM(points) FILTER(WHERE status='POSTED' AND points>0),0) AS lifetime FROM transactions WHERE customer_id=c.id) t ON true
      WHERE b.points<>t.posted OR b.pending_points<>t.pending OR b.lifetime_points<>t.lifetime`)).rows;
    assert.deepEqual(reconciliation, []);
    const audit = (await db.query('SELECT * FROM audit_logs')).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].meta.opening_points, 100);
    assert.ok(!JSON.stringify(audit[0].meta).includes('55550001'));
    assert.equal((await db.query('SELECT * FROM customer_marketing_preferences')).rowCount, 0);
  });

  it('preview is bounded and read-only; normalized existing and deleted identities are never overwritten', async () => {
    await commit();
    await db.query("UPDATE customers SET deleted_at=now() WHERE phone='50255550002'");
    const preview = await migration.previewCustomerMigration(input({ csv: csv.replace('100', '200') }), deps());
    assert.equal(preview.summary.existing_customers, 2);
    assert.equal(preview.summary.opening_points, 0);
    assert.equal(preview.can_commit, true);
    const result = await commit({ csv: csv.replace('100', '200') });
    assert.equal(result.batch.imported_count, 0);
    assert.equal(result.batch.skipped_count, 2);
    assert.equal((await db.query('SELECT SUM(points)::int AS n FROM customer_balances')).rows[0].n, 100);
    assert.equal((await db.query('SELECT * FROM transactions')).rowCount, 2);
    await assert.rejects(commit({ existingPolicy: 'reject' }), { statusCode: 409 });
  });

  it('revalidates the complete submitted CSV and rolls the entire batch back on invalid rows or conflicting existing identities', async () => {
    const preview = await migration.previewCustomerMigration(input(), deps());
    assert.equal(preview.summary.new_customers, 2);
    await assert.rejects(commit({ csv: csv + '\n55550003,Carlos,-1' }), { statusCode: 400 });
    await assert.rejects(commit({ csv: csv + '\n50255550001,Dora,5' }), { statusCode: 400 });
    await assert.rejects(commit({ confirmed: false }), { statusCode: 400 });
    assert.equal((await db.query('SELECT * FROM customers')).rowCount, 0);
    await commit({ csv: 'Teléfono,Nombre,Saldo\n55550002,Existente,5' });
    await assert.rejects(commit({ existingPolicy: 'reject' }), { statusCode: 409 });
    assert.equal((await db.query('SELECT * FROM customers')).rowCount, 1);
  });

  it('rolls back customer, balance, ledger and batch if the audit write fails', async () => {
    await db.query("ALTER TABLE audit_logs ADD CONSTRAINT reject_migration_audit CHECK(action <> 'CUSTOMER_MIGRATION_COMMITTED')");
    try {
      await assert.rejects(commit());
      for (const table of ['customers', 'customer_balances', 'transactions', 'customer_migration_batches']) {
        assert.equal((await db.query(`SELECT * FROM ${table}`)).rowCount, 0);
      }
    } finally { await db.query('ALTER TABLE audit_logs DROP CONSTRAINT reject_migration_audit'); }
  });

  it('durably replays identical retries and rejects a changed payload for the same request key', async () => {
    const requestId = randomUUID();
    const first = await commit({ requestId });
    await db.query("UPDATE customers SET deleted_at=now() WHERE phone='50255550001'");
    assert.deepEqual(await commit({ requestId }), first);
    await assert.rejects(commit({ requestId, csv: csv.replace('100', '101') }), { statusCode: 409 });
    assert.equal((await db.query('SELECT * FROM audit_logs')).rowCount, 1);
  });

  it('serializes duplicate and distinct concurrent batch keys without double credit', async () => {
    const requestId = randomUUID();
    const repeated = await Promise.all([commit({ requestId }), commit({ requestId })]);
    assert.deepEqual(repeated[0], repeated[1]);
    const results = await Promise.all([commit(), commit()]);
    assert.ok(results.every(result => result.batch.imported_count === 0));
    assert.equal((await db.query('SELECT * FROM transactions')).rowCount, 2);
    assert.equal((await db.query('SELECT SUM(points)::int AS n FROM customer_balances')).rows[0].n, 100);
  });

  it('only one of two simultaneous new batches can claim the same phones', async () => {
    const results = await Promise.all([commit(), commit()]);
    assert.equal(results.reduce((sum, result) => sum + result.batch.imported_count, 0), 2);
    assert.equal(results.reduce((sum, result) => sum + result.batch.skipped_count, 0), 2);
    assert.equal((await db.query('SELECT * FROM transactions')).rowCount, 2);
  });

  it('waits for concurrent enrollment and keeps the enrolled customer balance untouched', async () => {
    let ready = () => {};
    const locked = new Promise(resolve => { ready = () => resolve(undefined); });
    let release = () => {};
    const proceed = new Promise(resolve => { release = () => resolve(undefined); });
    const enrolling = scoped(businessId)(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [businessId, '50255550001']);
      ready();
      await proceed;
      return CustomerRepo.create({ id: randomUUID(), business_id: businessId, phone: '50255550001', name: 'Verificado' });
    });
    await locked;
    const importing = commit();
    release();
    const [enrolled, imported] = await Promise.all([enrolling, importing]);
    assert.equal(imported.batch.imported_count, 1);
    assert.equal(imported.batch.skipped_count, 1);
    const customer = (await db.query('SELECT c.*,b.points FROM customers c JOIN customer_balances b ON b.customer_id=c.id WHERE c.id=$1', [enrolled.id])).rows[0];
    assert.equal(customer.name, 'Verificado');
    assert.equal(customer.points, 0);
    assert.equal(customer.imported_at, null);
  });

  it('stores the maximum valid per-customer balance and keeps batch totals outside INT without overflow', async () => {
    const { batch } = await commit({ csv: csv.replace('100', '2147483647').replace('Beto,0', 'Beto,2147483647') });
    assert.equal(batch.opening_points, 4294967294);
    assert.equal((await db.query('SELECT SUM(points)::text AS total FROM customer_balances')).rows[0].total, '4294967294');
  });

  it('excludes opening balances from overview and pilot metrics and imported records from signup counts, but counts later real purchases', async () => {
    await commit();
    await db.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,'50255550009','Alta verificada')", [randomUUID(), businessId]);
    const pilotId = randomUUID();
    await db.query("INSERT INTO merchant_pilots(id,business_id,request_id,name,duration_days,started_at,planned_end_at) VALUES($1,$2,$3,'Piloto',14,now()-interval '1 minute',now()+interval '14 days')", [pilotId, businessId, randomUUID()]);
    const { getPilot } = await import('../../src/app/services/merchant-pilot-service.js');
    const { getMerchantOverview } = await import('../../src/app/services/merchant-overview-service.js');
    const now = new Date(Date.now() + 1000);
    const pilot = () => getPilot({ businessId, pilotId }, { ...deps(), now: () => now });
    const overview = () => getMerchantOverview({ businessId, days: 7, now }, deps().query);
    const first = await pilot();
    assert.equal(first.results.current.new_customers, 1, 'Administrative imports must not be counted as new signups');
    assert.equal(first.results.current.purchases, 0);
    assert.equal(first.results.current.active_customers, 0);
    assert.equal((await overview()).current.purchases, 0);
    const customer = (await db.query("SELECT id FROM customers WHERE phone='50255550001'")).rows[0];
    await db.query("INSERT INTO transactions(id,business_id,customer_id,type,source,amount_q,visits) VALUES($1,$2,$3,'PURCHASE','online',50,1)", [randomUUID(), businessId, customer.id]);
    assert.equal((await pilot()).results.current.purchases, 1);
    const after = await overview();
    assert.equal(after.current.purchases, 1);
    assert.equal(after.current.recorded_sales_q, 50);
    assert.equal(after.current.active_customers, 1);
  });

  it('is tenant isolated under forced RLS and does not expose batch payloads or other-tenant existing phones', async () => {
    await commit();
    const preview = await migration.previewCustomerMigration(input({ businessId: otherBusiness }), deps(otherBusiness));
    assert.equal(preview.summary.new_customers, 2);
    assert.deepEqual(await migration.listCustomerMigrations({ businessId: otherBusiness }, deps(otherBusiness)), { batches: [] });
    await assert.rejects(commit({ businessId: otherBusiness }), /row-level security/);
    const policies = (await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='customer_migration_batches'")).rows[0];
    assert.equal(policies.relrowsecurity && policies.relforcerowsecurity, true);
    await assert.rejects(scoped(otherBusiness)(client => client.query('UPDATE customer_migration_batches SET label=$1', ['bad'])), /permission denied/);
  });

  it('preserves authenticated support impersonation in the atomic audit and opening ledger', async () => {
    await commit({ impersonated_by: 'support@example.test' });
    const audit = (await db.query('SELECT actor_id,meta FROM audit_logs')).rows[0];
    assert.equal(audit.actor_id, staffId);
    assert.equal(audit.meta.impersonated_by_super_admin_email, 'support@example.test');
    const ledger = (await db.query('SELECT meta FROM transactions')).rows;
    assert.ok(ledger.every(row => row.meta.impersonated_by_super_admin_email === 'support@example.test'));
  });

  it('keeps imports out of legacy signup and active-customer metrics until actual activity occurs', async () => {
    await commit();
    const { BusinessRepo } = await import('../../src/app/repositories/business-repository.js');
    const { analyticsDashboardRoutes } = await import('../../src/app/routes/analytics/dashboard.js');
    const handler = analyticsDashboardRoutes.stack.find(layer => layer.route?.path === '/admin/analytics/dashboard').route.stack[0].handle;
    const dashboard = async (branchId = null) => scoped(businessId)(async () => {
      let result;
      await handler(/** @type {any} */ ({ tenantId: businessId, query: branchId ? { branch_id: branchId } : {} }), /** @type {any} */ ({ json: body => { result = body; } }), error => { throw error; });
      return result;
    });
    const active = () => scoped(businessId)(() => BusinessRepo.activeCustomerCount(businessId));
    assert.equal(await active(), 0);
    const initial = await dashboard();
    assert.equal(Number(initial.summary.total_customers), 2, 'Imported cards remain part of the customer base');
    assert.equal(Number(initial.summary.new_customers_30d), 0);
    assert.deepEqual(initial.recent_activity, []);
    const branchId = randomUUID();
    await db.query("INSERT INTO branches VALUES($1,$2,'Central','central')", [branchId, businessId]);
    // Even an imported opening row assigned to a branch is not branch activity.
    await db.query('UPDATE transactions SET branch_id=$1', [branchId]);
    const branch = await dashboard(branchId);
    assert.equal(Number(branch.summary.total_customers), 0);
    assert.equal(Number(branch.summary.new_customers_30d), 0);
    assert.deepEqual(branch.recent_activity, []);
    assert.equal(branch.branch_performance[0].tx_30d, 0);
    const customer = (await db.query("SELECT id FROM customers WHERE phone='50255550001'")).rows[0];
    await db.query('UPDATE customers SET last_visit_at=now() WHERE id=$1', [customer.id]);
    await db.query("INSERT INTO transactions(id,business_id,customer_id,branch_id,type,source,amount_q,visits) VALUES($1,$2,$3,$4,'PURCHASE','online',50,1)", [randomUUID(), businessId, customer.id, branchId]);
    await db.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,'50255550009','Alta verificada')", [randomUUID(), businessId]);
    assert.equal(await active(), 2, 'A recent genuine visit activates an imported customer; a real new signup retains existing behavior');
    const later = await dashboard();
    assert.equal(Number(later.summary.new_customers_30d), 1);
    assert.equal(Number(later.recent_activity[0].transactions), 1);
    assert.equal(Number((await dashboard(branchId)).recent_activity[0].transactions), 1);
  });

  it('claims an imported card only after valid OTP without new-customer rewards or acquisition attribution', async () => {
    await commit();
    const existing = (await db.query("SELECT id FROM customers WHERE phone='50255550001'")).rows[0];
    const codeId = randomUUID();
    await db.query("INSERT INTO verify_codes(id,business_id,phone,code_hash,expires_at) VALUES($1,$2,'50255550001',$3,now()+interval '10 minutes')", [codeId, businessId, await bcrypt.hash('123456', 4)]);
    let signed = 0;
    const attributions = [];
    const authDeps = {
      withDbClientContext: async (_context, fn) => fn(), withTransaction: scoped(businessId), CustomerRepo, VerifyCodeRepo,
      recordAcquisition: async (_client, value) => { attributions.push(value); },
      signCustomerToken: async claims => { signed += 1; return claims.cid; }
    };
    const args = { business: { id: businessId, slug: 'test' }, phone: '50255550001', code: '000000', name: null, referralCode: 'IGNORED', visitToken: 'A'.repeat(43) };
    await assert.rejects(verifyJoinCodeWithDeps(authDeps, args), { statusCode: 401 });
    assert.equal(signed, 0);
    assert.equal(attributions.length, 0);
    const result = await verifyJoinCodeWithDeps(authDeps, { ...args, code: '123456' });
    assert.equal(result.customer.id, existing.id);
    assert.equal(result.customer.points, 100);
    assert.equal(result.token, existing.id);
    assert.equal(signed, 1);
    assert.equal(attributions[0].isNewCustomer, false);
    assert.equal((await db.query('SELECT * FROM transactions')).rowCount, 2);
    await assert.rejects(verifyJoinCodeWithDeps(authDeps, { ...args, code: '123456' }), { statusCode: 400 });
  });
});
