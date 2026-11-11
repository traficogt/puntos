import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, before, beforeEach, after, it } from 'node:test';
import pg from 'pg';
import {runWithDbContext} from '../../src/app/database.js';
import {refundAwardTransactionWithClient} from '../../src/app/services/loyalty-ops-service.js';
import {APP_TABLE_PRIVILEGES} from '../../src/scripts/create-app-role.mjs';
const url=process.env.SERVICE_RECOVERY_TEST_DB_URL;
const suite=url?describe:describe.skip;
let pool,service;
const businessId=randomUUID(),otherBusiness=randomUUID(),branchId=randomUUID(),otherBranch=randomUUID(),staffId=randomUUID(),ownerId=randomUUID(),customerId=randomUUID(),foreignCustomer=randomUUID(),rewardId=randomUUID(),redemptionId=randomUUID();
const staff={id:staffId,business_id:businessId,branch_id:branchId,role:'CASHIER'},owner={id:ownerId,business_id:businessId,role:'OWNER'};
async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const out=await runWithDbContext({client:c,tenantId:businessId},()=>fn(c));await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
const deps=()=>({transaction});
const create=(extra={})=>service.createServiceCase({businessId,staff,customerId,rewardId,redemptionId,kind:'unfulfilled',reason:'No se entregó el beneficio.',requestId:randomUUID(),...extra},deps());
const resolve=(row,extra={})=>service.resolveServiceCase({businessId,staff:owner,caseId:row.id,version:row.version,requestId:randomUUID(),resolution:'points_restored',reason:'El cliente solicita sus puntos.',...extra},deps());
suite('service recovery durable PostgreSQL',()=>{
 before(async()=>{
  assert.equal(new URL(url).pathname,'/service_recovery_test');assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname));pool=new pg.Pool({connectionString:url,max:10});
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await pool.query(await readFile(new URL('../fixtures/reward-economics.sql',import.meta.url),'utf8'));
  await pool.query(`CREATE TABLE IF NOT EXISTS branches(id uuid PRIMARY KEY,business_id uuid,active boolean DEFAULT true); ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS branch_id uuid; ALTER TABLE customers ADD COLUMN IF NOT EXISTS name text; ALTER TABLE branches ADD COLUMN IF NOT EXISTS name text; ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(); ALTER TABLE customer_balances ADD COLUMN IF NOT EXISTS lifetime_points int DEFAULT 0;
   CREATE TABLE IF NOT EXISTS ledger_balance_adjustments(id uuid PRIMARY KEY,business_id uuid,customer_id uuid,created_by_staff_id uuid,reason text,delta_points int,delta_pending_points int,delta_lifetime_points int,created_at timestamptz DEFAULT now());
   CREATE TABLE IF NOT EXISTS native_wallet_passes(id uuid PRIMARY KEY,customer_id uuid,revision int DEFAULT 1);
   CREATE OR REPLACE FUNCTION test_wallet_refresh() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE native_wallet_passes SET revision=revision+1 WHERE customer_id=NEW.customer_id; RETURN NEW; END $$;
   DROP TRIGGER IF EXISTS test_wallet_refresh ON customer_balances; CREATE TRIGGER test_wallet_refresh AFTER UPDATE ON customer_balances FOR EACH ROW EXECUTE FUNCTION test_wallet_refresh();`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const migration=await readFile(new URL('../../src/app/migrations/2026-11-11-service-recovery.sql',import.meta.url),'utf8').catch(()=>null);assert.ok(migration,'durable case migration must exist');await pool.query(migration);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await pool.query(await readFile(new URL('../../src/app/migrations/2026-11-11-staff-delegation.sql',import.meta.url),'utf8'));
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await pool.query(await readFile(new URL('../../src/app/migrations/2026-11-10-reward-economics.sql',import.meta.url),'utf8'));
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await pool.query(await readFile(new URL('../fixtures/service-refund-ledger.sql',import.meta.url),'utf8'));
  service=await import('../../src/app/services/service-recovery-service.js');
 });
 after(async()=>{await pool?.end();});
 beforeEach(async()=>{
  await pool.query('TRUNCATE businesses,staff_users,customers,customer_balances,rewards,redemptions,transactions,audit_logs,branches,ledger_balance_adjustments,native_wallet_passes CASCADE');
  await pool.query("INSERT INTO businesses(id,plan) VALUES($1,'NEGOCIO'),($2,'NEGOCIO')",[businessId,otherBusiness]);
  await pool.query('INSERT INTO branches(id,business_id) VALUES($1,$2),($3,$2)',[branchId,businessId,otherBranch]);
  await pool.query("INSERT INTO staff_users(id,business_id,role,branch_id) VALUES($1,$2,'CASHIER',$3),($4,$2,'OWNER',NULL)",[staffId,businessId,branchId,ownerId]);
  await pool.query('INSERT INTO customers(id,business_id) VALUES($1,$2),($3,$4)',[customerId,businessId,foreignCustomer,otherBusiness]);
  await pool.query('INSERT INTO customer_balances(customer_id,points,lifetime_points) VALUES($1,50,100)',[customerId]);
  await pool.query("INSERT INTO rewards(id,business_id,name,points_cost,stock) VALUES($1,$2,'Café',50,3)",[rewardId,businessId]);
  await pool.query("INSERT INTO redemptions(id,business_id,branch_id,customer_id,reward_id,points_cost,status,redeemed_at) VALUES($1,$2,$3,$4,$5,50,'REDEEMED',now())",[redemptionId,businessId,branchId,customerId,rewardId]);
  await pool.query("INSERT INTO transactions(id,business_id,customer_id,points,source,meta) VALUES($1,$2,$3,100,'online','{}'),($4,$2,$3,-50,'redeem',$5)",[randomUUID(),businessId,customerId,randomUUID(),JSON.stringify({redemption_id:redemptionId})]);
  await pool.query("UPDATE customers SET name='Cliente de prueba' WHERE id=$1",[customerId]);
  await pool.query("UPDATE branches SET name='Local central' WHERE id=$1",[branchId]);
  await pool.query("UPDATE staff_users SET name='Ana del equipo' WHERE id=$1",[staffId]);
  await pool.query('INSERT INTO native_wallet_passes(id,customer_id) VALUES($1,$2)',[randomUUID(),customerId]);
  await pool.query('INSERT INTO redemption_cost_snapshots(redemption_id,business_id,reward_id,points_cost,unit_cost_q,redeemed_at) VALUES($1,$2,$3,50,7,now())',[redemptionId,businessId,rewardId]);
 });
 it('deduplicates case creation and rejects reusing identity for different evidence',async()=>{const requestId=randomUUID();const [a,b]=await Promise.all([create({requestId}),create({requestId})]);assert.equal(a.case.id,b.case.id);assert.equal((await pool.query('SELECT * FROM service_case_events')).rowCount,1);await assert.rejects(create({requestId,reason:'Otro motivo distinto.'}),{statusCode:409});});
 it('isolates tenant and branch even if stale tokens claim OWNER',async()=>{await assert.rejects(create({customerId:foreignCustomer,redemptionId:null}),{statusCode:404});await pool.query('UPDATE redemptions SET branch_id=$1',[otherBranch]);await assert.rejects(create({staff:{...staff,role:'OWNER'}}),{statusCode:404});const row=await create({staff:owner});const listed=await service.listServiceCases({businessId,staff},deps());assert.equal(listed.cases.length,0);await assert.rejects(service.getServiceCase({businessId,staff,caseId:row.case.id},deps()),{statusCode:404});});
 it('restores once across cases, preserves ledger evidence, lifetime and stock, queues Wallet refresh',async()=>{const [a,b]=await Promise.all([create(),create()]);const results=await Promise.allSettled([resolve(a.case),resolve(b.case)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409);const adjustment=(await pool.query('SELECT * FROM ledger_balance_adjustments')).rows[0];assert.equal(adjustment.delta_points,50);assert.equal(adjustment.delta_lifetime_points,0);const balance=(await pool.query('SELECT * FROM customer_balances')).rows[0];assert.equal(balance.points,100);assert.equal(balance.lifetime_points,100);assert.equal((await pool.query('SELECT sum(points)::int amount FROM transactions')).rows[0].amount+adjustment.delta_points,balance.points);assert.equal((await pool.query('SELECT status FROM redemptions')).rows[0].status,'REDEEMED');assert.equal((await pool.query('SELECT stock FROM rewards')).rows[0].stock,3);assert.equal(Number((await pool.query('SELECT unit_cost_q FROM redemption_cost_snapshots')).rows[0].unit_cost_q),7);assert.equal((await pool.query('SELECT revision FROM native_wallet_passes')).rows[0].revision,2);assert.equal((await pool.query('SELECT * FROM service_redemption_restorations')).rowCount,1);});
 it('replays the exact resolution without extra event or balance and rejects changed request',async()=>{const {case:row}=await create(),requestId=randomUUID();const a=await resolve(row,{requestId}),b=await resolve(row,{requestId});assert.equal(a.case.id,b.case.id);assert.equal(b.replay,true);assert.equal((await pool.query('SELECT * FROM service_case_events')).rowCount,2);await assert.rejects(resolve(row,{requestId,reason:'Motivo diferente documentado.'}),{statusCode:409});});
 it('rejects stale versions, missing posted deduction, and failures with no completed redemption',async()=>{const {case:row}=await create();await assert.rejects(resolve(row,{version:9}),{statusCode:409});await pool.query("DELETE FROM transactions WHERE source='redeem'");await assert.rejects(resolve(row),{statusCode:409});const failed=await create({redemptionId:null,kind:'redemption_failed'});await assert.rejects(resolve(failed.case),{statusCode:409});});
 it('requires explicit physical attestation and agreed alternative, retains unknown old terms',async()=>{const {case:row}=await create();assert.equal(row.evidence.promise_terms,null);const detail=await service.getServiceCase({businessId,staff:owner,caseId:row.id},deps());assert.equal(detail.case.customer_display_name,'Cliente de prueba');assert.equal(detail.case.customer_id,customerId);assert.equal(detail.case.branch_display_name,'Local central');assert.equal(detail.case.reporting_staff_display_name,'Ana del equipo');const listed=await service.listServiceCases({businessId,staff:owner},deps());assert.equal(listed.cases[0].reporting_staff_display_name,'Ana del equipo');await assert.rejects(resolve(row,{resolution:'original_fulfilled'}),{statusCode:400});const out=await resolve(row,{resolution:'alternative_accepted',attested:true});assert.equal(out.case.status,'resolved');assert.equal((await pool.query('SELECT * FROM ledger_balance_adjustments')).rowCount,0);});
 it('rolls back allowance, adjustment, balance and case on mandatory audit failure',async()=>{const {case:row}=await create();await pool.query("CREATE OR REPLACE FUNCTION test_fail_case_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='service.case.resolve' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_fail_case_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_fail_case_audit()");try{await assert.rejects(resolve(row),/audit unavailable/);assert.equal((await pool.query('SELECT * FROM ledger_balance_adjustments')).rowCount,0);assert.equal((await pool.query('SELECT points FROM customer_balances')).rows[0].points,50);assert.equal((await pool.query('SELECT status FROM service_cases')).rows[0].status,'open');assert.equal((await pool.query('SELECT * FROM service_case_events')).rowCount,1);assert.equal((await pool.query('SELECT * FROM staff_service_usage')).rowCount,0);}finally{await pool.query('DROP TRIGGER test_fail_case_audit ON audit_logs; DROP FUNCTION test_fail_case_audit()');}});
 it('does not restore without delegated authority',async()=>{const {case:row}=await create();await assert.rejects(service.resolveServiceCase({businessId,staff,caseId:row.id,version:1,requestId:randomUUID(),resolution:'points_restored',reason:'Solicita restitución.'},{transaction}),{statusCode:403});assert.equal((await pool.query('SELECT * FROM ledger_balance_adjustments')).rowCount,0);});
 it('rejects a session whose live branch changed and lists only allowed redemptions',async()=>{const list=await service.listServiceRedemptions({businessId,staff,customerId},deps());assert.equal(list.redemptions.length,1);await pool.query('UPDATE staff_users SET branch_id=$2 WHERE id=$1',[staffId,otherBranch]);await assert.rejects(create(),{statusCode:403});const other=await service.listServiceRedemptions({businessId,staff:{...staff,branch_id:otherBranch},customerId},deps());assert.equal(other.redemptions.length,0);});
 it('consumes delegated points in the same audited restoration and never on replay',async()=>{const {createServiceGrant}=await import('../../src/app/services/staff-delegation-service.js');await createServiceGrant({businessId,staff:owner,staffId,branchId,perActionPoints:50,totalPoints:50,startsAt:new Date(Date.now()-3600000),endsAt:new Date(Date.now()+3600000),requestId:randomUUID()},deps());const {case:row}=await create(),requestId=randomUUID();await resolve(row,{staff,requestId});await resolve(row,{staff,requestId});assert.equal((await pool.query('SELECT used_points FROM staff_service_grants')).rows[0].used_points,50);assert.equal((await pool.query('SELECT * FROM staff_service_usage')).rowCount,1);});
 it('forces tenant isolation for cases and adjustment evidence while preserving platform access',async()=>{await create();await pool.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_recovery_test_app') THEN CREATE ROLE service_recovery_test_app NOLOGIN; END IF; END $$; GRANT USAGE ON SCHEMA public,app TO service_recovery_test_app; GRANT SELECT,INSERT ON service_cases,service_case_events,service_redemption_restorations,ledger_balance_adjustments TO service_recovery_test_app");const client=await pool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE service_recovery_test_app');await client.query("SELECT set_config('app.current_tenant',$1,true)",[otherBusiness]);assert.equal((await client.query('SELECT * FROM service_cases')).rowCount,0);await assert.rejects(client.query('INSERT INTO ledger_balance_adjustments(id,business_id,customer_id,delta_points) VALUES($1,$2,$3,50)',[randomUUID(),businessId,customerId]),{code:'42501'});await client.query('ROLLBACK');await client.query('BEGIN');await client.query('SET LOCAL ROLE service_recovery_test_app');await client.query("SELECT set_config('app.platform_admin','true',true)");assert.equal((await client.query('SELECT * FROM service_cases')).rowCount,1);}finally{await client.query('ROLLBACK');client.release();}});
 it('restores using actual runtime grants with SELECT and INSERT only on immutable redemptions',async()=>{
  await pool.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_recovery_runtime_test') THEN CREATE ROLE service_recovery_runtime_test NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$; REVOKE ALL ON ALL TABLES IN SCHEMA public FROM service_recovery_runtime_test; GRANT USAGE ON SCHEMA public,app TO service_recovery_runtime_test");
  for(const [table,privileges] of Object.entries(APP_TABLE_PRIVILEGES)){
   if((await pool.query("SELECT to_regclass($1) AS relation",[table])).rows[0].relation){
    await pool.query(`GRANT ${privileges.join(',')} ON "${table.replaceAll('"','""')}" TO service_recovery_runtime_test`);
   }
  }
  const runtime={transaction:fn=>transaction(async client=>{
   await client.query('SET LOCAL ROLE service_recovery_runtime_test');
   await client.query("SELECT set_config('app.current_tenant',$1,true)",[businessId]);
   const rights=(await client.query("SELECT has_table_privilege(current_user,'redemptions','SELECT') AS can_select,has_table_privilege(current_user,'redemptions','INSERT') AS can_insert,has_table_privilege(current_user,'redemptions','UPDATE') AS can_update")).rows[0];
   assert.deepEqual(rights,{can_select:true,can_insert:true,can_update:false});
   return fn(client);
  })};
  const {case:row}=await service.createServiceCase({businessId,staff,customerId,rewardId,redemptionId,kind:'unfulfilled',reason:'No se entregó el beneficio.',requestId:randomUUID()},runtime);
  const out=await service.resolveServiceCase({businessId,staff:owner,caseId:row.id,version:row.version,requestId:randomUUID(),resolution:'points_restored',reason:'El cliente solicita sus puntos.'},runtime);
  assert.equal(out.case.status,'resolved');assert.equal(out.restoration.points_restored,50);
  assert.deepEqual((await pool.query('SELECT points,lifetime_points FROM customer_balances')).rows[0],{points:100,lifetime_points:100});
  assert.equal((await pool.query('SELECT * FROM service_redemption_restorations')).rowCount,1);assert.equal((await pool.query('SELECT * FROM staff_service_usage')).rowCount,1);
 });

 it('records an actual stock rejection only after the original debit has rolled back',async()=>{await pool.query('UPDATE rewards SET stock=0');const {redeemRewardWithDeps,redeemRewardWithRecovery}=await import('../../src/app/services/staff-service.js');const requestId=randomUUID();const redeem=payload=>redeemRewardWithDeps({BusinessRepo:{getById:async()=>({program_json:{}})},RewardRepo:{listBranchIds:async()=>[]},withTransaction:transaction,settlePendingPointsForCustomer:async()=>{},expirePointsForCustomer:async()=>{},enqueueWebhookEvent:async()=>{}},payload);let caught;try{await redeemRewardWithRecovery({staff,customerId,rewardId,requestId},{redeem,record:async payload=>{assert.equal((await pool.query('SELECT points FROM customer_balances')).rows[0].points,50);return service.recordFailedRedemption(payload,deps());}});}catch(error){caught=error;}assert.equal(caught.statusCode,409);assert.equal(caught.message,'Reward out of stock');assert.ok(caught.recoveryCaseId);const result=await service.getServiceCase({businessId,staff,caseId:caught.recoveryCaseId},deps());assert.equal(result.case.evidence.points_deducted,false);assert.equal(result.case.redemption_id,null);assert.equal((await pool.query('SELECT * FROM ledger_balance_adjustments')).rowCount,0);});
 it('keeps original report and events immutable and forbids linking a rejected attempt to a completed debit',async()=>{const {case:row}=await create();await assert.rejects(pool.query("UPDATE service_cases SET reason='invented' WHERE id=$1",[row.id]),{code:'23514'});await assert.rejects(pool.query("UPDATE service_case_events SET details='{}' WHERE case_id=$1",[row.id]),{code:'23514'});await assert.rejects(create({kind:'redemption_failed'}),{statusCode:400});});

 it('refuses a restitution that would exceed the stored integer balance without consuming allowance',async()=>{const {case:row}=await create();await pool.query('UPDATE customer_balances SET points=2147483647 WHERE customer_id=$1',[customerId]);await assert.rejects(resolve(row),{statusCode:409});assert.equal((await pool.query('SELECT * FROM ledger_balance_adjustments')).rowCount,0);assert.equal((await pool.query('SELECT * FROM staff_service_usage')).rowCount,0);});
 it('prevents legacy refund from crediting a debit already restored by a service case',async()=>{
  const {case:row}=await create();await resolve(row);const debit=(await pool.query("SELECT id FROM transactions WHERE source='redeem'")).rows[0].id;
  await assert.rejects(transaction(client=>refundAwardTransactionWithClient(client,{staff:owner,transactionId:debit,requestId:randomUUID()})),{statusCode:409,message:'Transaction already reversed'});
  assert.equal((await pool.query('SELECT points FROM customer_balances')).rows[0].points,100);assert.equal((await pool.query("SELECT * FROM transactions WHERE source='reversal'")).rowCount,0);
 });
 it('keeps legacy refund replay valid and rejects restitution after an original debit was refunded',async()=>{
  const {case:row}=await create(),requestId=randomUUID(),debit=(await pool.query("SELECT id FROM transactions WHERE source='redeem'")).rows[0].id;
  const refund=()=>transaction(client=>refundAwardTransactionWithClient(client,{staff:owner,transactionId:debit,requestId}));await refund();assert.equal((await refund()).replay,true);
  await assert.rejects(resolve(row),{statusCode:409});assert.equal((await pool.query('SELECT points FROM customer_balances')).rows[0].points,100);assert.equal((await pool.query('SELECT * FROM ledger_balance_adjustments')).rowCount,0);
 });
 it('serializes competing restoration and refund on the same debit so only one credit commits',async()=>{
  const {case:row}=await create(),debit=(await pool.query("SELECT id FROM transactions WHERE source='redeem'")).rows[0].id;
  const outcomes=await Promise.allSettled([resolve(row),transaction(client=>refundAwardTransactionWithClient(client,{staff:owner,transactionId:debit,requestId:randomUUID()}))]);
  assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,1);assert.equal(outcomes.find(outcome=>outcome.status==='rejected').reason.statusCode,409);
  assert.equal((await pool.query('SELECT points FROM customer_balances')).rows[0].points,100);assert.equal((await pool.query("SELECT (SELECT count(*) FROM service_redemption_restorations)+(SELECT count(*) FROM transactions WHERE source='reversal') AS credits")).rows[0].credits,'1');
 });
 it('allows a refund of a different debit for the same customer while restoration waits on the balance',async()=>{
  const {case:row}=await create(),otherDebit=randomUUID(),otherRedemption=randomUUID();
  await pool.query("INSERT INTO redemptions(id,business_id,branch_id,customer_id,reward_id,points_cost,status,redeemed_at) VALUES($1,$2,$3,$4,$5,10,'REDEEMED',now())",[otherRedemption,businessId,branchId,customerId,rewardId]);
  await pool.query("INSERT INTO transactions(id,business_id,customer_id,points,source,meta) VALUES($1,$2,$3,-10,'redeem',$4)",[otherDebit,businessId,customerId,JSON.stringify({redemption_id:otherRedemption})]);
  await pool.query('UPDATE customer_balances SET points=40 WHERE customer_id=$1',[customerId]);
  let releaseRefund,signalRefundLocked;
  const restorationAtBalance=new Promise(resolve=>{releaseRefund=resolve;});
  const refundLocked=new Promise(resolve=>{signalRefundLocked=resolve;});
  const refund=transaction(async client=>{
   await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL deadlock_timeout='100ms'");
   return refundAwardTransactionWithClient({query:async(sql,values)=>{
    const result=await client.query(sql,values);
    if(/SELECT points FROM customer_balances.*FOR UPDATE/s.test(sql)){signalRefundLocked();await restorationAtBalance;}
    return result;
   }},{staff:owner,transactionId:otherDebit,requestId:randomUUID()});
  });
  await refundLocked;
  const restoration=service.resolveServiceCase({businessId,staff:owner,caseId:row.id,version:row.version,requestId:randomUUID(),resolution:'points_restored',reason:'El cliente solicita sus puntos.'},{transaction:fn=>transaction(async client=>{
   await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL deadlock_timeout='100ms'");
   return fn({query:async(sql,values)=>{
    if(/(?:UPDATE customer_balances|FROM customer_balances[^;]*FOR UPDATE)/s.test(sql))releaseRefund();
    return client.query(sql,values);
   }});
  })});
  const results=await Promise.allSettled([refund,restoration.finally(releaseRefund)]);
  assert.deepEqual(results.map(result=>result.status),['fulfilled','fulfilled'],JSON.stringify(results));
  assert.equal((await pool.query('SELECT points FROM customer_balances')).rows[0].points,100);
  assert.equal((await pool.query('SELECT * FROM service_redemption_restorations')).rowCount,1);assert.equal((await pool.query("SELECT * FROM transactions WHERE source='reversal'")).rowCount,1);
 });
 it('allows ordinary award balance and last-visit updates while restoration waits on that balance',async()=>{
  const {case:row}=await create();let releaseAward,signalAwardLocked;
  const restorationAtBalance=new Promise(resolve=>{releaseAward=resolve;});
  const awardLocked=new Promise(resolve=>{signalAwardLocked=resolve;});
  // Match staff-award-service's balance -> customer last_visit_at order. These
  // real row updates also cover the NO KEY UPDATE lock a purchase takes.
  const award=transaction(async client=>{
   await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL deadlock_timeout='100ms'");
   await client.query('UPDATE customer_balances SET points=points+10,lifetime_points=lifetime_points+10,updated_at=now() WHERE customer_id=$1',[customerId]);
   signalAwardLocked();await restorationAtBalance;
   await client.query('UPDATE customers SET last_visit_at=now() WHERE id=$1',[customerId]);
   await client.query("INSERT INTO transactions(id,business_id,customer_id,points,source) VALUES($1,$2,$3,10,'online')",[randomUUID(),businessId,customerId]);
  });
  await awardLocked;
  const restoration=service.resolveServiceCase({businessId,staff:owner,caseId:row.id,version:row.version,requestId:randomUUID(),resolution:'points_restored',reason:'El cliente solicita sus puntos.'},{transaction:fn=>transaction(async client=>{
   await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL deadlock_timeout='100ms'");
   return fn({query:async(sql,values)=>{
    if(/(?:UPDATE customer_balances|FROM customer_balances[^;]*FOR UPDATE)/s.test(sql))releaseAward();
    return client.query(sql,values);
   }});
  })});
  const results=await Promise.allSettled([award,restoration.finally(releaseAward)]);
  assert.deepEqual(results.map(result=>result.status),['fulfilled','fulfilled'],JSON.stringify(results));
  assert.deepEqual((await pool.query('SELECT points,lifetime_points FROM customer_balances')).rows[0],{points:110,lifetime_points:110});
  assert.equal((await pool.query('SELECT * FROM service_redemption_restorations')).rowCount,1);
  assert.equal((await pool.query('SELECT sum(points)::int AS points FROM transactions')).rows[0].points+50,110);
 });

 it('does not expose a reporting staff name if that membership no longer belongs to the case tenant',async()=>{const {case:row}=await create();await pool.query('UPDATE staff_users SET business_id=$2 WHERE id=$1',[staffId,otherBusiness]);const detail=await service.getServiceCase({businessId,staff:owner,caseId:row.id},deps());assert.equal(detail.case.reporting_staff_display_name,null);assert.equal(detail.case.customer_display_name,'Cliente de prueba');});

});
