import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { buildGrantPlan } from '../../src/scripts/create-app-role.mjs';

const url = process.env.INTEGRATION_WEBHOOKS_TEST_DB_URL;
const suite = url ? describe : describe.skip;
const database = 'integration_webhooks_test';
const role = `integration_runtime_${randomUUID().replaceAll('-', '')}`;
const businessA = randomUUID(), businessB = randomUUID();
const slugA = `cafe-a-${businessA.slice(0, 8)}`, slugB = `cafe-b-${businessB.slice(0, 8)}`;
let admin, runtime, db, payments, WebhookRepo, roleCreated = false;

// Static repository migrations resolved relative to this test, with no user input.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const migration = name => readFile(new URL(`../../src/app/migrations/${name}`, import.meta.url), 'utf8');

/** Runs app code on a connection that has assumed the least-privileged runtime role. */
async function asRuntime(context, task) {
  await runtime.query("SELECT set_config('app.current_tenant','',false), set_config('app.platform_admin','',false), set_config('app.webhook_ingest','',false)");
  return db.runWithDbContext({ client: runtime, tenantId: null, platformAdmin: false, webhookIngest: false }, async () => {
    if (context.platformAdmin) await db.setPlatformAdmin(true);
    if (context.tenantId) await db.setCurrentTenant(context.tenantId);
    return task();
  });
}

const awards = [];
async function award(input) {
  if (![slugA, slugB].includes(input.businessSlug)) throw Object.assign(new Error('Business not found'), { statusCode: 404 });
  awards.push(input);
  return { transactionId: randomUUID(), customerId: null };
}
const deliver = payload => asRuntime({}, () => payments.processPaymentWebhook({ provider: 'cubo', payload: { status: 'PAID', amount: '10.00', ...payload } }, { award }));
const eventsFor = (provider, eventId) => admin.query('SELECT * FROM payment_webhook_events WHERE provider=$1 AND provider_event_id=$2 ORDER BY created_at, id', [provider, eventId]).then(result => result.rows);

