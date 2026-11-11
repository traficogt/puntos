import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, describe, it } from 'node:test';
import pg from 'pg';

// Opt in only to this disposable fixture; never inherit the application's DB URL.
const url = process.env.MERCHANT_OPERATIONS_TEST_DB_URL;
const suite = url ? describe : describe.skip;
const businessId = randomUUID(), otherBusiness = randomUUID();
const now = new Date('2026-11-10T18:00:00Z');
let admin, database, service, featureOverrides, providerReadiness;

function section(result, id) { return result.sections.find(value => value.id === id); }
function metrics(value) { return Object.fromEntries(value.metrics.map(item => [item.key, item.value])); }
async function context(tenantId, fn, { runtime = true } = {}) {
  const client = await admin.connect();
  try {
    await client.query('BEGIN READ ONLY');
    if (runtime) await client.query('SET LOCAL ROLE merchant_operations_rls');
    await client.query("SELECT set_config('app.current_tenant',$1,true),set_config('app.platform_admin','',true)", [tenantId]);
    return await database.runWithDbContext({ client, tenantId, platformAdmin: false }, fn);
  } finally { await client.query('ROLLBACK'); client.release(); }
}
const health = (tenantId = businessId, options = {}) => context(tenantId, () => service.getOperationsHealth({ businessId: tenantId, now }), options);
/** @param {string} [tenantId] */
async function customer(tenantId = businessId) {
  const id = randomUUID();
  await admin.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,$3,'Fixture customer')", [id, tenantId, id]);
  return id;
}
async function message({ tenantId = businessId, status = 'queued', due = now, lease = null, updated = now } = {}) {
  const campaignId = randomUUID(), customerId = await customer(tenantId), id = randomUUID();
  await admin.query("INSERT INTO growth_campaigns(id,business_id,request_id,name,bonus_points,minimum_purchase_q,duration_days,holdout_percent) VALUES($1,$2,$3,'Fixture',50,20,30,20)", [campaignId, tenantId, randomUUID()]);
  await admin.query("INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation) VALUES($1,$2,$3,$4,'treatment')", [randomUUID(), tenantId, campaignId, customerId]);
  await admin.query(`INSERT INTO growth_message_outbox(id,business_id,campaign_id,customer_id,status,next_attempt_at,lease_until,updated_at,provider_reference,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'private-provider-reference','private-provider-error')`, [id, tenantId, campaignId, customerId, status, due, lease, updated]);
  return id;
}
async function pass({ tenantId = businessId, provider = 'apple', pending = false, attempts = 0, due = now, updated = now, revoked = false } = {}) {
  const id = randomUUID(), customerId = await customer(tenantId);
  await admin.query(`INSERT INTO native_wallet_passes(id,business_id,customer_id,provider,membership_token,membership_hash,authentication_token,
    revision,synced_revision,attempts,next_attempt_at,created_at,updated_at,revoked_at)
    VALUES($1,$2,$3,$4,'private-membership-token',$5,'private-auth-token',10,$6,$7,$8,$9,$9,$10)`,
  [id, tenantId, customerId, provider, createHash('sha256').update(id).digest('hex'), pending ? 0 : 10, attempts, due, updated, revoked ? updated : null]);
  return id;
}

