import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';

const url = process.env.ADMIN_INTEGRITY_TEST_DB_URL, suite = url ? describe : describe.skip;
const bid = randomUUID(), other = randomUUID(), ownerId = randomUUID(), branchId = randomUUID(), customerId = randomUUID();
const owner = { id: ownerId, business_id: bid, role: 'OWNER', branch_id: null };
let db, database, routes;

/** Runs the final handler of an Express route with a minimal request and response. */
async function call(router, path, method, req, context = { tenantId: bid, platformAdmin: false }) {
  // Express exposes these runtime route fields without typing its test doubles.
  const layers = /** @type {any[]} */ (router.stack);
  const layer = layers.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, setHeader(key, value) { this.headers[key] = value; } };
  const request = { tenantId: bid, staff: owner, params: {}, query: {}, body: {}, ip: '127.0.0.1', get: () => 'admin-integrity-test', headers: { 'user-agent': 'admin-integrity-test' }, ...req };
  await database.withDbClientContext(context, () => new Promise((resolve, reject) => {
    Promise.resolve(layer.route.stack.at(-1).handle(request, res, error => (error ? reject(error) : resolve(undefined)))).then(resolve, reject);
  }));
  return res;
}
const audits = action => db.query('SELECT business_id,actor_type,actor_id,meta FROM audit_logs WHERE action=$1 ORDER BY created_at', [action]).then(r => r.rows);
const purchase = (amount, extra = {}) => db.query(
  `INSERT INTO transactions(id,business_id,branch_id,customer_id,type,source,status,amount_q,points,visits,items,original_transaction_id,reversed_transaction_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12) RETURNING id`,
  [extra.id ?? randomUUID(), bid, branchId, customerId, extra.type ?? 'PURCHASE', extra.source ?? 'online', extra.status ?? 'POSTED', amount, extra.points ?? 1,
    extra.visits ?? 1, extra.original ?? null, extra.reversed ?? null]).then(r => r.rows[0].id);