suite('integration webhooks on disposable PostgreSQL with the restricted runtime role', () => {
  before(async () => {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, '127.0.0.1');
    assert.ok(parsed.port && parsed.port !== '5432', 'Use an explicit non-default PostgreSQL port for the disposable test database');
    assert.equal(parsed.pathname, `/${database}`);
    Object.assign(process.env, { NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: parsed.port, DB_NAME: database,
      DB_USER: decodeURIComponent(parsed.username), DB_PASSWORD: decodeURIComponent(parsed.password), RATE_LIMIT_DRIVER: 'memory' });
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);
    roleCreated = true;
    const plan = buildGrantPlan({ appDbUser: role, dbName: database });
    for (const statement of plan.statements) await admin.query(statement);
    await admin.query(plan.grantFunctionsSql);
    await admin.query(`INSERT INTO businesses(id,name,slug,email,password_hash,program_type,program_json)
      VALUES ($1,'Café A',$2,$3,'fixture','SPEND','{"points_per_q":1,"external_awards":{"enabled":true}}'),
             ($4,'Café B',$5,$6,'fixture','SPEND','{"points_per_q":1,"external_awards":{"enabled":true}}')`,
    [businessA, slugA, `${businessA}@example.test`, businessB, slugB, `${businessB}@example.test`]);
    runtime = new pg.Client({ connectionString: url });
    await runtime.connect();
    await runtime.query(`SET ROLE "${role}"`);
    const [configModule, database_, paymentModule, repositoryModule] = await Promise.all([
      import('../../src/config/index.js'), import('../../src/app/database.js'),
      import('../../src/app/services/payment-webhook-service.js'), import('../../src/app/repositories/webhook-repository.js')
    ]);
    Object.assign(configModule.config, { PAYMENT_WEBHOOK_REQUIRE_AUTH: false, PAYMENT_WEBHOOK_SECRETS: {}, PAYMENT_WEBHOOK_HMAC_SECRETS: {}, PAYMENT_WEBHOOK_ALLOWED_PROVIDERS: [] });
    db = database_;
    payments = paymentModule;
    WebhookRepo = repositoryModule.WebhookRepo;
    const actor = (await runtime.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    assert.deepEqual(actor, { rolsuper: false, rolbypassrls: false });
  });

  after(async () => {
    await runtime?.end();
    if (admin) {
      if (roleCreated) {
        await admin.query(`DROP OWNED BY "${role}"`);
        await admin.query(`DROP ROLE "${role}"`);
      }
      await admin.end();
    }
    await db?.closeDatabase();
  });

  describe('payment webhook event scope', () => {
    it('migrates a legacy table: drops the global constraint, keeps rows, and is safe to re-run', async () => {
      await admin.query('BEGIN');
      try {
        await admin.query('DROP INDEX payment_webhook_events_destination_event_key');
        await admin.query('ALTER TABLE payment_webhook_events ADD CONSTRAINT payment_webhook_events_provider_provider_event_id_key UNIQUE (provider, provider_event_id)');
        await admin.query("INSERT INTO payment_webhook_events(id,provider,provider_event_id,business_id,business_slug) VALUES ($1,'legacy','evt-legacy',$2,$3)", [randomUUID(), businessA, slugA]);
        const sql = await migration('2026-11-17-integrations-payment-event-scope.sql');
        await admin.query(sql);
        await admin.query(sql);
        const constraints = await admin.query("SELECT conname FROM pg_constraint WHERE conrelid='payment_webhook_events'::regclass AND contype='u'");
        assert.deepEqual(constraints.rows, []);
        const index = await admin.query("SELECT indexdef FROM pg_indexes WHERE tablename='payment_webhook_events' AND indexname='payment_webhook_events_destination_event_key'");
        assert.match(index.rows[0].indexdef, /UNIQUE INDEX .*\(provider, business_id, business_slug, provider_event_id\) NULLS NOT DISTINCT/);
        await admin.query("INSERT INTO payment_webhook_events(id,provider,provider_event_id,business_id,business_slug) VALUES ($1,'legacy','evt-legacy',$2,$3)", [randomUUID(), businessB, slugB]);
        await assert.rejects(admin.query("INSERT INTO payment_webhook_events(id,provider,provider_event_id,business_id,business_slug) VALUES ($1,'legacy','evt-legacy',$2,$3)", [randomUUID(), businessB, slugB]), { code: '23505' });
      } finally {
        await admin.query('ROLLBACK');
      }
    });

    it('lets two businesses receive the same provider event ID and keeps each one private', async () => {
      const first = await deliver({ transaction_id: 'evt-shared', metadata: { businessSlug: slugA, customerPhone: '50255550001' } });
      const second = await deliver({ transaction_id: 'evt-shared', metadata: { businessSlug: slugB, customerPhone: '50255550002' } });
      assert.equal(first.applied, true);
      assert.equal(second.applied, true);
      assert.notEqual(first.eventId, second.eventId);
      const rows = await eventsFor('cubo', 'evt-shared');
      assert.deepEqual(rows.map(row => [row.business_id, row.status]).sort(), [[businessA, 'APPLIED'], [businessB, 'APPLIED']].sort());
      for (const [tenant, own] of [[businessA, first.eventId], [businessB, second.eventId]]) {
        const visible = await asRuntime({ tenantId: tenant }, () => payments.listPaymentWebhookEventsForBusiness({ businessId: tenant }));
        assert.deepEqual(visible.filter(row => row.provider_event_id === 'evt-shared').map(row => row.id), [own]);
      }
      const replay = await deliver({ transaction_id: 'evt-shared', metadata: { businessSlug: slugA, customerPhone: '50255550001' } });
      assert.deepEqual([replay.duplicate, replay.eventId], [true, first.eventId]);
    });

    it('never lets a business take over an unmapped event with the same ID', async () => {
      const orphan = await deliver({ transaction_id: 'evt-orphan', amount: '77.00', metadata: { customerPhone: '50255559999' } });
      assert.deepEqual([orphan.pending, orphan.reason], [true, 'missing_business_slug']);
      const again = await deliver({ transaction_id: 'evt-orphan', amount: '77.00', metadata: { customerPhone: '50255559999' } });
      assert.equal(again.eventId, orphan.eventId);
      const mapped = await deliver({ transaction_id: 'evt-orphan', amount: '12.00', metadata: { businessSlug: slugA, customerPhone: '50255550001' } });
      assert.equal(mapped.applied, true);
      assert.notEqual(mapped.eventId, orphan.eventId);
      const rows = await eventsFor('cubo', 'evt-orphan');
      const unmapped = rows.find(row => row.id === orphan.eventId);
      assert.equal(unmapped.business_id, null);
      assert.equal(unmapped.status, 'PENDING_MAPPING');
      assert.equal(unmapped.payload.metadata.customerPhone, '50255559999');
      const visible = await asRuntime({ tenantId: businessA }, () => payments.listPaymentWebhookEventsForBusiness({ businessId: businessA }));
      assert.deepEqual(visible.filter(row => row.provider_event_id === 'evt-orphan').map(row => row.id), [mapped.eventId]);
      assert.equal(JSON.stringify(visible).includes('50255559999'), false);
      // The tenant cannot read or claim the unmapped row through RLS either.
      const claimed = await asRuntime({ tenantId: businessA }, () => db.dbQuery("UPDATE payment_webhook_events SET business_id=$1 WHERE id=$2", [businessA, orphan.eventId]));
      assert.equal(claimed.rowCount, 0);
      // Ingest mode plus a tenant passes both policies; the database still refuses the move.
      await assert.rejects(asRuntime({ tenantId: businessA }, async () => {
        await db.setWebhookIngest(true);
        return db.dbQuery("UPDATE payment_webhook_events SET business_id=$1 WHERE id=$2", [businessA, orphan.eventId]);
      }), { code: '42501' });
      assert.equal((await eventsFor('cubo', 'evt-orphan')).find(row => row.id === orphan.eventId).business_id, null);
    });

    it('still clears the business of its events when a business is deleted', async () => {
      const gone = randomUUID();
      await admin.query("INSERT INTO businesses(id,name,slug,email,password_hash,program_type,program_json) VALUES ($1,'Cerrado',$2,$3,'fixture','SPEND','{}')", [gone, `gone-${gone.slice(0, 8)}`, `${gone}@example.test`]);
      await admin.query("INSERT INTO payment_webhook_events(id,provider,provider_event_id,business_id,business_slug) VALUES ($1,'cubo','evt-orphan',$2,$3)", [randomUUID(), gone, `gone-${gone.slice(0, 8)}`]);
      await admin.query('DELETE FROM businesses WHERE id=$1', [gone]);
      const rows = await eventsFor('cubo', 'evt-orphan');
      assert.deepEqual(rows.filter(row => row.business_slug === `gone-${gone.slice(0, 8)}`).map(row => row.business_id), [null]);
    });

    it('deduplicates unmapped events by the slug they addressed', async () => {
      for (const slug of ['nobody-x', 'nobody-y', 'nobody-x']) {
        await assert.rejects(deliver({ transaction_id: 'evt-unknown', metadata: { businessSlug: slug, customerPhone: '50255550001' } }), { statusCode: 404 });
      }
      const rows = await eventsFor('cubo', 'evt-unknown');
      assert.deepEqual(rows.map(row => [row.business_slug, row.business_id, row.status]), [['nobody-x', null, 'FAILED'], ['nobody-y', null, 'FAILED']]);
    });

    it('records an invalid amount without applying it and applies the corrected redelivery', async () => {
      const before = awards.length;
      await assert.rejects(deliver({ transaction_id: 'evt-amount', amount: 'abc', metadata: { businessSlug: slugA, customerPhone: '50255550001' } }), { statusCode: 400 });
      assert.equal(awards.length, before);
      let [row] = await eventsFor('cubo', 'evt-amount');
      assert.deepEqual([row.status, row.reason, Number(row.amount_q)], ['FAILED', 'invalid_amount', 0]);
      const corrected = await deliver({ transaction_id: 'evt-amount', amount: '15.25', metadata: { businessSlug: slugA, customerPhone: '50255550001' } });
      assert.equal(corrected.applied, true);
      assert.equal(awards.at(-1).amount_q, 15.25);
      [row] = await eventsFor('cubo', 'evt-amount');
      assert.deepEqual([row.status, Number(row.amount_q)], ['APPLIED', 15.25]);
    });
  });

  describe('outbound webhook delivery lease', () => {
    const endpoint = randomUUID();
    const delivery = async (patch = {}) => {
      const id = randomUUID();
      await admin.query(`INSERT INTO webhook_deliveries(id,endpoint_id,event,payload,status,attempts,claimed_at,created_at)
        VALUES ($1,$2,'customer.created','{}',$3,$4,$5,$6)`, [id, endpoint, patch.status ?? 'PENDING', patch.attempts ?? 0, patch.claimed_at ?? null, patch.created_at ?? new Date()]);
      return id;
    };
    const row = async id => (await admin.query('SELECT * FROM webhook_deliveries WHERE id=$1', [id])).rows[0];
    const claim = (limit = 10) => asRuntime({ platformAdmin: true }, () => WebhookRepo.claimPending(limit, 3, 120));

    before(async () => {
      await admin.query("INSERT INTO webhook_endpoints(id,business_id,url,secret,events,active) VALUES ($1,$2,'https://hooks.example.test/pf','fixture-secret','[\"*\"]',true)", [endpoint, businessA]);
    });

    it('applies the lease migration idempotently and starts the lease of rows already sending', async () => {
      const stuck = await delivery({ status: 'SENDING' });
      const sql = await migration('2026-11-17-integrations-webhook-delivery-lease.sql');
      await admin.query(sql);
      await admin.query(sql);
      assert.ok((await row(stuck)).claimed_at instanceof Date);
      await admin.query('DELETE FROM webhook_deliveries WHERE id=$1', [stuck]);
    });

    it('reclaims a delivery abandoned in SENDING and fences out the abandoned worker', async () => {
      const first = await delivery({ created_at: new Date(Date.now() - 2000) });
      const second = await delivery({ created_at: new Date(Date.now() - 1000) });
      const claimed = await claim();
      assert.deepEqual(claimed.map(job => job.id), [first, second]);
      assert.ok(claimed.every(job => job.claim_token && job.business_id === businessA));
      assert.equal((await row(first)).status, 'SENDING');
      // Deliveries still within their lease are not handed to another worker.
      assert.deepEqual(await claim(), []);

      // The worker holding `first` dies; its lease runs out.
      await admin.query("UPDATE webhook_deliveries SET claimed_at=now()-interval '10 minutes' WHERE id=$1", [first]);
      const [reclaimed] = await claim();
      assert.equal(reclaimed.id, first);
      assert.notEqual(reclaimed.claim_token, claimed[0].claim_token);
      assert.deepEqual([(await row(first)).attempts, (await row(first)).last_error], [1, 'Delivery claim expired']);

      const asTenant = task => asRuntime({ tenantId: businessA }, task);
      assert.equal(await asTenant(() => WebhookRepo.markSent(first, claimed[0].claim_token)), false);
      assert.equal(await asRuntime({ tenantId: businessB }, () => WebhookRepo.markSent(first, reclaimed.claim_token)), false);
      assert.equal((await row(first)).status, 'SENDING');
      assert.equal(await asTenant(() => WebhookRepo.markSent(first, reclaimed.claim_token)), true);
      assert.deepEqual([(await row(first)).status, (await row(first)).claim_token], ['SENT', null]);

      assert.equal(await asTenant(() => WebhookRepo.recordFailure(second, 'HTTP 500', 3, randomUUID())), false);
      assert.equal(await asTenant(() => WebhookRepo.recordFailure(second, 'HTTP 500', 3, claimed[1].claim_token)), true);
      assert.deepEqual([(await row(second)).status, (await row(second)).attempts], ['PENDING', 1]);
      assert.deepEqual((await claim()).map(job => job.id), [second]);
      const token = (await row(second)).claim_token;
      assert.equal(await asTenant(() => WebhookRepo.markSent(second, token)), true);
    });

    it('stops an abandoned delivery that has no attempts left and leaves legacy claims a full lease', async () => {
      const exhausted = await delivery({ status: 'SENDING', attempts: 2, claimed_at: new Date(Date.now() - 3600_000) });
      const legacy = await delivery({ status: 'SENDING' });
      assert.deepEqual(await claim(), []);
      assert.deepEqual([(await row(exhausted)).status, (await row(exhausted)).attempts], ['FAILED', 3]);
      const stamped = await row(legacy);
      assert.equal(stamped.status, 'SENDING');
      assert.ok(stamped.claimed_at instanceof Date);
    });
  });
});