async function lifecycleMessage({ tenantId = businessId, status = 'queued', due = now, lease = null, expires = new Date(now.getTime()+86400000), updated = now } = {}) {
  const customerId = await customer(tenantId), eventId = randomUUID();
  await admin.query("INSERT INTO lifecycle_events(id,business_id,customer_id,event_type,event_date) VALUES($1,$2,$3,'birthday',$4)", [eventId,tenantId,customerId,now]);
  await admin.query(`INSERT INTO lifecycle_message_outbox(id,business_id,customer_id,event_id,rule,points,status,next_attempt_at,lease_until,expires_at,updated_at,reason)
    VALUES($1,$2,$3,$4,'birthday',5,$5,$6,$7,$8,$9,'private-lifecycle-reason')`, [randomUUID(),tenantId,customerId,eventId,status,due,lease,expires,updated]);
}
async function refund({ tenantId = businessId, reason = 'partial_refund', updated = now } = {}) {
  await admin.query(`INSERT INTO pos_refund_receipts(id,business_id,source,refund_id,original_sale_id,amount_q,origin,fingerprint,reason,updated_at)
    VALUES($1,$2,'fixture','private-refund','private-sale',5,'api',$3,$4,$5)`, [randomUUID(),tenantId,'a'.repeat(64),reason,updated]);
}
/** @param {{tenantId?: string, active?: boolean, validUntil?: Date|null, cost?: number|null}} [options] */
async function reward({ tenantId = businessId, active = true, validUntil = null, cost } = {}) {
  const id = randomUUID();
  await admin.query("INSERT INTO rewards(id,business_id,name,points_cost,active,valid_until) VALUES($1,$2,'Fixture reward',10,$3,$4)", [id,tenantId,active,validUntil]);
  if (cost !== undefined) await admin.query('INSERT INTO reward_unit_costs(business_id,reward_id,unit_cost_q) VALUES($1,$2,$3)', [tenantId,id,cost]);
  return id;
}
/** @param {{tenantId?: string, rewardId?: string, cost?: number|null, snapshot?: boolean, status?: string}} [options] */
async function redemption({ tenantId = businessId, rewardId, cost, snapshot = true, status = 'REDEEMED' } = {}) {
  const id = randomUUID(), customerId = await customer(tenantId);
  await admin.query('INSERT INTO redemptions(id,business_id,reward_id,customer_id,points_cost,status,code,created_at,redeemed_at) VALUES($1,$2,$3,$4,10,$5,$6,$7,$7)', [id,tenantId,rewardId,customerId,status,randomUUID(),now]);
  if (snapshot) await admin.query('INSERT INTO redemption_cost_snapshots(redemption_id,business_id,reward_id,points_cost,unit_cost_q,redeemed_at) VALUES($1,$2,$3,10,$4,$5)', [id,tenantId,rewardId,cost??null,now]);
  return id;
}

