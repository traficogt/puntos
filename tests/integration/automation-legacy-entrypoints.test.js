import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, it } from 'node:test';
import pg from 'pg';

const url = process.env.AUTOMATION_ENTRYPOINTS_TEST_DB_URL;
const businessId = randomUUID(), customerId = randomUUID();
const now = new Date('2026-11-10T15:00:00Z');
let db, database, guided, legacy, preferences, plans, originalPlans;
const context = fn => database.withDbClientContext({ tenantId: businessId, platformAdmin: false }, fn);
before(async () => {
  if (!url) return;
  const parsed = new URL(url);
  assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/automation_entrypoints_test');
  Object.assign(process.env, { NODE_ENV: 'test', DB_HOST: parsed.hostname, DB_PORT: parsed.port, DB_NAME: 'automation_entrypoints_test', DB_USER: decodeURIComponent(parsed.username), DB_PASSWORD: decodeURIComponent(parsed.password), DB_PASSWORD_FILE: '', DB_MIGRATIONS_PASSWORD_FILE: '', JWT_SECRET_FILE: '', JWT_SECRET: 'fixture-automation-secret-12345678' });
  db = new pg.Pool({ connectionString: url });
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS app');
  await db.query(`CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_tenant',true),'')::uuid $$; CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.platform_admin',true),'')='true' $$`);
  for (const file of ['../../src/app/schema.sql', '../../src/app/migrations/2026-11-10-customer-recovery.sql', '../../src/app/migrations/2026-11-10-growth-campaigns.sql', '../../src/app/migrations/2026-11-10-growth-messaging.sql', '../../src/app/migrations/2026-11-10-growth-limits.sql', '../../src/app/migrations/2026-11-10-automation-controls.sql']) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await db.query(await readFile(new URL(file, import.meta.url), 'utf8'));
  }
  database = await import('../../src/app/database.js');
  guided = await import('../../src/app/services/automation-controls-service.js');
  legacy = await import('../../src/app/services/churn-service.js');
  preferences = await import('../../src/app/services/marketing-preference-service.js');
  plans = (await import('../../src/app/services/plan-config-service.js')).PlanConfigService;
  originalPlans = plans.getPlanFeatureOverrides;
  plans.getPlanFeatureOverrides = async () => ({});
  await db.query(`INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_json) VALUES($1,'Fixture','legacy-entrypoints','fixture@example.test','unused','NEGOCIO','{}')`, [businessId]);
  await db.query(`INSERT INTO customers(id,business_id,phone,last_visit_at) VALUES($1,$2,'+50255550001','2026-10-11T15:00:00Z')`, [customerId, businessId]);
  await db.query(`INSERT INTO customer_balances(customer_id,points,lifetime_points) VALUES($1,0,0) ON CONFLICT(customer_id) DO UPDATE SET points=0,lifetime_points=0`, [customerId]);
  await context(() => preferences.setMarketingPreference({ businessId, customerId, marketing_opt_in: true }));
});
after(async () => {
  if (plans) plans.getPlanFeatureOverrides = originalPlans;
  await database?.closeDatabase();
  await db?.end();
});

it('legacy manual triggers honor saved pause/hour/budget and share durable dedupe with minute jobs', { skip: !url }, async () => {
  const trigger = extra => legacy.runChurnOnce({ businessId, now, days: 1, ...extra });
  assert.equal((await trigger({})).reason, 'inactive');
  const settings = { ...guided.automationSettings({}), winback_enabled: true, winback_days: 30, winback_points: 20, winback_monthly_points_cap: 20, scheduler_hour_local: 9 };
  await context(() => guided.saveAutomationSettings({ businessId, settings }));
  assert.equal((await trigger({ now: new Date('2026-11-10T14:00:00Z') })).reason, 'outside_scheduled_hour');
  assert.equal((await db.query('SELECT * FROM transactions')).rowCount, 0);
  const results = await Promise.all([
    trigger({}), trigger({}),
    context(() => guided.runAutomationRule({ businessId, rule: 'winback', now }))
  ]);
  assert.equal(results.reduce((sum, result) => sum + result.queued, 0), 1);
  assert.equal(results[0].sent, 0);
  assert.equal(results[1].sent, 0);
  assert.equal((await db.query('SELECT * FROM lifecycle_events')).rowCount, 1);
  assert.equal((await db.query('SELECT * FROM lifecycle_message_outbox')).rowCount, 1);
  assert.equal(Number((await db.query('SELECT sum(points) AS points FROM transactions')).rows[0].points), 20);
  assert.equal((await db.query('SELECT points_committed FROM lifecycle_automation_budgets')).rows[0].points_committed, 20);
  assert.equal((await db.query('SELECT * FROM message_logs')).rowCount, 0, 'Legacy trigger must never call a provider directly');
  await context(() => guided.saveAutomationSettings({ businessId, settings: { ...settings, winback_enabled: false } }));
  assert.equal((await trigger({})).reason, 'inactive');
  assert.equal((await db.query('SELECT * FROM lifecycle_message_outbox')).rowCount, 1);
});
