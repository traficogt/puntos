import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';

const url = process.env.AUTOMATION_TEST_DB_URL;
const suite = url ? describe : describe.skip;
const now = new Date('2026-11-10T15:00:00Z');
let db, database, automations, campaigns, plans, originalPlans, logger, originalWarn;
const events = [];
const counts = { accepted: 0, failed: 0, uncertain: 0, suppressed: 0 };

suite('marketing dispatcher tenant isolation on disposable PostgreSQL', () => {
  before(async () => {
    const parsed = new URL(url);
    assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname));
    assert.equal(parsed.pathname, '/automation_test');
    Object.assign(process.env, { NODE_ENV: 'test', DB_HOST: parsed.hostname, DB_PORT: parsed.port, DB_NAME: 'automation_test', DB_USER: decodeURIComponent(parsed.username), DB_PASSWORD: decodeURIComponent(parsed.password), DB_PASSWORD_FILE: '', DB_MIGRATIONS_PASSWORD_FILE: '', JWT_SECRET_FILE: '', JWT_SECRET: 'fixture-automation-secret-12345678' });
    db = new pg.Pool({ connectionString: url });
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS app');
    await db.query(`CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_tenant',true),'')::uuid $$; CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.platform_admin',true),'')='true' $$`);
    for (const file of ['../../src/app/schema.sql', '../../src/app/migrations/2026-11-10-customer-recovery.sql', '../../src/app/migrations/2026-11-10-growth-campaigns.sql', '../../src/app/migrations/2026-11-10-growth-messaging.sql', '../../src/app/migrations/2026-11-10-growth-limits.sql', '../../src/app/migrations/2026-11-10-automation-controls.sql']) {
      // These migration filenames are fixed by this fixture.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await db.query(await readFile(new URL(file, import.meta.url), 'utf8'));
    }
    database = await import('../../src/app/database.js');
    automations = await import('../../src/app/services/automation-message-service.js');
    campaigns = await import('../../src/app/services/campaign-message-service.js');
    plans = (await import('../../src/app/services/plan-config-service.js')).PlanConfigService;
    logger = (await import('../../src/utils/logger.js')).logger;
    originalPlans = plans.getPlanFeatureOverrides;
    originalWarn = logger.warn;
    logger.warn = (...args) => { events.push({ type: 'warning', args }); };
  });
  beforeEach(async () => {
    plans.getPlanFeatureOverrides = async () => ({});
    events.length = 0;
    await db.query('TRUNCATE businesses CASCADE');
  });
  after(async () => {
    if (plans) plans.getPlanFeatureOverrides = originalPlans;
    if (logger) logger.warn = originalWarn;
    await database?.closeDatabase();
    await db?.end();
  });

  for (const [kind, table] of [['automation', 'lifecycle_message_outbox'], ['campaign', 'growth_message_outbox']]) {
    for (const failure of ['configuration', 'claim', 'persistence']) {
      it(`${kind}: a tenant ${failure} failure cannot block the next tenant or resend uncertain work`, async () => {
        for (let i = 0; i < 2; i++) {
          const businessId = randomUUID(), customerId = randomUUID(), parentId = randomUUID();
          await db.query(`INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_json) VALUES($1,'Fixture',$2,$3,'unused','NEGOCIO',$4)`, [businessId, `isolation-${i}`, `fixture${i}@example.test`, { lifecycle: { birthday_enabled: true } }]);
          await db.query(`INSERT INTO customers(id,business_id,phone) VALUES($1,$2,$3)`, [customerId, businessId, `+5025555000${i}`]);
          await db.query('INSERT INTO customer_marketing_preferences(business_id,customer_id,marketing_opt_in) VALUES($1,$2,true)', [businessId, customerId]);
          if (kind === 'automation') {
            await db.query(`INSERT INTO lifecycle_events(id,business_id,customer_id,event_type,event_date) VALUES($1,$2,$3,'birthday','2026-11-10')`, [parentId, businessId, customerId]);
            await db.query(`INSERT INTO lifecycle_message_outbox(id,business_id,customer_id,event_id,rule,points,next_attempt_at,expires_at) VALUES($1,$2,$3,$4,'birthday',0,$5,$6)`, [randomUUID(), businessId, customerId, parentId, now, new Date(now.getTime() + 2 * 86400000)]);
          } else {
            await db.query(`INSERT INTO growth_campaigns(id,business_id,request_id,name,status,bonus_points,minimum_purchase_q,duration_days,holdout_percent,starts_at,expires_at) VALUES($1,$2,$3,'Fixture','active',50,20,30,20,$4,$5)`, [parentId, businessId, randomUUID(), now, new Date(now.getTime() + 30 * 86400000)]);
            await db.query(`INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation) VALUES($1,$2,$3,$4,'treatment')`, [randomUUID(), businessId, parentId, customerId]);
            await db.query(`INSERT INTO growth_message_outbox(id,business_id,campaign_id,customer_id,next_attempt_at) VALUES($1,$2,$3,$4,$5)`, [randomUUID(), businessId, parentId, customerId, now]);
          }
        }
        // Pick the first business from the dispatcher's own query ordering so
        // the test checks that a later business runs after the injected failure.
        const businesses = (await db.query(`SELECT DISTINCT business_id FROM ${table} WHERE status IN ('queued','processing') OR (status='failed' AND attempts<3)`)).rows;
        const bad = businesses[0].business_id, healthy = businesses[1].business_id;
        const dispatch = kind === 'automation' ? automations.processAutomationMessagesOnce : campaigns.processCampaignMessagesOnce;
        const send = async ({ businessId }) => {
          events.push({ type: 'send', businessId });
          return { ok: true, accepted: true, provider: 'fixture', providerId: 'fixture-only' };
        };
        if (failure === 'configuration') {
          plans.getPlanFeatureOverrides = async () => {
            if (database.getDbTenantId() === bad) throw new Error('private configuration fixture +50255559999');
            return {};
          };
        } else {
          await db.query(`CREATE FUNCTION fail_dispatch_tenant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
            IF NEW.business_id=TG_ARGV[0]::uuid AND NEW.status=TG_ARGV[1] THEN RAISE EXCEPTION 'private SQL fixture +50255559999'; END IF;
            RETURN NEW; END $$`);
          // Table names are fixed above; the trigger arguments are generated UUID/status values.
          await db.query(`CREATE TRIGGER fail_dispatch_tenant BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_dispatch_tenant('${bad}','${failure === 'claim' ? 'processing' : 'accepted'}')`);
        }
        try {
          assert.deepEqual(await dispatch({ now: () => now, send }), { ...counts, accepted: 1 });
          const warning = events.find(event => event.type === 'warning');
          assert.ok(warning, 'The failed tenant must be reported without exception details');
          assert.deepEqual(warning.args[0], { businessId: bad, stage: `${kind}_dispatch` });
          assert.doesNotMatch(JSON.stringify(warning), /private|55559999|fixture/);
          const healthySends = events.filter(event => event.type === 'send' && event.businessId === healthy);
          assert.equal(healthySends.length, 1);
          assert.ok(events.indexOf(warning) < events.indexOf(healthySends[0]));
          const badRow = (await db.query(`SELECT status,attempts,claim_token,lease_until FROM ${table} WHERE business_id=$1`, [bad])).rows[0];
          assert.equal(badRow.status, failure === 'persistence' ? 'processing' : 'queued');
          assert.equal(badRow.attempts, failure === 'persistence' ? 1 : 0);
          if (failure === 'persistence') {
            assert.ok(badRow.claim_token);
            assert.ok(badRow.lease_until);
            assert.deepEqual(await dispatch({ now: () => new Date(now.getTime() + 11 * 60000), send }), counts);
            assert.equal((await db.query(`SELECT status FROM ${table} WHERE business_id=$1`, [bad])).rows[0].status, 'uncertain');
            assert.equal(events.filter(event => event.type === 'send' && event.businessId === bad).length, 1);
          } else {
            assert.deepEqual(await dispatch({ now: () => now, send }), counts);
            assert.equal(events.filter(event => event.type === 'send' && event.businessId === bad).length, 0);
          }
          assert.equal(events.filter(event => event.type === 'send' && event.businessId === healthy).length, 1);
        } finally {
          plans.getPlanFeatureOverrides = async () => ({});
          if (failure !== 'configuration') await db.query(`DROP TRIGGER fail_dispatch_tenant ON ${table}; DROP FUNCTION fail_dispatch_tenant()`);
        }
      });
    }
  }
});