suite('merchant operations on disposable PostgreSQL', () => {
  before(async () => {
    const parsed = new URL(url);
    assert.equal(process.env.NODE_ENV, 'test');
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
    assert.ok((parsed.pathname === '/merchant_operations_test' && parsed.port === '55443') || (parsed.pathname === '/operations_readiness_test' && parsed.port === '55453'));
    Object.assign(process.env, {
      DB_HOST: parsed.hostname, DB_PORT: parsed.port, DB_NAME: parsed.pathname.slice(1),
      DB_USER: decodeURIComponent(parsed.username), DB_PASSWORD: decodeURIComponent(parsed.password), DB_PASSWORD_FILE: '',
      DB_MIGRATIONS_PASSWORD_FILE: '', JWT_SECRET_FILE: '', JWT_SECRET: 'fixture-merchant-operations-secret-12345678'
    });
    admin = new pg.Pool({ connectionString: url });
    await admin.query('DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public');
    for (const path of [
      '../../src/app/schema.sql', '../../src/app/migrations/2026-02-27-tenant-rls_canonical.sql',
      '../../src/app/migrations/2026-11-09-native-wallet.sql', '../../src/app/migrations/2026-11-10-customer-recovery.sql',
      '../../src/app/migrations/2026-11-10-growth-campaigns.sql', '../../src/app/migrations/2026-11-10-growth-messaging.sql',
      '../../src/app/migrations/2026-11-10-automation-controls.sql', '../../src/app/migrations/2026-11-10-pos-refunds.sql',
      '../../src/app/migrations/2026-11-10-reward-economics.sql', '../../src/app/migrations/2026-11-11-reward-promises-hospitality.sql', '../../src/app/migrations/2026-11-11-wallet-engagement.sql'
    ]) {
      // Repository-owned fixture paths only.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await admin.query(await readFile(new URL(path, import.meta.url), 'utf8'));
    }
    await admin.query(`CREATE TABLE weekly_owner_briefs(id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,status text NOT NULL,lease_until timestamptz,next_attempt_at timestamptz,expires_at timestamptz,updated_at timestamptz DEFAULT now());
      ALTER TABLE weekly_owner_briefs ENABLE ROW LEVEL SECURITY; ALTER TABLE weekly_owner_briefs FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON weekly_owner_briefs USING(app.is_platform_admin() OR business_id=app.current_tenant()) WITH CHECK(app.is_platform_admin() OR business_id=app.current_tenant());
      ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS verified_email text; ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;`);
    await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='merchant_operations_rls') THEN
      CREATE ROLE merchant_operations_rls NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;
      GRANT USAGE ON SCHEMA public,app TO merchant_operations_rls;
      GRANT SELECT ON weekly_owner_briefs,staff_users,businesses,customers,growth_message_outbox,lifecycle_message_outbox,native_wallet_passes,pos_refund_receipts,rewards,reward_unit_costs,redemptions,redemption_cost_snapshots TO merchant_operations_rls;`);
    database = await import('../../src/app/database.js');
    const { createMerchantOperationsService } = await import('../../src/app/services/merchant-operations-service.js');
    service = createMerchantOperationsService({ getFeatureOverrides: async () => featureOverrides, getProviderReadiness: async () => providerReadiness });
  });
  after(async () => { await database?.closeDatabase(); await admin?.end(); });
  beforeEach(async () => {
    featureOverrides = {};
    providerReadiness = {};
    await admin.query('TRUNCATE native_wallet_passes,businesses CASCADE');
    await admin.query(`INSERT INTO businesses(id,name,slug,email,password_hash,plan) VALUES
      ($1,'Fixture','fixture','fixture@example.invalid','unused','EMPRESA'),
      ($2,'Other fixture','other-fixture','other@example.invalid','unused','EMPRESA')`, [businessId, otherBusiness]);
  });

  it('reports owner brief failures independently with tenant-scoped read-only diagnostics',async()=>{
    await admin.query("INSERT INTO weekly_owner_briefs(id,business_id,status,expires_at,updated_at) VALUES($1,$2,'failed',$3,$3),($4,$5,'uncertain',$3,$3)",[randomUUID(),businessId,now,randomUUID(),otherBusiness]);
    featureOverrides={EMPRESA:{campaign_rules:false}};
    const result=await health(),brief=section(result,'owner_brief');assert.equal(brief.state,'needs_attention');assert.equal(metrics(brief).failed,1);assert.equal(metrics(brief).uncertain,0);assert.equal(section(result,'messaging').state,'not_in_plan');assert.equal((await admin.query('SELECT count(*)::int n FROM weekly_owner_briefs')).rows[0].n,2);
  });
  it('returns explicit empty history from a read-only runtime role on every plan', async () => {
    for (const plan of ['EMPRENDEDOR', 'NEGOCIO', 'EMPRESA']) {
      await admin.query('UPDATE businesses SET plan=$2 WHERE id=$1', [businessId, plan]);
      const result = await health();
      assert.equal(result.sections.length, 6);
      assert.equal(section(result, 'pos').state, plan === 'EMPRESA' ? 'not_configured' : 'not_in_plan');
      assert.equal(section(result, 'messaging').state, plan === 'EMPRENDEDOR' ? 'not_in_plan' : 'unknown');
      for (const id of ['apple_wallet', 'google_wallet']) {
        assert.equal(section(result, id).state, 'unknown');
        assert.equal(metrics(section(result, id)).registered, 0);
        assert.equal(section(result, id).last_observed_at, null);
      }
    }
  });

  it('counts message outcomes, overdue queue and expired processing leases without changing any row', async () => {
    await message({ status: 'queued', due: new Date(now.getTime() - 2 * 3600000) });
    await message({ status: 'queued', due: new Date(now.getTime() + 2 * 3600000) });
    await message({ status: 'processing', lease: new Date(now.getTime() - 60000) });
    await message({ status: 'processing', lease: new Date(now.getTime() + 60000) });
    await message({ status: 'accepted' });
    await message({ status: 'failed' });
    await message({ status: 'uncertain' });
    await message({ status: 'suppressed' });
    const beforeRows = (await admin.query('SELECT * FROM growth_message_outbox ORDER BY id')).rows;
    const result = await health(), value = section(result, 'messaging');
    assert.equal(value.state, 'needs_attention');
    assert.deepEqual(metrics(value), { queued: 2, processing: 2, accepted: 1, failed: 1, uncertain: 1, suppressed: 1, stale: 2, stale_queue: 1, stale_processing: 1, expired: 0 });
    assert.equal(value.last_observed_at, now.toISOString());
    assert.match(value.summary, /no confirma la entrega/);
    assert.deepEqual((await admin.query('SELECT * FROM growth_message_outbox ORDER BY id')).rows, beforeRows);
    for (const row of beforeRows) for (const secret of [row.id, row.customer_id, row.provider_reference, row.reason]) assert.equal(JSON.stringify(result).includes(secret), false);
  });

  it('reads recorded POS synchronization and backlog without returning receipt or credential contents', async () => {
    const program = {
      external_awards: { enabled: true, api_key: 'private-api-key' },
      pos_integration: {
        enabled: true, mode: 'loyverse', automatic: true, connected_at: '2026-11-07T18:00:00Z',
        last_completed_at: '2026-11-08T18:00:00Z',
        loyverse: { access_token: 'private-pos-token', merchant_id: 'private-merchant' },
        pending_receipts: ['private-receipt'],
        last_sync: { at: now.toISOString(), status: 'ok', pending: 2, errors: 0, issues: [{ customerPhone: '+50255550001', message: 'private-provider-error' }] }
      }
    };
    await admin.query('UPDATE businesses SET program_json=$2 WHERE id=$1', [businessId, program]);
    const result = await health(), value = section(result, 'pos');
    assert.equal(value.state, 'needs_attention');
    assert.match(value.summary, /24 horas/);
    assert.equal(value.last_observed_at, now.toISOString());
    assert.equal(metrics(value).pending_receipts, 2);
    assert.equal(metrics(value).last_completed_at, '2026-11-08T18:00:00.000Z');
    assert.equal(JSON.stringify(result).includes('private-'), false);
    assert.equal(JSON.stringify(result).includes('+50255550001'), false);
    assert.deepEqual((await admin.query('SELECT program_json FROM businesses WHERE id=$1', [businessId])).rows[0].program_json, program);
  });

  it('counts active and revoked registered Wallet passes and pending failures without claiming issuance', async () => {
    providerReadiness = { apple_wallet: true, google_wallet: true };
    await pass({ provider: 'apple' });
    await pass({ provider: 'apple', pending: true, attempts: 1, due: new Date(now.getTime() - 2 * 3600000), revoked: true });
    await pass({ provider: 'google', pending: true });
    await pass({ provider: 'google', attempts: 3 });
    const result = await health();
    assert.deepEqual(metrics(section(result, 'apple_wallet')), { registered: 2, pending: 1, failed: 1, stale: 1 });
    assert.deepEqual(metrics(section(result, 'google_wallet')), { registered: 2, pending: 1, failed: 0, stale: 0 });
    assert.equal(section(result, 'apple_wallet').state, 'needs_attention');
    assert.equal(section(result, 'google_wallet').state, 'configured');
    assert.match(section(result, 'google_wallet').summary, /no confirman.*emisión.*instalación/);
    assert.equal(JSON.stringify(result).includes('private-'), false);
  });

  it('uses only the session business and preserves RLS even if the service receives a different tenant', async () => {
    await message({ status: 'accepted' }); await pass({ provider: 'apple' });
    await message({ tenantId: otherBusiness, status: 'failed' }); await pass({ tenantId: otherBusiness, provider: 'google', pending: true, attempts: 2 });
    for (const runtime of [true, false]) {
      const result = await health(businessId, { runtime });
      assert.equal(metrics(section(result, 'messaging')).accepted, 1);
      assert.equal(metrics(section(result, 'messaging')).failed, 0);
      assert.equal(metrics(section(result, 'apple_wallet')).registered, 1);
      assert.equal(metrics(section(result, 'google_wallet')).registered, 0);
    }
    await assert.rejects(context(businessId, () => service.getOperationsHealth({ businessId: otherBusiness, now })), { statusCode: 404 });
    await context(businessId, async () => {
      assert.equal((await database.dbQuery('SELECT * FROM growth_message_outbox')).rowCount, 1);
      assert.equal((await database.dbQuery('SELECT * FROM native_wallet_passes')).rowCount, 1);
      assert.equal((await database.dbQuery('SELECT * FROM businesses')).rowCount, 1);
    });
  });

  it('hides history after a feature downgrade without needing permission to read the locked message table', async () => {
    await message({ status: 'failed' });
    await admin.query("UPDATE businesses SET plan='EMPRENDEDOR',program_json=$2 WHERE id=$1", [businessId, { pos_integration: { pending_receipts: ['private-receipt'], last_sync: { at: now.toISOString() } } }]);
    await admin.query('REVOKE SELECT ON growth_message_outbox FROM merchant_operations_rls');
    try {
      const result = await health();
      for (const id of ['pos', 'messaging']) {
        assert.equal(section(result, id).state, 'not_in_plan');
        assert.deepEqual(section(result, id).metrics, []);
        assert.equal(section(result, id).last_observed_at, null);
      }
    } finally { await admin.query('GRANT SELECT ON growth_message_outbox TO merchant_operations_rls'); }
  });

  it('surfaces real database permission failure rather than claiming zero activity', async () => {
    await admin.query('REVOKE SELECT ON native_wallet_passes FROM merchant_operations_rls');
    try { await assert.rejects(health(), { code: '42501' }); }
    finally { await admin.query('GRANT SELECT ON native_wallet_passes TO merchant_operations_rls'); }
  });

  it('separates configured providers with no history from disabled providers with old or suppressed-only history', async () => {
    providerReadiness = { messaging: true, apple_wallet: true, google_wallet: true };
    const fresh = await health();
    for (const id of ['messaging', 'apple_wallet', 'google_wallet']) assert.equal(section(fresh, id).state, 'configured');
    await message({ status: 'suppressed', updated: new Date('2026-11-01T18:00:00Z') });
    await pass({ provider: 'apple', updated: new Date('2026-11-01T18:00:00Z') });
    await pass({ provider: 'google', updated: new Date('2026-11-01T18:00:00Z') });
    providerReadiness = { messaging: false, apple_wallet: false, google_wallet: false };
    const old = await health();
    for (const id of ['messaging', 'apple_wallet', 'google_wallet']) assert.equal(section(old, id).state, 'not_configured');
    assert.equal(metrics(section(old, 'messaging')).suppressed, 1);
    assert.equal(metrics(section(old, 'apple_wallet')).registered, 1);
  });

  it('a real stored pass left by issuance failure is a registration record, never proof of successful issuance', async () => {
    const { createNativeWalletService } = await import('../../src/app/services/native-wallet/service.js');
    const { NativeWalletRepo } = await import('../../src/app/repositories/native-wallet-repository.js');
    const { CustomerRepo } = await import('../../src/app/repositories/customer-repository.js');
    const customerId = await customer();
    await admin.query('INSERT INTO customer_balances(customer_id,points) VALUES($1,0)', [customerId]);
    const wallet = createNativeWalletService({
      repo: NativeWalletRepo, customerRepo: CustomerRepo,
      settings: { apple: { ready: true }, google: { ready: false } },
      providers: { apple: { generatePass: async () => { throw new Error('fixture issuance failed'); } } },
      globalContext: fn => fn()
    });
    await assert.rejects(database.runWithDbContext({ client: admin, tenantId: businessId, platformAdmin: false },
      () => wallet.issue({ id: customerId, business_id: businessId }, 'apple')), { statusCode: 503 });
    assert.equal((await admin.query('SELECT count(*)::int AS count FROM native_wallet_passes')).rows[0].count, 1);
    providerReadiness = { apple_wallet: false };
    const result = section(await health(), 'apple_wallet');
    assert.equal(metrics(result).registered, 1);
    assert.equal(result.state, 'not_configured');
    assert.match(result.summary, /no confirman.*emisión.*instalación/);
    assert.equal(result.metrics.some(item => /emitid/i.test(item.label)), false);
  });

  it('combines independent queues and diagnoses expired lifecycle work without double counting stale messages', async () => {
    await message({ status: 'accepted' });
    await lifecycleMessage({ status: 'accepted' });
    await lifecycleMessage({ status: 'queued', due: new Date(now.getTime()-7200000), expires: new Date(now.getTime()-1000) });
    await lifecycleMessage({ status: 'processing', lease: now });
    await lifecycleMessage({ status: 'processing', updated: new Date(now.getTime()-7200000) });
    await lifecycleMessage({ status: 'suppressed', expires: new Date(now.getTime()-1000) });
    await lifecycleMessage({ tenantId: otherBusiness, status: 'failed' });
    const beforeRows = (await admin.query('SELECT * FROM lifecycle_message_outbox ORDER BY id')).rows;
    for (const runtime of [true, false]) {
      const result = await health(businessId, { runtime }), item = section(result, 'messaging'), values = metrics(item);
      assert.equal(values.accepted, 2);
      assert.equal(values.failed, 0);
      assert.equal(values.stale, 3);
      assert.equal(values.stale_queue, 1);
      assert.equal(values.stale_processing, 2);
      assert.equal(values.expired, 1);
      assert.equal(metrics(item.sources.find(source => source.id === 'lifecycle')).accepted, 1);
      assert.ok(result.next_actions.some(action => action.id === 'lifecycle_messages' && action.href === '#automatizaciones'));
      assert.equal(result.next_actions.some(action => action.id === 'growth_messages'), false);
      assert.equal(JSON.stringify(result).includes('private-lifecycle-reason'), false);
    }
    assert.deepEqual((await admin.query('SELECT * FROM lifecycle_message_outbox ORDER BY id')).rows, beforeRows);
  });

  it('reads durable refund reasons even without POS configuration and never exposes arbitrary stored reasons', async () => {
    await refund({ reason: 'partial_refund' });
    await refund({ tenantId: otherBusiness, reason: 'insufficient_balance' });
    for (const runtime of [true, false]) {
      const result = await health(businessId, { runtime }), pos = section(result, 'pos');
      assert.equal(pos.state, 'needs_attention');
      assert.equal(metrics(pos).pending_refunds, 1);
      assert.equal(pos.reasons[0].code, 'refund_partial_refund');
      assert.equal(result.next_actions[0].id, 'pos_refunds');
      assert.equal(JSON.stringify(result).includes('private-'), false);
    }
    await admin.query("UPDATE pos_refund_receipts SET reason='private-provider-error' WHERE business_id=$1", [businessId]);
    assert.equal(section(await health(), 'pos').reasons[0].code, 'refund_other');
  });

  it('reports immutable historical cost coverage without reading current costs into old redemptions', async () => {
    const id = await reward({ cost: 0 });
    await reward();
    await reward({ cost: null });
    await reward({ active: false });
    await reward({ validUntil: new Date(now.getTime()-1) });
    const otherId = await reward({ tenantId: otherBusiness });
    await redemption({ rewardId: id, cost: 0 });
    await redemption({ rewardId: id, cost: null });
    await redemption({ rewardId: id, snapshot: false });
    await redemption({ rewardId: id, snapshot: false, status: 'PENDING' });
    await redemption({ tenantId: otherBusiness, rewardId: otherId, snapshot: false });
    // Legacy single-column FKs allow inconsistent tenant references; never count them.
    await redemption({ rewardId: otherId, snapshot: false });
    const beforeRows = (await admin.query('SELECT * FROM redemption_cost_snapshots ORDER BY redemption_id')).rows;
    for (const runtime of [true, false]) {
      const result = await health(businessId, { runtime }), values = metrics(section(result, 'economics'));
      assert.equal(values.active_rewards, 3);
      assert.equal(values.missing_reward_costs, 2);
      assert.equal(values.completed_redemptions, 3);
      assert.equal(values.costed_redemptions, 1);
      assert.equal(values.missing_cost_snapshots, 1);
      assert.equal(values.unknown_snapshot_costs, 1);
      assert.equal(values.unknown_cost_redemptions, 2);
      assert.equal(values.cost_coverage_pct, 33.33);
      assert.equal(section(result, 'economics').state, 'needs_attention');
    }
    await admin.query('UPDATE reward_unit_costs SET unit_cost_q=8 WHERE business_id=$1 AND reward_id=$2', [businessId,id]);
    assert.equal(metrics(section(await health(), 'economics')).cost_coverage_pct, 33.33);
    assert.deepEqual((await admin.query('SELECT * FROM redemption_cost_snapshots ORDER BY redemption_id')).rows, beforeRows);
  });

  it('treats a true zero cost as healthy but does not call an empty or unavailable table healthy', async () => {
    const id = await reward({ cost: 0 });
    await redemption({ rewardId: id, cost: 0 });
    const result = await health();
    assert.equal(section(result, 'economics').state, 'healthy');
    assert.equal(metrics(section(result, 'economics')).cost_coverage_pct, 100);
    assert.equal(result.summary.healthy_count, 1);
    assert.equal(result.summary.attention_count, 0);
    await admin.query('ALTER TABLE lifecycle_message_outbox RENAME TO lifecycle_message_outbox_fixture_missing');
    try { await assert.rejects(health(), { code: '42P01' }); }
    finally { await admin.query('ALTER TABLE lifecycle_message_outbox_fixture_missing RENAME TO lifecycle_message_outbox'); }
  });

});
