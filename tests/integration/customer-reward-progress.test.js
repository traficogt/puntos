/* eslint-disable security/detect-non-literal-fs-filename -- Fixed repository fixture migrations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { getCustomerRewardProgress } from '../../src/app/services/customer-reward-progress.js';

const url = process.env.CUSTOMER_PROGRESS_TEST_DATABASE_URL;
test('customer progress uses one tenant-scoped PostgreSQL snapshot without needing a Wallet pass', { skip: !url }, async t => {
  const parsed = new URL(url);
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.port, '55451');
  assert.equal(parsed.pathname, '/customer_progress_test');
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  const business = randomUUID(), other = randomUUID(), customer = randomUUID(), branch = randomUUID(), cheap = randomUUID(), costly = randomUUID();
  const read = () => getCustomerRewardProgress(db, { businessId: business, customerId: customer });
  try {
    await db.query('DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public');
    for (const file of ['schema.sql', 'migrations/2026-02-27-tenant-rls_canonical.sql', 'migrations/2026-11-09-native-wallet.sql', 'migrations/2026-11-11-reward-promises-hospitality.sql', 'migrations/2026-11-11-wallet-engagement.sql']) await db.query(await readFile(new URL(`../../src/app/${file}`, import.meta.url), 'utf8'));
    await db.query("DO $$ BEGIN CREATE ROLE customer_progress_app NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$; GRANT USAGE ON SCHEMA public,app TO customer_progress_app; GRANT SELECT ON ALL TABLES IN SCHEMA public TO customer_progress_app");
    await db.query("INSERT INTO businesses(id,name,slug,email,password_hash,program_type,program_json) VALUES($1::uuid,'Café',$1::text,$1::text||'@example.invalid','fixture','VISIT','{\"points_per_visit\":10}'),($2::uuid,'Other',$2::text,$2::text||'@example.invalid','fixture','VISIT','{}')", [business, other]);
    await db.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$2,'Centro','centro')", [branch, business]);
    await db.query("INSERT INTO customers(id,business_id,name,phone) VALUES($1,$2,'Ana','+50255550111')", [customer, business]);
    await db.query('INSERT INTO customer_balances(customer_id,points,pending_points) VALUES($1,40,100)', [customer]);
    await db.query("INSERT INTO rewards(id,business_id,name,description,points_cost,stock,valid_until,active) VALUES($1,$3,'Café original','Tamaño original',20,10,now()+interval '1 day',false),($2,$3,'Postre',null,100,10,null,true)", [cheap, costly, business]);
    await db.query('INSERT INTO reward_branches(reward_id,branch_id) VALUES($1,$2)', [cheap, branch]);
    await db.query('UPDATE rewards SET active=true WHERE id=$1', [cheap]);
    await db.query("SELECT set_config('app.current_tenant',$1,false)", [business]);
    const scoped = async fn => { await db.query('SET ROLE customer_progress_app'); try { return await fn(); } finally { await db.query('RESET ROLE'); } };
    await t.test('available balance, affordable-first and pending exclusion', async () => {
      const out = await scoped(read);
      assert.equal(out.available_points, 40); assert.equal(out.pending_points, 100);
      assert.equal(out.reward.id, cheap); assert.equal(out.reward.points_cost, 20);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM native_wallet_passes')).rows[0].n, 0);
    });
    await t.test('changed catalog retains protected original name, cost, description, expiry and branches', async () => {
      await db.query("UPDATE rewards SET name='Changed',description='New description',points_cost=200,active=false WHERE id=$1", [cheap]);
      const out = await scoped(read), row = out.choices.find(choice => choice.id === cheap);
      assert.equal(out.reward.name, 'Café original'); assert.equal(out.reward.points_cost, 20);
      assert.equal(row.description, 'Tamaño original'); assert.equal(row.protected, true);
      assert.deepEqual(row.branch_labels, ['Centro']); assert.ok(row.valid_until);
    });
    await t.test('a current daily guard excludes all targets and supplies the next day deadline', async () => {
      await db.query('UPDATE businesses SET program_json=program_json||\'{"redemption_guard":{"max_redemptions_per_day":1}}\' WHERE id=$1', [business]);
      await db.query("INSERT INTO redemptions(id,business_id,customer_id,reward_id,code,points_cost) VALUES($1::uuid,$2,$3,$4,$1::text,20)", [randomUUID(), business, customer, cheap]);
      const out = await scoped(read); assert.equal(out.reward, null); assert.ok(out.choices.every(row => !row.available)); assert.ok(Date.parse(out.next_refresh_at) > Date.parse(out.as_of));
    });
    await t.test('foreign customer and tenant reads return no progress', async () => {
      assert.equal(await scoped(() => getCustomerRewardProgress(db, { businessId: other, customerId: customer })), null);
      await db.query("SELECT set_config('app.current_tenant',$1,false)", [other]);
      assert.equal(await scoped(read), null);
    });
  } finally { await db.end(); }
});
