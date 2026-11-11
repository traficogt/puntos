import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, describe, it } from 'node:test';
import pg from 'pg';

const databaseUrl = process.env.REWARD_ECONOMICS_TEST_DB_URL;
const suite = databaseUrl ? describe : describe.skip;
const businessId=randomUUID(), otherBusiness=randomUUID(), staffId=randomUUID(), customerId=randomUUID(), deletedCustomer=randomUUID(), rewardId=randomUUID(), otherReward=randomUUID();
let pool, service, redeemRewardWithDeps;
const actor={businessId,staffId};
const now=()=>new Date(Date.now()+1000);
async function transaction(fn) { const client=await pool.connect(); try { await client.query('BEGIN'); const result=await fn(client); await client.query('COMMIT'); return result; } catch(error) { await client.query('ROLLBACK'); throw error; } finally {client.release();} }
const deps=()=>({query:pool.query.bind(pool),transaction,getPlanFeatureOverrides:async()=>({})});
const report=(options={})=>service.getRewardEconomics({businessId,days:30,now:now(),...options},pool.query.bind(pool));
const cost=value=>service.updateRewardUnitCost({...actor,rewardId,unitCostQ:value},deps());
const settings=(grossMarginPct,costPerPointQ)=>service.updateRewardEconomicsSettings({...actor,grossMarginPct,costPerPointQ},deps());
async function createRedemption({status='REDEEMED',points=50,tenant=businessId,reward=rewardId,customer=customerId,at=new Date(),snapshot=true}={}) {
 const id=randomUUID();
 await transaction(async client=>{
  await client.query('INSERT INTO redemptions(id,business_id,reward_id,customer_id,points_cost,status,redeemed_at,code,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7)',[id,tenant,reward,customer,points,status,at,randomUUID()]);
  if(snapshot)await service.snapshotCompletedRedemption(client,{businessId:tenant,redemptionId:id});
 });
 return id;
}
async function redeem(requestId=randomUUID()) {
 return redeemRewardWithDeps({BusinessRepo:{getById:async()=>({id:businessId,program_json:{}})},RewardRepo:{listBranchIds:async()=>[]},withTransaction:transaction,settlePendingPointsForCustomer:async()=>{},expirePointsForCustomer:async()=>{},enqueueWebhookEvent:async()=>{}},{staff:{id:staffId,business_id:businessId},customerId,rewardId,requestId});
}
suite('reward economics against disposable PostgreSQL',()=>{
 before(async()=>{
  const url=new URL(databaseUrl);assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));assert.equal(url.pathname,'/reward_economics_test');
  pool=new pg.Pool({connectionString:databaseUrl,max:8});
  // Constant fixture path; never supplied by a request.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await pool.query(await readFile(new URL('../fixtures/reward-economics.sql',import.meta.url),'utf8'));
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const migration=await readFile(new URL('../../src/app/migrations/2026-11-10-reward-economics.sql',import.meta.url),'utf8').catch(()=>null);
  assert.ok(migration,'reward economics migration must exist');
  await pool.query(migration);
  service=await import('../../src/app/services/reward-economics-service.js');
  ({redeemRewardWithDeps}=await import('../../src/app/services/staff-service.js'));
 });
 after(async()=>{await pool?.end();});
 beforeEach(async()=>{
  await pool.query('TRUNCATE businesses,staff_users,customers,customer_balances,rewards,redemptions,transactions,audit_logs CASCADE');
  await pool.query("INSERT INTO businesses(id,plan) VALUES($1,'NEGOCIO'),($2,'NEGOCIO')",[businessId,otherBusiness]);
  await pool.query("INSERT INTO staff_users(id,business_id) VALUES($1,$2)",[staffId,businessId]);
  await pool.query('INSERT INTO customers(id,business_id,deleted_at) VALUES($1,$2,NULL),($3,$2,now())',[customerId,businessId,deletedCustomer]);
  await pool.query('INSERT INTO customer_balances(customer_id,points,pending_points) VALUES($1,1000,30),($2,999,999)',[customerId,deletedCustomer]);
  await pool.query("INSERT INTO rewards(id,business_id,name,points_cost) VALUES($1,$2,'Café',50),($3,$4,'Otro',75)",[rewardId,businessId,otherReward,otherBusiness]);
 });
 it('uses saved USD calendar bounds across DST and enforces CLP cost precision',async()=>{
  await pool.query('UPDATE businesses SET program_json=$2 WHERE id=$1',[businessId,{region:{country:'US',currency:'USD',timezone:'America/New_York'}}]);
  const result=await report({now:new Date('2026-11-02T17:00:00Z')});assert.equal(result.currency,'USD');assert.equal(result.timezone,'America/New_York');assert.equal(result.period.start,'2026-10-04T04:00:00.000Z');
  await pool.query('UPDATE businesses SET program_json=$2 WHERE id=$1',[businessId,{region:{country:'CL',currency:'CLP',timezone:'America/Santiago'}}]);
  await assert.rejects(cost(1.25),{statusCode:400});await cost(1500);assert.equal((await report()).rewards[0].unit_cost_q,1500);
  const audit=await pool.query("SELECT meta FROM audit_logs WHERE action='reward.unit_cost.update'");assert.equal(audit.rows[0].meta.currency,'CLP');
 });
 it('starts with unknown assumptions and no invented cost or rate',async()=>{
  const result=await report();assert.deepEqual(result.settings,{gross_margin_pct:null,cost_per_point_q:null});
  assert.equal(result.observed.completed_redemptions,0);assert.equal(result.observed.cost_coverage_pct,null);
  assert.equal(result.observed.outstanding_points,1000);assert.equal(result.observed.pending_points,30);
  assert.equal(result.estimates.gross_margin_before_rewards_q,null);assert.equal(result.estimates.margin_after_rewards_q,null);assert.equal(result.estimates.outstanding_points_cost_q,null);
  assert.equal(result.rewards[0].unit_cost_q,null);
 });
 it('captures the actual completed redemption transaction and preserves native response fields',async()=>{
  await cost(8.25);const result=await redeem();assert.deepEqual(Object.keys(result).sort(),['newBalance','redemptionCode','redemptionId','rewardName']);
  const snapshots=await pool.query('SELECT * FROM redemption_cost_snapshots');assert.equal(snapshots.rowCount,1);
  assert.equal(result.redemptionId,snapshots.rows[0].redemption_id);
  assert.equal(snapshots.rows[0].points_cost,50);assert.equal(Number(snapshots.rows[0].unit_cost_q),8.25);
  assert.equal(result.newBalance,950);
 });
 it('concurrent retries complete and snapshot once without double balance or stock changes',async()=>{
  await cost(5);await pool.query('UPDATE rewards SET stock=2 WHERE id=$1',[rewardId]);
  const requestId=randomUUID();const results=await Promise.all(Array.from({length:4},()=>redeem(requestId)));
  assert.ok(results.every(r=>r.redemptionCode===results[0].redemptionCode));
  assert.equal((await pool.query('SELECT count(*)::int count FROM redemption_cost_snapshots')).rows[0].count,1);
  assert.equal((await pool.query('SELECT points FROM customer_balances WHERE customer_id=$1',[customerId])).rows[0].points,950);
  assert.equal((await pool.query('SELECT stock FROM rewards WHERE id=$1',[rewardId])).rows[0].stock,1);
 });
 it('serializes a concurrent cost edit with the locked completion and preserves its captured cost',async()=>{
  await cost(5);
  const locker=await pool.connect();
  try {
   await locker.query('BEGIN');await locker.query('SELECT id FROM rewards WHERE id=$1 FOR UPDATE',[rewardId]);
   let started;const editing=new Promise(resolve=>{started=resolve;});
   const edited=service.updateRewardUnitCost({...actor,rewardId,unitCostQ:9},{...deps(),transaction:fn=>transaction(async client=>{started();return fn(client);})});
   // Observe rejection immediately while the competing transaction is blocked.
   edited.catch(()=>{});
   await editing;
   const redemptionId=randomUUID();await locker.query("INSERT INTO redemptions(id,business_id,reward_id,customer_id,points_cost,status,redeemed_at,code) VALUES($1,$2,$3,$4,50,'REDEEMED',now(),$5)",[redemptionId,businessId,rewardId,customerId,randomUUID()]);
   await service.snapshotCompletedRedemption(locker,{businessId,redemptionId});await locker.query('COMMIT');await edited;
   assert.equal((await report()).observed.known_reward_cost_q,5);assert.equal((await report()).rewards[0].unit_cost_q,9);
  }finally{await locker.query('ROLLBACK');locker.release();}
 });
 it('does not invent a snapshot when an old completed request is retried',async()=>{
  const old=await createRedemption({snapshot:false}),requestId=randomUUID();
  await pool.query('UPDATE redemptions SET request_id=$2,balance_after=950 WHERE id=$1',[old,requestId]);await cost(8);await redeem(requestId);
  const result=await report();assert.equal(result.observed.costed_redemptions,0);assert.equal(result.observed.known_reward_cost_q,null);assert.equal(result.observed.cost_coverage_pct,0);
  assert.equal((await pool.query('SELECT count(*)::int count FROM redemption_cost_snapshots')).rows[0].count,0);
 });
 it('failed expired reward and deleted customer redemptions produce no snapshot',async()=>{
  await pool.query("UPDATE rewards SET valid_until=now()-interval '1 hour' WHERE id=$1",[rewardId]);await assert.rejects(redeem(),{statusCode:400});
  await pool.query('UPDATE rewards SET valid_until=NULL WHERE id=$1',[rewardId]);await pool.query('UPDATE customers SET deleted_at=now() WHERE id=$1',[customerId]);await assert.rejects(redeem(),{statusCode:404});
  assert.equal((await pool.query('SELECT count(*)::int count FROM redemption_cost_snapshots')).rows[0].count,0);
 });
 it('cost and reward point-price changes affect only later completions',async()=>{
  await cost(5);const first=await createRedemption({points:50});await cost(9);
  await pool.query('UPDATE rewards SET points_cost=100 WHERE id=$1',[rewardId]);await createRedemption({points:100});
  await service.snapshotCompletedRedemption(pool,{businessId,redemptionId:first});
  const result=await report();assert.equal(result.observed.known_reward_cost_q,14);assert.equal(result.observed.points_redeemed,150);assert.equal(result.observed.cost_coverage_pct,100);
 });
 it('historical completed rows remain unknown when a cost is entered later',async()=>{
  await createRedemption({snapshot:false});await cost(8);await createRedemption();await settings(40,0.1);
  const result=await report();assert.equal(result.observed.completed_redemptions,2);assert.equal(result.observed.costed_redemptions,1);assert.equal(result.observed.unknown_cost_redemptions,1);assert.equal(result.observed.known_reward_cost_q,8);assert.equal(result.observed.cost_coverage_pct,50);assert.equal(result.estimates.margin_after_rewards_q,null);assert.equal(result.estimates.margin_unavailable_reason,'incomplete_reward_costs');
 });
 it('distinguishes a genuine zero cost from unknown and preserves unknown snapshots',async()=>{
  const unknown=await createRedemption();await cost(0);await createRedemption();await cost(9);
  await service.snapshotCompletedRedemption(pool,{businessId,redemptionId:unknown});
  const result=await report();assert.equal(result.observed.known_reward_cost_q,0);assert.equal(result.observed.costed_redemptions,1);assert.equal(result.observed.unknown_cost_redemptions,1);assert.equal(result.observed.cost_coverage_pct,50);
 });
 it('does not snapshot reservations, expired or cancelled redemptions',async()=>{
  await cost(5);for(const status of ['PENDING','EXPIRED','CANCELLED','REVERSED'])await createRedemption({status});
  assert.equal((await pool.query('SELECT count(*)::int count FROM redemption_cost_snapshots')).rows[0].count,0);
  assert.equal((await report()).observed.completed_redemptions,0);
 });
 it('snapshots only when a reservation completes and excludes subsequently reversed status',async()=>{
  await cost(5);const id=await createRedemption({status:'PENDING'});await cost(8);
  await transaction(async client=>{await client.query("UPDATE redemptions SET status='REDEEMED',redeemed_at=now() WHERE id=$1",[id]);await service.snapshotCompletedRedemption(client,{businessId,redemptionId:id});});
  assert.equal((await report()).observed.known_reward_cost_q,8);
  await pool.query("UPDATE redemptions SET status='REVERSED' WHERE id=$1",[id]);assert.equal((await report()).observed.completed_redemptions,0);
 });
 it('snapshot failure rolls back completion and associated balance/stock updates',async()=>{
  await cost(5);await pool.query("CREATE OR REPLACE FUNCTION test_fail_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'snapshot unavailable'; END $$; CREATE TRIGGER test_fail_snapshot BEFORE INSERT ON redemption_cost_snapshots FOR EACH ROW EXECUTE FUNCTION test_fail_snapshot()");
  try {await assert.rejects(redeem(),/snapshot unavailable/);assert.equal((await pool.query('SELECT points FROM customer_balances WHERE customer_id=$1',[customerId])).rows[0].points,1000);assert.equal((await pool.query('SELECT count(*)::int count FROM redemptions')).rows[0].count,0);} finally {await pool.query('DROP TRIGGER test_fail_snapshot ON redemption_cost_snapshots; DROP FUNCTION test_fail_snapshot()');}
 });
 it('retains anonymous history for deleted customers but excludes their current balances',async()=>{
  await cost(5);await createRedemption({customer:deletedCustomer});const result=await report();assert.equal(result.observed.completed_redemptions,1);assert.equal(result.observed.known_reward_cost_q,5);assert.equal(result.observed.outstanding_points,1000);
 });
 it('excludes reversed purchases and non-sale ledger records from observed sales',async()=>{
  for(const [source,status,type,amount] of [['online','POSTED','PURCHASE',100],['external','PENDING','PURCHASE',50],['external','REVERSED','PURCHASE',999],['reversal','POSTED','PURCHASE',-999],['lifecycle','POSTED','PURCHASE',999],['online','POSTED','ACHIEVEMENT',999]])await pool.query('INSERT INTO transactions(id,business_id,customer_id,source,status,type,amount_q) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),businessId,customerId,source,status,type,amount]);
  await cost(5);await createRedemption();await settings(40,0.1);const result=await report();assert.equal(result.observed.recorded_sales_q,150);assert.equal(result.estimates.gross_margin_before_rewards_q,60);assert.equal(result.estimates.margin_after_rewards_q,55);assert.equal(result.estimates.outstanding_points_cost_q,100);assert.equal(result.estimates.pending_points_cost_q,3);
 });
 it('uses half-open local calendar bounds and keeps current balances independent of period',async()=>{
  await cost(5);await createRedemption({at:new Date('2026-11-10T17:59:59Z')});await createRedemption({at:new Date('2026-11-10T18:00:00Z')});await createRedemption({at:new Date('2026-10-12T05:59:59Z')});
  const result=await report({now:new Date('2026-11-10T18:00:00Z')});assert.equal(result.observed.completed_redemptions,1);assert.equal(result.period.start,'2026-10-12T06:00:00.000Z');assert.equal(result.observed.outstanding_points,1000);
 });
 it('bounds settings, rejects foreign rewards and writes atomic audit records',async()=>{
  for(const value of [-1,1000000.01,Infinity,'5'])await assert.rejects(cost(value),{statusCode:400});
  for(const pair of [[101,0],[-1,0],[1,1000.000001],[1,-0.1]])await assert.rejects(settings(...pair),{statusCode:400});
  await assert.rejects(service.updateRewardUnitCost({...actor,rewardId:otherReward,unitCostQ:10},deps()),{statusCode:404});
  await cost(0);await cost(null);await settings(0,0);assert.equal((await report()).rewards[0].unit_cost_q,null);
  assert.equal((await pool.query('SELECT count(*)::int count FROM audit_logs')).rows[0].count,3);
 });
 it('keeps zero assumptions valid and negative balances separate from spendable points',async()=>{
  await settings(0,0);await pool.query('UPDATE customer_balances SET points=-20 WHERE customer_id=$1',[customerId]);
  const result=await report();assert.equal(result.observed.outstanding_points,0);assert.equal(result.observed.negative_balance_points,-20);assert.equal(result.estimates.gross_margin_before_rewards_q,0);assert.equal(result.estimates.margin_after_rewards_q,0);assert.equal(result.estimates.pending_points_cost_q,0);
 });
 it('bounds reward pages without limiting the aggregate cost coverage',async()=>{
  for(let i=0;i<52;i++)await pool.query("INSERT INTO rewards(id,business_id,name,points_cost) VALUES($1,$2,$3,50)",[randomUUID(),businessId,`Reward ${i}`]);
  await cost(5);await createRedemption();
  const first=await report(),second=await report({offset:50});assert.equal(first.rewards.length,50);assert.equal(first.rewards_pagination.total,53);assert.equal(first.rewards_pagination.has_more,true);assert.equal(second.rewards.length,3);assert.equal(second.rewards_pagination.has_more,false);assert.deepEqual(second.observed,first.observed);
 });
 it('rechecks analytics plan within each settings transaction',async()=>{
  await pool.query("UPDATE businesses SET plan='EMPRENDEDOR' WHERE id=$1",[businessId]);await assert.rejects(cost(5),{statusCode:403});await assert.rejects(settings(40,0.1),{statusCode:403});assert.equal((await pool.query('SELECT count(*)::int count FROM audit_logs')).rows[0].count,0);
 });
 it('settings audit failure rolls back the financial assumption',async()=>{
  await pool.query("CREATE OR REPLACE FUNCTION test_fail_economics_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER test_fail_economics_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_fail_economics_audit()");
  try {await assert.rejects(cost(7),/audit unavailable/);assert.equal((await report()).rewards[0].unit_cost_q,null);}finally{await pool.query('DROP TRIGGER test_fail_economics_audit ON audit_logs; DROP FUNCTION test_fail_economics_audit()');}
 });
 it('isolates explicit tenant predicates and immutable snapshots under RLS',async()=>{
  await cost(5);await createRedemption();await createRedemption({tenant:otherBusiness,reward:otherReward});
  assert.equal((await report()).observed.completed_redemptions,1);
  await assert.rejects(pool.query('UPDATE redemption_cost_snapshots SET unit_cost_q=123'),/immutable/i);
  await pool.query('GRANT USAGE ON SCHEMA app TO economics_test_app; GRANT SELECT,INSERT,UPDATE ON reward_unit_costs,reward_economics_settings TO economics_test_app; GRANT SELECT,INSERT ON redemption_cost_snapshots TO economics_test_app');
  await transaction(async client=>{
   await client.query('SET LOCAL ROLE economics_test_app');await client.query("SELECT set_config('app.current_tenant',$1,true)",[businessId]);
   assert.equal((await client.query('SELECT count(*)::int count FROM redemption_cost_snapshots')).rows[0].count,1);
   assert.equal((await client.query('SELECT count(*)::int count FROM reward_unit_costs WHERE business_id=$1',[otherBusiness])).rows[0].count,0);
   await client.query('SAVEPOINT wrong_tenant');
   await assert.rejects(client.query('INSERT INTO reward_economics_settings(business_id,gross_margin_pct) VALUES($1,30)',[otherBusiness]),/row-level security/);
   await client.query('ROLLBACK TO SAVEPOINT wrong_tenant');
   await client.query('SAVEPOINT immutable_delete');
   await assert.rejects(client.query('DELETE FROM redemption_cost_snapshots'),/permission denied/);
   await client.query('ROLLBACK TO SAVEPOINT immutable_delete');
  });
 });
});
