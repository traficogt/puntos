/* eslint-disable security/detect-non-literal-fs-filename -- Repository-owned migration files. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { HttpError } from '../../src/utils/http-error.js';
const databaseUrl = process.env.MOBILE_ACCESS_TEST_DATABASE_URL;

test('phone-first mobile access real PostgreSQL credentials, membership isolation and atomic sessions', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl);
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /^\/mobile_access_test(?:_[a-z0-9_]+)?$/);
  const migration = await readFile(new URL('../../src/app/migrations/2026-11-10-mobile-access.sql', import.meta.url), 'utf8').catch(() => '');
  assert.ok(migration, 'global mobile-access storage migration exists');
  const admin = new pg.Client({ connectionString: databaseUrl }); await admin.connect();
  let runtime, database;
  try {
    await admin.query('DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public');
    await admin.query("DO $$ BEGIN CREATE ROLE puntos_app LOGIN PASSWORD 'disposable-runtime-only' NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
    for (const file of ['schema.sql', 'schema-extensions.sql']) await admin.query(await readFile(new URL(`../../src/app/${file}`, import.meta.url), 'utf8'));
    const { orderMigrations } = await import('../../src/app/db/migration-order.js');
    const files = (await readdir(new URL('../../src/app/migrations/', import.meta.url))).filter(name => name.endsWith('.sql'));
    for (const file of orderMigrations(files)) await admin.query(await readFile(new URL(`../../src/app/migrations/${file}`, import.meta.url), 'utf8'));
    await admin.query(migration); // Migration remains safe to run twice.
    const { buildGrantPlan, APP_TABLE_PRIVILEGES } = await import('../../src/scripts/create-app-role.mjs');
    assert.deepEqual(APP_TABLE_PRIVILEGES.mobile_access_codes, ['SELECT', 'INSERT', 'UPDATE']);
    assert.deepEqual(APP_TABLE_PRIVILEGES.mobile_access_grants, ['SELECT', 'INSERT', 'UPDATE']);
    const plan = buildGrantPlan({ appDbUser: 'puntos_app', dbName: url.pathname.slice(1) });
    for (const sql of plan.statements) await admin.query(sql);
    await admin.query(plan.grantFunctionsSql);
    Object.assign(process.env, { DB_HOST: url.hostname, DB_PORT: url.port, DB_NAME: url.pathname.slice(1), DB_USER: 'puntos_app', DB_PASSWORD: 'disposable-runtime-only', DB_MIGRATIONS_USER: '', DB_MIGRATIONS_PASSWORD: '', MESSAGE_PROVIDER: 'dev', MESSAGE_PROVIDER_ORDER: 'dev', LOG_LEVEL: 'silent' });
    database = await import('../../src/app/database.js');
    const { createMobileAccessService } = await import('../../src/app/services/mobile-access-service.js');
    const { MobileAccessRepo } = await import('../../src/app/repositories/mobile-access-repository.js');
    const { createBrowserSession, hashSessionToken } = await import('../../src/app/services/auth-session-service.js');
    runtime = new pg.Client({ host: url.hostname, port: Number(url.port), database: url.pathname.slice(1), user: 'puntos_app', password: 'disposable-runtime-only' }); await runtime.connect();
    const sent = [];
    const delivery = async message => { sent.push(message); return { ok: true }; };
    const service = createMobileAccessService({ sendMessage: delivery });
    const businesses = [randomUUID(), randomUUID(), randomUUID()];
    const phone = '50255551234', foreignPhone = '50255559999';
    for (const [index, id] of businesses.entries()) await admin.query("INSERT INTO businesses(id,name,slug,email,password_hash) VALUES($1::uuid,$2,$1::text,$1::text||'@example.invalid','test')", [id, `Shop ${index}`]);
    async function addCustomer(number, businessId) {
      const id = randomUUID();
      await admin.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,$3,'Ana')", [id, businessId, number]);
      await admin.query('INSERT INTO customer_balances(customer_id,points) VALUES($1,7)', [id]);
      return id;
    }
    const customerA = await addCustomer(phone, businesses[0]);
    const customerB = await addCustomer(phone, businesses[1]);
    await addCustomer(foreignPhone, businesses[2]);
    async function request(number = phone, instance = service) {
      await instance.requestCode({ phone: number });
      return sent.at(-1).body.match(/\b\d{6}\b/)[0];
    }
    async function age(number = phone) { await admin.query("UPDATE mobile_access_codes SET created_at=now()-interval '2 hours' WHERE phone=$1", [number]); }
    async function grant(number = phone) { await age(number); return service.verify({ phone: number, code: await request(number) }); }
    async function sessionCount() { return Number((await admin.query("SELECT count(*) FROM auth_sessions WHERE actor_type='CUSTOMER'")).rows[0].count); }

    await t.test('runtime role is not privileged; unknown and tenant contexts cannot read or mutate global proof', async () => {
      const row = (await runtime.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
      assert.deepEqual(row, { rolsuper: false, rolbypassrls: false });
      for (const tenant of ['', businesses[0]]) {
        await runtime.query("SELECT set_config('app.current_tenant',$1,false)", [tenant]);
        for (const table of ['mobile_access_codes', 'mobile_access_grants']) {
          assert.equal((await runtime.query(`SELECT * FROM ${table}`)).rowCount, 0);
          await assert.rejects(runtime.query(`DELETE FROM ${table}`), { code: '42501' });
        }
        await assert.rejects(runtime.query("INSERT INTO mobile_access_codes(id,phone,code_hash,expires_at) VALUES($1,$2,'test',now()+interval '10 minutes')", [randomUUID(), phone]), { code: '42501' });
        await assert.rejects(database.runWithDbContext({ tenantId: tenant, platformAdmin: false }, () => MobileAccessRepo.listCards(phone)), /trusted platform context/);
      }
      assert.equal((await runtime.query("SELECT has_table_privilege('puntos_app','auth_sessions','SELECT') AS allowed")).rows[0].allowed, false);
    });
    await t.test('code request never reads memberships and sends the same generic message for absent phones', async () => {
      const noLookup = createMobileAccessService({ sendMessage: delivery, repo: { ...MobileAccessRepo, listCards: async () => { assert.fail('membership lookup before proof'); } } });
      for (const number of [phone, '50255550000']) {
        assert.deepEqual(await database.runWithDbContext({ tenantId: businesses[2], platformAdmin: false }, () => noLookup.requestCode({ phone: number })), { ok: true });
        const message = sent.at(-1); assert.equal(message.businessId, null); assert.equal(message.privilegedLog, true); assert.deepEqual(message.destinations, { phone: number });
        assert.equal(message.body.replace(/\d{6}/, 'CODE'), 'Tu código de PuntosFieles: CODE (expira en 10 minutos)');
      }
      const stored = (await admin.query('SELECT * FROM mobile_access_codes WHERE phone=$1', [phone])).rows[0];
      assert.match(stored.code_hash, /^\$2/); assert.equal(stored.attempts, 0); assert.ok(Date.parse(stored.expires_at) - Date.parse(stored.created_at) <= 600100);
      assert.deepEqual(await service.verify({ phone: '50255550000', code: sent.at(-1).body.match(/\b\d{6}\b/)[0] }), { status: 'no_cards' });
    });
    await t.test('persistent cooldown survives service recreation and normalizes local phone forms', async () => {
      await assert.rejects(createMobileAccessService({ sendMessage: delivery }).requestCode({ phone: '5555-1234' }), { statusCode: 429 });
      const number = '50255550001';
      for (let i = 0; i < 5; i++) { await request(number); await admin.query("UPDATE mobile_access_codes SET created_at=now()-interval '2 minutes' WHERE phone=$1", [number]); }
      await assert.rejects(service.requestCode({ phone: number }), { statusCode: 429 });
      assert.equal(Number((await admin.query('SELECT count(*) FROM mobile_access_codes WHERE phone=$1', [number])).rows[0].count), 5);
    });
    await t.test('five bad attempts persist after rejected responses and block the correct code', async () => {
      await age(); const code = await request(); const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 1; i <= 5; i++) {
        await assert.rejects(service.verify({ phone, code: wrong }), { statusCode: 401 });
        assert.equal((await admin.query('SELECT attempts FROM mobile_access_codes WHERE phone=$1 ORDER BY created_at DESC LIMIT 1', [phone])).rows[0].attempts, i);
      }
      await assert.rejects(service.verify({ phone, code }), { statusCode: 401 }); assert.equal(await sessionCount(), 0);
    });
    await t.test('expired and superseded codes cannot discover cards; current proof yields only card identity', async () => {
      await age(); const old = await request(); await age(); const next = await request();
      if (old !== next) await assert.rejects(service.verify({ phone, code: old }), { statusCode: 401 });
      await admin.query("UPDATE mobile_access_codes SET expires_at=now()-interval '1 second' WHERE phone=$1", [phone]);
      await assert.rejects(service.verify({ phone, code: next }), { statusCode: 401 });
      const result = await grant(); assert.equal(result.status, 'choose_card'); assert.equal(result.cards.length, 2);
      assert.ok(result.cards.every(card => Object.keys(card).sort().join(',') === 'id,name,slug'));
      const stored = (await admin.query('SELECT * FROM mobile_access_grants WHERE token_hash=$1', [hashSessionToken(result.accessToken)])).rows[0];
      assert.equal(stored.phone, phone); assert.notEqual(stored.token_hash, result.accessToken); assert.ok(Date.parse(stored.expires_at) - Date.parse(stored.created_at) <= 300100);
    });
    await t.test('grant rejects foreign-phone membership, expired proof, deletion and replay', async () => {
      const first = await grant();
      await assert.rejects(service.select({ ...{ accessToken: first.accessToken, businessId: businesses[2], phone: foreignPhone } }), { statusCode: 401 });
      await admin.query('UPDATE customers SET deleted_at=now() WHERE id=$1', [customerB]);
      await assert.rejects(service.select({ accessToken: first.accessToken, businessId: businesses[1] }), { statusCode: 401 });
      const signed = await service.select({ accessToken: first.accessToken, businessId: businesses[0] });
      assert.equal(signed.status, 'signed_in'); assert.equal(signed.customer.id, customerA); assert.equal(signed.customer.points, 7); assert.equal(signed.business.id, businesses[0]);
      const session = (await runtime.query('SELECT * FROM app.auth_session_lookup($1)', [hashSessionToken(signed.token)])).rows[0];
      assert.equal(session.actor_id, customerA); assert.equal(session.business_id, businesses[0]); assert.equal(session.actor_type, 'CUSTOMER');
      await assert.rejects(service.select({ accessToken: first.accessToken, businessId: businesses[0] }), { statusCode: 401 });
      await admin.query('UPDATE customers SET deleted_at=NULL WHERE id=$1', [customerB]);
      const expired = await grant(); await admin.query("UPDATE mobile_access_grants SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [hashSessionToken(expired.accessToken)]);
      await assert.rejects(service.select({ accessToken: expired.accessToken, businessId: businesses[0] }), { statusCode: 401 });
    });
    await t.test('one-card proof issues a tenant session; parallel verification issues only one session', async () => {
      await age(foreignPhone); const code = await request(foreignPhone), before = await sessionCount();
      const results = await Promise.allSettled([service.verify({ phone: foreignPhone, code }), service.verify({ phone: foreignPhone, code })]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(await sessionCount(), before + 1);
      assert.equal(results.find(result => result.status === 'fulfilled').value.business.id, businesses[2]);
    });
    await t.test('parallel card selections consume one grant and issue one session atomically', async () => {
      const access = await grant(), before = await sessionCount();
      const results = await Promise.allSettled(businesses.slice(0, 2).map(businessId => service.select({ accessToken: access.accessToken, businessId })));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(await sessionCount(), before + 1);
    });
    await t.test('selection waits for concurrent customer deletion and rejects the deleted membership', async () => {
      const access = await grant();
      await runtime.query('BEGIN');
      let pending;
      try {
        await runtime.query("SELECT set_config('app.current_tenant',$1,true),set_config('app.platform_admin','',true)", [businesses[1]]);
        await runtime.query('UPDATE customers SET deleted_at=now() WHERE id=$1', [customerB]);
        pending = service.select({ accessToken: access.accessToken, businessId: businesses[1] }).catch(error => error);
        const deadline = Date.now() + 2000;
        let waiting = false;
        while (Date.now() < deadline) {
          const activity = await admin.query("SELECT 1 FROM pg_stat_activity WHERE usename='puntos_app' AND wait_event_type='Lock' AND query LIKE '%FROM customers c JOIN businesses%'");
          if (activity.rowCount) { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        assert.equal(waiting, true);
        await runtime.query('COMMIT');
        const result = await pending;
        assert.equal(result.statusCode, 401);
      } finally {
        await runtime.query('ROLLBACK'); await pending;
        await admin.query('UPDATE customers SET deleted_at=NULL WHERE id=$1', [customerB]);
      }
    });
    await t.test('populated global proof tables remain hidden from tenant and anonymous runtime queries', async () => {
      for (const tenant of ['', businesses[0]]) {
        await runtime.query("SELECT set_config('app.current_tenant',$1,false),set_config('app.platform_admin','',false)", [tenant]);
        for (const table of ['mobile_access_codes', 'mobile_access_grants']) {
          assert.ok((await admin.query(`SELECT * FROM ${table}`)).rowCount > 0);
          assert.equal((await runtime.query(`SELECT * FROM ${table}`)).rowCount, 0);
          assert.equal((await runtime.query(`UPDATE ${table} SET consumed_at=now()`)).rowCount, 0);
        }
      }
    });
    await t.test('session insertion failure rolls back OTP and grant consumption including the session insert', async () => {
      const failing = createMobileAccessService({ sendMessage: delivery, createBrowserSession: async (input, query) => { await createBrowserSession(input, query); throw Error('simulated session commit failure'); } });
      const access = await grant(), before = await sessionCount();
      await assert.rejects(failing.select({ accessToken: access.accessToken, businessId: businesses[0] }), /simulated/); assert.equal(await sessionCount(), before);
      assert.equal((await service.select({ accessToken: access.accessToken, businessId: businesses[0] })).status, 'signed_in');
      await age(foreignPhone); const code = await request(foreignPhone), count = await sessionCount();
      await assert.rejects(failing.verify({ phone: foreignPhone, code }), /simulated/); assert.equal(await sessionCount(), count);
      assert.equal((await service.verify({ phone: foreignPhone, code })).status, 'signed_in');
    });
    await t.test('provider failures retain request history, invalidate the code and reveal no provider error', async () => {
      const number = '50255550003';
      const failing = createMobileAccessService({ sendMessage: async () => { throw Error('provider-secret-detail'); } });
      await assert.rejects(failing.requestCode({ phone: number }), error => error instanceof HttpError && error.statusCode === 503 && !error.message.includes('provider-secret'));
      const row = (await admin.query('SELECT * FROM mobile_access_codes WHERE phone=$1', [number])).rows[0];
      assert.ok(row.consumed_at); await assert.rejects(service.requestCode({ phone: number }), { statusCode: 429 });
    });
    await t.test('actual messaging persists masked global verification and delivery status without tenant billing', async () => {
      const { config } = await import('../../src/config/index.js');
      assert.deepEqual(config.MESSAGE_PROVIDER_ORDER, ['dev']);
      const actual = createMobileAccessService();
      const number = '50255550005';
      const before = Number((await admin.query('SELECT count(*) FROM billing_events')).rows[0].count);
      assert.deepEqual(await actual.requestCode({ phone: number }), { ok: true });
      const log = (await admin.query('SELECT * FROM message_logs WHERE to_addr=$1', [number])).rows[0];
      assert.equal(log.business_id, null); assert.equal(log.customer_id, null);
      assert.equal(log.channel, 'verify'); assert.equal(log.status, 'SENT');
      assert.equal(log.provider_id, 'dev:ef260e9aa3c673af240d17a2660480361a8e081d1ffeca2a5ed0e3219fc18567');
      assert.equal(log.body, 'Tu código de PuntosFieles: ****** (expira en 10 minutos)');
      assert.doesNotMatch(log.body, /\b\d{6}\b/);
      assert.equal(Number((await admin.query('SELECT count(*) FROM billing_events')).rows[0].count), before);
      const previous = config.MESSAGE_PROVIDER_ORDER;
      try {
        config.MESSAGE_PROVIDER_ORDER = ['disabled-local-test-provider'];
        await assert.rejects(actual.requestCode({ phone: '50255550006' }), { statusCode: 503 });
        const failed = (await admin.query('SELECT * FROM message_logs WHERE to_addr=$1', ['50255550006'])).rows[0];
        assert.equal(failed.status, 'FAILED'); assert.equal(failed.body, log.body);
        assert.ok((await admin.query('SELECT consumed_at FROM mobile_access_codes WHERE phone=$1', ['50255550006'])).rows[0].consumed_at);
      } finally { config.MESSAGE_PROVIDER_ORDER = previous; }
    });
    await t.test('security logging permits only masked tenantless verification while preserving existing security messages', async () => {
      const masked = 'Tu código de PuntosFieles: ****** (expira en 10 minutos)';
      const sql = 'SELECT app.security_message_log_create($1,$2,$3,$4,$5,$6,$7,$8,$9)';
      for (const [businessId, customerId, channel, body] of [
        [null, null, 'verify', 'Tu código de PuntosFieles: 123456 (expira en 10 minutos)'],
        [businesses[0], null, 'verify', masked], [null, customerA, 'verify', masked], [null, null, 'marketing', masked]
      ]) await assert.rejects(runtime.query(sql, [randomUUID(), businessId, customerId, channel, '50255550007', body, 'QUEUED', null, null]));
      const id = randomUUID();
      await runtime.query(sql, [id, businesses[0], null, 'security', 'security@example.invalid', 'Existing security notification', 'QUEUED', null, null]);
      await runtime.query("SELECT app.security_message_log_update_status($1,'SENT','dev',NULL)", [id]);
      assert.equal((await admin.query('SELECT status FROM message_logs WHERE id=$1', [id])).rows[0].status, 'SENT');
    });
    await t.test('request concurrency preserves one active code and one delivery', async () => {
      const number = '50255550004', before = sent.length;
      const results = await Promise.allSettled([service.requestCode({ phone: number }), service.requestCode({ phone: number })]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(sent.length, before + 1);
    });
  } finally {
    if (runtime) await runtime.end();
    if (database) await database.closeDatabase();
    await admin.end();
  }
});
