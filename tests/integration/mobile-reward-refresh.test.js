/* eslint-disable security/detect-non-literal-fs-filename -- Fixed repository migrations in a disposable test database. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import pg from 'pg';
import { createMobileRoutes } from '../../src/app/routes/mobile-routes.js';
import { createMobilePushService } from '../../src/app/services/mobile-push/service.js';
import { getCustomerRewardProgress } from '../../src/app/services/customer-reward-progress.js';
import { runWithDbContext, withDbClientContext } from '../../src/app/database.js';
import { errorHandler } from '../../src/middleware/common.js';

const databaseUrl = process.env.MOBILE_REWARD_REFRESH_TEST_DATABASE_URL;
test('installed mobile rewards and push use customer-scoped PostgreSQL eligibility', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl);
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55461');
  assert.equal(url.pathname, '/mobile_reward_refresh_test');
  const admin = new pg.Client({ connectionString: databaseUrl });
  const client = new pg.Client({ connectionString: databaseUrl });
  await Promise.all([admin.connect(), client.connect()]);
  const business = randomUUID(), other = randomUUID(), customer = randomUUID(), foreignCustomer = randomUUID();
  const branch = randomUUID(), foreignBranch = randomUUID(), reward = randomUUID(), expensive = randomUUID(), foreignReward = randomUUID(), staff = randomUUID();
  const session = { id: randomUUID(), actor_type: 'CUSTOMER', actor_id: customer, business_id: business,
    idle_expires_at: new Date(Date.now() + 3600000).toISOString(), absolute_expires_at: new Date(Date.now() + 86400000).toISOString() };
  let server;
  try {
    await admin.query('DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public');
    for (const file of ['schema.sql', 'migrations/2026-02-27-tenant-rls_canonical.sql', 'migrations/2026-03-08-ledger-reconciliation.sql', 'migrations/2026-03-08-ledger-corrections.sql', 'migrations/2026-03-08-ledger-balance-adjustments.sql',
      'migrations/2026-11-09-native-wallet.sql', 'migrations/2026-11-11-reward-promises-hospitality.sql', 'migrations/2026-11-11-wallet-engagement.sql',
      'migrations/2026-11-11-service-recovery.sql', 'migrations/2026-11-11-z-pos-fulfillment.sql', 'migrations/2026-11-11-z-reward-catalog.sql']) {
      await admin.query(await readFile(new URL(`../../src/app/${file}`, import.meta.url), 'utf8'));
    }
    await admin.query('DO $$ BEGIN CREATE ROLE mobile_refresh_app NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$; GRANT USAGE ON SCHEMA public,app TO mobile_refresh_app; GRANT SELECT ON ALL TABLES IN SCHEMA public TO mobile_refresh_app');
    await client.query('SET ROLE mobile_refresh_app');
    for (const id of [business, other]) await admin.query("INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_type,program_json) VALUES($1::uuid,'Café',$1::text,$1::text||'@example.invalid','fixture','NEGOCIO','VISIT','{\"points_per_visit\":10}')", [id]);
    for (const [id, tenant] of [[customer, business], [foreignCustomer, other]]) {
      await admin.query("INSERT INTO customers(id,business_id,name,phone) VALUES($1,$2,'Ana','+50255550111')", [id, tenant]);
      await admin.query('INSERT INTO customer_balances(customer_id,points,pending_points) VALUES($1,40,100)', [id]);
    }
    await admin.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$3,'Centro','centro'),($2,$4,'Otra sucursal','otra')", [branch, foreignBranch, business, other]);
    await admin.query("INSERT INTO staff_users(id,business_id,name,email,password_hash,role) VALUES($1,$2,'Staff','staff@example.invalid','fixture','ADMIN')", [staff, business]);
    await admin.query("INSERT INTO rewards(id,business_id,name,description,points_cost,stock,valid_until,active) VALUES($1,$3,'Café original','Tamaño original',50,4,now()+interval '1 day',false),($2,$3,'Postre',null,100,null,null,true),($4,$5,'Foreign reward','Private',1,9,null,true)", [reward, expensive, business, foreignReward, other]);
    await admin.query('INSERT INTO reward_branches(reward_id,branch_id) VALUES($1,$2)', [reward, branch]);
    await admin.query('UPDATE rewards SET active=true WHERE id=$1', [reward]);
    const originalExpiry = (await admin.query('SELECT valid_until FROM rewards WHERE id=$1', [reward])).rows[0].valid_until.toISOString();
    const app = express();
    app.use((req, _res, next) => runWithDbContext({ client, tenantId: other, platformAdmin: false }, next));
    app.use('/api', createMobileRoutes(/** @type {any} */ ({
      getBrowserSession: async token => token === 'fixture-session' ? session : null,
      touchBrowserSessionIfNeeded: async value => value,
      invalidateBrowserSessionById: async () => {},
      PlanConfigService: { getPlanFeatureOverrides: async () => ({}) },
      settlePendingPointsForCustomer: async () => {}, expirePointsForCustomer: async () => {},
      walletService: { status: async () => ({ providers: { apple: false, google: false }, passes: [] }) }
    })));
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/api/mobile/customer`;
    const summary = async () => {
      const response = await fetch(`${base}?business_id=${other}&customer_id=${foreignCustomer}`, { headers: { Authorization: 'Bearer fixture-session' } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      return response.json();
    };
    const scopedProgress = identity => runWithDbContext({ client, tenantId: null, platformAdmin: false }, () =>
      withDbClientContext({ tenantId: identity.businessId, platformAdmin: false }, db => getCustomerRewardProgress(db, identity)));
    const pushKind = async () => {
      const snapshot = { installation_id: randomUUID(), customer_id: customer, business_id: business, token: 'fixture-token', topic: 'fixture-topic',
        points: (await admin.query('SELECT points FROM customer_balances WHERE customer_id=$1', [customer])).rows[0].points,
        pending_points: 100, baseline_points: 10, baseline_pending: 100, revision: '2', plan: 'NEGOCIO' };
      const sent = [];
      const push = createMobilePushService({
        repo: { claimDue: async () => [snapshot], getSnapshot: async () => snapshot, acknowledge: async () => {}, fail: async () => assert.fail('unexpected retry') },
        provider: { send: async value => { sent.push(value); return { accepted: true }; } },
        settings: { ready: true, config: { topic: 'fixture-topic' } }, getRewardProgress: scopedProgress,
        planConfigService: { getPlanFeatureOverrides: async () => ({}) }, globalContext: async fn => fn()
      });
      assert.deepEqual(await push.processDue(), { sent: 1, failed: 0, skipped: 0 });
      return sent[0].payload.kind;
    };
    await t.test('real route includes unaffordable choices without pending points or foreign data', async () => {
      const out = await summary();
      assert.equal(out.business.id, business); assert.equal(out.customer.id, customer);
      assert.equal(out.customer.points, 40); assert.equal(out.customer.pending_points, 100);
      assert.deepEqual(out.rewards.map(row => row.id), [reward, expensive]);
      assert.equal(out.reward_progress.available_points, 40);
      assert.equal(out.reward_progress.reward.remaining_points, 10);
      assert.equal(await pushKind(), 'card');
    });
    await t.test('protected name, description, price, expiry and branch scope survive catalog edits', async () => {
      await admin.query("UPDATE rewards SET name='Changed',description='Changed description',points_cost=20,active=false,valid_until=now()-interval '1 day' WHERE id=$1", [reward]);
      await admin.query('DELETE FROM reward_branches WHERE reward_id=$1', [reward]);
      const out = await summary();
      assert.deepEqual(out.rewards[0], { id: reward, name: 'Café original', description: 'Tamaño original', points_cost: 50,
        active: true, stock: 4, valid_until: originalExpiry, branch_ids: [branch], branch_labels: ['Centro'] });
      assert.equal(out.reward_progress.choices[0].protected, true);
      assert.equal(await pushKind(), 'card', 'edited cheaper catalog cannot unlock protected cost');
      await admin.query('UPDATE customer_balances SET points=60 WHERE customer_id=$1', [customer]);
      assert.equal(await pushKind(), 'rewards', 'protected reward remains available when catalog is inactive and expired');
    });
    await t.test('manual unavailability removes a legacy choice without falsifying stock or expiry', async () => {
      await admin.query('INSERT INTO reward_availability(business_id,reward_id,available,updated_by_staff_id) VALUES($1,$2,false,$3)', [business, reward, staff]);
      const out = await summary();
      assert.deepEqual(out.rewards.map(row => row.id), [expensive]);
      const choice = out.reward_progress.choices.find(row => row.id === reward);
      assert.equal(choice.available, false); assert.equal(choice.stock, 4); assert.equal(new Date(choice.valid_until).toISOString(), originalExpiry);
      assert.equal(await pushKind(), 'card');
      await admin.query('UPDATE reward_availability SET available=true WHERE reward_id=$1', [reward]);
    });
    await t.test('stale required inventory hides the protected reward until fresh evidence arrives', async () => {
      await admin.query('UPDATE businesses SET program_json=program_json||\'{"pos_inventory_checks":true}\' WHERE id=$1', [business]);
      await admin.query("INSERT INTO merchant_catalog_items(id,business_id,source,product_ref,name,item_kind,active,origin,revision) VALUES($1,$2,'fixture-pos','coffee','Coffee','product',true,'connector',1)", [randomUUID(), business]);
      await admin.query("INSERT INTO reward_pos_mappings(id,business_id,reward_id,branch_id,source,product_ref,item_name,item_kind,quantity,inventory_required) VALUES($1,$2,$3,$4,'fixture-pos','coffee','Coffee','product',1,true)", [randomUUID(), business, reward, branch]);
      await admin.query("INSERT INTO merchant_inventory_snapshots(business_id,source,branch_id,product_ref,available_quantity,observed_at) VALUES($1,'fixture-pos',$2,'coffee',10,now()-interval '10 minutes')", [business, branch]);
      const stale = await summary();
      assert.deepEqual(stale.rewards.map(row => row.id), [expensive]);
      const choice = stale.reward_progress.choices.find(row => row.id === reward);
      assert.equal(choice.available, false); assert.equal(choice.inventory.state, 'stale'); assert.equal(choice.stock, 4);
      assert.equal(await pushKind(), 'card');
      await admin.query('UPDATE merchant_inventory_snapshots SET observed_at=now() WHERE business_id=$1', [business]);
      assert.deepEqual((await summary()).rewards.map(row => row.id), [reward, expensive]);
      assert.equal(await pushKind(), 'rewards');
    });
    await t.test('real stock stays authoritative even with fresh inventory and protected terms', async () => {
      await admin.query('UPDATE rewards SET stock=0 WHERE id=$1', [reward]);
      assert.deepEqual((await summary()).rewards.map(row => row.id), [expensive]);
      assert.equal(await pushKind(), 'card');
      await admin.query('UPDATE rewards SET stock=4 WHERE id=$1', [reward]);
    });
    await t.test('daily, per-reward and cooldown guards exclude unavailable targets and push claims', async () => {
      await admin.query("INSERT INTO redemptions(id,business_id,customer_id,reward_id,code,points_cost) VALUES($1::uuid,$2,$3,$4,$1::text,50)", [randomUUID(), business, customer, reward]);
      for (const guard of [{ max_redemptions_per_day: 1 }, { max_reward_redemptions_per_day: 1 }, { reward_cooldown_hours: 24 }]) {
        await admin.query("UPDATE businesses SET program_json=jsonb_set(program_json,'{redemption_guard}',$2::jsonb) WHERE id=$1", [business, JSON.stringify(guard)]);
        const out = await summary();
        assert.ok(out.rewards.every(row => row.id !== reward));
        if (guard.max_redemptions_per_day) assert.deepEqual(out.rewards, []);
        assert.ok(out.reward_progress.next_refresh_at);
        assert.equal(await pushKind(), 'card');
      }
    });
    await t.test('tenant and customer mismatch return no reward progress or foreign summary', async () => {
      assert.equal(await scopedProgress({ businessId: other, customerId: customer }), null);
      await client.query("SELECT set_config('app.current_tenant',$1,false)", [other]);
      assert.equal(await getCustomerRewardProgress(client, { businessId: business, customerId: customer }), null);
      session.actor_id = foreignCustomer;
      const denied = await fetch(base, { headers: { Authorization: 'Bearer fixture-session' } });
      assert.equal(denied.status, 404);
      const out = await denied.json(); assert.equal(out.rewards, undefined);
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM native_wallet_passes')).rows[0].n, 0);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await Promise.all([admin.end(), client.end()]);
  }
});