suite('admin workspace integrity against an isolated migrated PostgreSQL', () => {
  before(async () => {
    const parsed = new URL(url);
    assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname));
    assert.equal(parsed.pathname, '/admin_integrity_test');
    db = new pg.Client({ connectionString: url });
    await db.connect();
    database = await import('../../src/app/database.js');
    routes = {
      staff: (await import('../../src/app/routes/admin/staff.js')).adminStaffRoutes,
      rewards: (await import('../../src/app/routes/admin/rewards.js')).adminRewardsRoutes,
      branches: (await import('../../src/app/routes/admin/branches.js')).adminBranchRoutes,
      customers: await import('../../src/app/routes/admin/customers.js'),
      billing: (await import('../../src/app/routes/admin/billing.js')).adminBillingRoutes,
      insights: (await import('../../src/app/routes/admin/insights.js')).adminInsightsRoutes,
      dashboard: (await import('../../src/app/routes/analytics/dashboard.js')).analyticsDashboardRoutes,
      superRoutes: (await import('../../src/app/routes/super-routes.js')).superRoutes,
      superSupport: await import('../../src/app/routes/super-support.js'),
      business: await import('../../src/app/services/business-service.js')
    };
    await db.query(`INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_type,program_json)
      VALUES($1,'Integridad','integridad-a','integridad-a@example.test','unused','NEGOCIO','SPEND','{"points_per_q":0.1,"region":{"country":"CO","currency":"COP","timezone":"America/Bogota"}}'),
            ($2,'Otro negocio','integridad-b','integridad-b@example.test','unused','NEGOCIO','SPEND','{}')`, [bid, other]);
    await db.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$2,'Centro','integridad-a-main')", [branchId, bid]);
    await db.query("INSERT INTO staff_users(id,business_id,name,email,role,password_hash) VALUES($1,$2,'Dueña','owner-integridad@example.test','OWNER','unused')", [ownerId, bid]);
    await db.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,'573000000001','Cliente ficticio')", [customerId, bid]);
    await db.query('INSERT INTO customer_balances(customer_id,points) VALUES($1,0) ON CONFLICT (customer_id) DO NOTHING', [customerId]);
  });
  after(async () => { await db?.end(); await database?.closeDatabase(); });

  it('records staff creation and security changes without passwords or hashes', async () => {
    const created = await call(routes.staff, '/admin/staff', 'post', { body: { name: 'Cajera ficticia', email: 'cajera-integridad@example.test', password: 'Volcanes nube 8492!', role: 'CASHIER', branch_id: branchId, can_manage_gift_cards: true } });
    assert.equal(created.statusCode, 200);
    const staffId = created.body.staff.id;
    const updated = await call(routes.staff, '/admin/staff/:id', 'patch', { params: { id: staffId }, body: { role: 'MANAGER', active: false, password: 'Otra montaña lejana 5521!', can_manage_gift_cards: false } });
    assert.equal(updated.statusCode, 200);
    const [create] = await audits('staff.create'), [update] = await audits('staff.update');
    assert.equal(create.business_id, bid); assert.equal(create.actor_id, ownerId);
    assert.deepEqual({ ...create.meta }, { staff_id: staffId, role: 'CASHIER', branch_id: branchId, can_manage_gift_cards: true });
    assert.deepEqual(update.meta.changes.role, { from: 'CASHIER', to: 'MANAGER' });
    assert.deepEqual(update.meta.changes.active, { from: true, to: false });
    assert.equal(update.meta.password_reset, true);
    const stored = JSON.stringify([create.meta, update.meta]);
    const hash = (await db.query('SELECT password_hash FROM staff_users WHERE id=$1', [staffId])).rows[0].password_hash;
    for (const secret of ['Volcanes nube', 'Otra montaña', hash]) assert.equal(stored.includes(secret), false);
  });

  it('records reward creation and updates in the same transaction as the change', async () => {
    const created = await call(routes.rewards, '/admin/rewards', 'post', { body: { name: 'Café ficticio', points_cost: 100, branch_ids: [branchId] } });
    assert.equal(created.statusCode, 200);
    const rewardId = created.body.reward.id;
    assert.equal((await call(routes.rewards, '/admin/rewards/:id', 'patch', { params: { id: rewardId }, body: { points_cost: 120, active: false } })).statusCode, 200);
    assert.equal((await call(routes.rewards, '/admin/rewards/:id', 'patch', { params: { id: rewardId }, body: { branch_ids: [] } })).statusCode, 200);
    const [create] = await audits('reward.create'), updates = await audits('reward.update');
    assert.equal(create.meta.reward_id, rewardId); assert.deepEqual(create.meta.branch_ids, [branchId]);
    assert.deepEqual(updates[0].meta.changes.points_cost, { from: 100, to: 120 });
    assert.deepEqual(updates[1].meta.changes.branch_ids, { from: [branchId], to: [] });
    await db.query("CREATE FUNCTION admin_integrity_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='reward.update' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER admin_integrity_audit_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION admin_integrity_audit_fail()");
    try { await assert.rejects(call(routes.rewards, '/admin/rewards/:id', 'patch', { params: { id: rewardId }, body: { points_cost: 150 } }), /audit unavailable/); }
    finally { await db.query('DROP TRIGGER admin_integrity_audit_fail ON audit_logs; DROP FUNCTION admin_integrity_audit_fail()'); }
    assert.equal((await db.query('SELECT points_cost FROM rewards WHERE id=$1', [rewardId])).rows[0].points_cost, 120, 'an unaudited change rolls back');
  });

  it('branch codes are unique per business and branch creation is recorded', async () => {
    const own = await call(routes.branches, '/admin/branches', 'post', { body: { name: 'Zona 10', code: 'z10' } });
    assert.equal(own.statusCode, 200);
    await db.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$2,'Ajena','z10')", [randomUUID(), other]);
    const duplicate = await call(routes.branches, '/admin/branches', 'post', { body: { name: 'Repetida', code: 'z10' } });
    assert.equal(duplicate.statusCode, 409); assert.equal(duplicate.body.code, 'BRANCH_CODE_IN_USE');
    const [entry] = await audits('branch.create');
    assert.deepEqual({ branch_id: entry.meta.branch_id, code: entry.meta.code }, { branch_id: own.body.branch.id, code: 'z10' });
  });

  it('signup succeeds when another business already uses its default branch code', async () => {
    await db.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$2,'Copia','cafe-luna-main')", [randomUUID(), other]);
    const first = await database.withDbClientContext({ tenantId: null, platformAdmin: false }, () => routes.business.createBusinessWithOwner({ businessName: 'Café Luna', email: 'luna@example.test', password: 'Volcanes nube 8492!' }));
    assert.equal(first.business.slug, 'cafe-luna');
    assert.equal((await db.query('SELECT code FROM branches WHERE id=$1', [first.branchId])).rows[0].code, 'cafe-luna-main');
    // Before the per-business index exists everywhere, an old global constraint is retried with a derived code.
    await db.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$2,'Copia','cafe-sol-main')", [randomUUID(), other]);
    await db.query("CREATE UNIQUE INDEX branches_code_key ON branches(code) WHERE code LIKE 'cafe-sol%'");
    try {
      const second = await database.withDbClientContext({ tenantId: null, platformAdmin: false }, () => routes.business.createBusinessWithOwner({ businessName: 'Café Sol', email: 'sol@example.test', password: 'Volcanes nube 8492!' }));
      assert.equal(second.business.slug, 'cafe-sol');
      assert.match((await db.query('SELECT code FROM branches WHERE id=$1', [second.branchId])).rows[0].code, /^cafe-sol-main-[0-9a-f]{6}$/);
    } finally { await db.query('DROP INDEX branches_code_key'); }
  });

  it('records customer profile edits and exports without customer details', async () => {
    const directory = routes.customers.createCustomerDirectoryRouter();
    const edit = await call(directory, '/admin/customers/:id', 'patch', { params: { id: customerId }, body: { name: 'Cliente renombrado', previous_name: 'Cliente ficticio' } });
    assert.equal(edit.statusCode, 200);
    const exported = await call(routes.customers.adminCustomerRoutes, '/admin/customers.csv', 'get', {});
    assert.match(String(exported.body), /Cliente renombrado/);
    const [profile] = await audits('customer.profile.update'), [csv] = await audits('customers.export');
    assert.deepEqual(profile.meta, { customer_id: customerId, fields: ['name'] });
    assert.equal(csv.meta.rows, 1); assert.equal(csv.meta.format, 'csv');
    assert.equal(JSON.stringify([profile.meta, csv.meta]).includes('Cliente'), false);
  });

  it('records super-admin user creation, plan feature edits and secret rotation', async () => {
    const platform = { tenantId: null, platformAdmin: true }, req = { superAdmin: { email: 'platform@example.test' }, headers: { 'user-agent': 'test' }, ip: '127.0.0.1' };
    const user = await database.withDbClientContext(platform, () => routes.superSupport.createSuperBusinessUser(bid, { name: 'Gerente ficticia', email: 'gerente-integridad@example.test', password: 'Volcanes nube 8492!', role: 'MANAGER' }, { req, superAdminEmail: 'platform@example.test' }));
    const features = await call(routes.superRoutes, '/super/plans/:plan/features', 'put', { ...req, params: { plan: 'NEGOCIO' }, body: { features: { customer_export: true } } }, platform);
    assert.equal(features.statusCode, 200);
    const rotated = await call(routes.superRoutes, '/super/security/rotate-secrets', 'post', { ...req }, platform);
    assert.equal(rotated.statusCode, 200);
    const [created] = await audits('super.staff.create'), [plan] = await audits('super.plan_features.update'), [rotation] = await audits('super.secrets.rotate');
    assert.equal(created.business_id, bid); assert.equal(created.actor_type, 'SUPER_ADMIN'); assert.equal(created.meta.staff_id, user.id);
    assert.equal(plan.business_id, null); assert.deepEqual(plan.meta.features, { customer_export: true });
    assert.equal(rotation.business_id, null); assert.equal(typeof rotation.meta.webhook_secrets, 'number');
    await assert.rejects(db.query("INSERT INTO audit_logs(id,business_id,actor_type,action) VALUES($1,NULL,'STAFF','staff.update')", [randomUUID()]), { code: '23514' });
  });

  it('sales reports count only recorded sales and do not overflow with large currencies', async () => {
    // 120,000,000 COP for one customer exceeds numeric(10,2); every purchase refreshes the customer's totals.
    await purchase(60000000); await purchase(60000000);
    const refunded = randomUUID(), reversal = randomUUID();
    await purchase(1000, { id: refunded, status: 'REVERSED', reversed: reversal });
    await purchase(-1000, { id: reversal, source: 'reversal', original: refunded, points: -1 });
    await purchase(0, { source: 'redeem', points: -100, visits: 0 });
    await purchase(0, { source: 'expire', status: 'EXPIRED', points: -5, visits: 0 });
    await purchase(5000, { source: 'migration', type: 'OPENING_BALANCE', points: 500 });
    await purchase(0, { source: 'lifecycle', type: 'BONUS', points: 50, visits: 0 });
    const ltv = (await db.query('SELECT total_spend FROM customer_ltv WHERE customer_id=$1', [customerId])).rows[0];
    assert.equal(Number(ltv.total_spend), 120000000);
    const iva = await call(routes.billing, '/admin/billing/iva.csv', 'get', { validatedQuery: {} });
    const lines = String(iva.body).trim().split('\n');
    assert.equal(lines.length, 2, String(iva.body));
    assert.match(lines[1], /,2,"?120000000\.00"?,/);
    const roi = await call(routes.insights, '/admin/roi', 'get', { validatedQuery: { days: 30 } });
    assert.equal(roi.body.roi.revenue_current_q, 120000000); assert.equal(roi.body.roi.tx_current, 2);
    const dashboard = await call(routes.dashboard, '/admin/analytics/dashboard', 'get', { query: { branch_id: branchId } });
    assert.equal(dashboard.statusCode, 200);
    const branch = dashboard.body.branch_performance.find(row => row.branch_id === branchId);
    assert.ok(Number(branch.revenue_30d) > 99999999.99);
  });

  it('the IVA report groups sales by the business calendar day, not the database server day', async () => {
    // 2026-03-01 03:00 UTC is 22:00 on 2026-02-28 in the business's America/Bogota timezone.
    // Receipt time is immutable once recorded, so the sale is inserted with it.
    await db.query(
      `INSERT INTO transactions(id,business_id,branch_id,customer_id,type,source,status,amount_q,points,visits,items,created_at)
       VALUES($1,$2,$3,$4,'PURCHASE','online','POSTED',777,1,1,1,'2026-03-01T03:00:00Z')`,
      [randomUUID(), bid, branchId, customerId]);
    const iva = await call(routes.billing, '/admin/billing/iva.csv', 'get', { validatedQuery: { from: '2026-02-28', to: '2026-02-28' } });
    const lines = String(iva.body).trim().split('\n');
    assert.equal(lines.length, 2, String(iva.body));
    // The date column is an ISO date, not a JS Date string such as "Sat Feb 28 2026 00:00:00 GMT…".
    assert.match(lines[1], /^"?2026-02-28"?,1,"?777\.00"?,/);
    const nextDay = await call(routes.billing, '/admin/billing/iva.csv', 'get', { validatedQuery: { from: '2026-03-01', to: '2026-03-01' } });
    assert.equal(String(nextDay.body).trim().split('\n').length, 1, String(nextDay.body));
  });

  it('an owner-set password or deactivation invalidates the member reset and email-change links', async () => {
    const email = 'enlaces-integridad@example.test';
    const created = await call(routes.staff, '/admin/staff', 'post', { body: { name: 'Cajero ficticio', email, password: 'Volcanes nube 8492!', role: 'CASHIER', branch_id: branchId } });
    const staffId = created.body.staff.id;
    const link = async purpose => (await db.query(`INSERT INTO auth_action_tokens(id,actor_type,actor_id,actor_email,business_id,purpose,token_hash,expires_at)
      VALUES($1,'STAFF',$2,$3,$4,$5,$6,now() + interval '1 hour') RETURNING id`, [randomUUID(), staffId, email, bid, purpose, randomUUID()])).rows[0].id;
    const usable = async id => (await db.query('SELECT used_at FROM auth_action_tokens WHERE id=$1', [id])).rows[0].used_at === null;
    const patch = body => call(routes.staff, '/admin/staff/:id', 'patch', { params: { id: staffId }, body });
    const [reset, emailChange] = [await link('STAFF_PASSWORD_RESET'), await link('STAFF_EMAIL_CHANGE_OLD')];
    assert.equal((await patch({ role: 'MANAGER' })).statusCode, 200);
    assert.equal(await usable(reset), true, 'a role change alone keeps the links');
    assert.equal((await patch({ password: 'Otra montaña lejana 5521!' })).statusCode, 200);
    assert.deepEqual([await usable(reset), await usable(emailChange)], [false, false]);
    const later = await link('STAFF_PASSWORD_RESET');
    assert.equal((await patch({ active: false })).statusCode, 200);
    assert.equal(await usable(later), false);
  });

  it('rolls back each owner change whose audit entry cannot be written', async () => {
    const program = (await import('../../src/app/routes/admin/program.js')).adminProgramRoutes;
    const directory = routes.customers.createCustomerDirectoryRouter();
    const member = (await db.query("SELECT id, role, password_hash FROM staff_users WHERE email='cajera-integridad@example.test'")).rows[0];
    const before = {
      program: (await db.query('SELECT program_json FROM businesses WHERE id=$1', [bid])).rows[0].program_json,
      customer: (await db.query('SELECT name FROM customers WHERE id=$1', [customerId])).rows[0].name
    };
    const newStaff = { name: 'Persona reintento', email: 'reintento-integridad@example.test', password: 'Volcanes nube 8492!', role: 'CASHIER', branch_id: branchId };
    await db.query("CREATE FUNCTION admin_integrity_audit_down() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER admin_integrity_audit_down BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION admin_integrity_audit_down()");
    try {
      await assert.rejects(call(routes.staff, '/admin/staff', 'post', { body: newStaff }), /audit unavailable/);
      await assert.rejects(call(routes.staff, '/admin/staff/:id', 'patch', { params: { id: member.id }, body: { role: 'CASHIER', password: 'Clave sin registro 7731!' } }), /audit unavailable/);
      await assert.rejects(call(routes.branches, '/admin/branches', 'post', { body: { name: 'Sin registro', code: 'sin-registro' } }), /audit unavailable/);
      await assert.rejects(call(program, '/admin/program', 'post', { body: { program_type: 'SPEND', program_json: { points_per_q: 0.5 } } }), /audit unavailable/);
      await assert.rejects(call(directory, '/admin/customers/:id', 'patch', { params: { id: customerId }, body: { name: 'Nombre sin registro', previous_name: before.customer } }), /audit unavailable/);
      // An export that cannot be recorded is not sent.
      await assert.rejects(call(routes.customers.adminCustomerRoutes, '/admin/customers.csv', 'get', {}), /audit unavailable/);
    } finally { await db.query('DROP TRIGGER admin_integrity_audit_down ON audit_logs; DROP FUNCTION admin_integrity_audit_down()'); }

    assert.equal((await db.query('SELECT count(*)::int AS n FROM staff_users WHERE email=$1', [newStaff.email])).rows[0].n, 0);
    assert.deepEqual((await db.query('SELECT role, password_hash FROM staff_users WHERE id=$1', [member.id])).rows[0], { role: member.role, password_hash: member.password_hash });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM branches WHERE code='sin-registro'")).rows[0].n, 0);
    assert.deepEqual((await db.query('SELECT program_json FROM businesses WHERE id=$1', [bid])).rows[0].program_json, before.program);
    assert.equal((await db.query('SELECT name FROM customers WHERE id=$1', [customerId])).rows[0].name, before.customer);
    // Retrying after the failure creates the member exactly once.
    assert.equal((await call(routes.staff, '/admin/staff', 'post', { body: newStaff })).statusCode, 200);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM staff_users WHERE email=$1', [newStaff.email])).rows[0].n, 1);
  });
});
