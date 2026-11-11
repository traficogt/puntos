import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,beforeEach,after,describe,it} from 'node:test';
import pg from 'pg';
const url=process.env.REWARD_PROMISE_TEST_DB_URL,suite=url?describe:describe.skip;
const b=randomUUID(),o=randomUUID(),s=randomUUID(),c=randomUUID(),r=randomUUID(),alt=randomUUID(),branch=randomUUID(),other=randomUUID();
const owner={id:o,business_id:b,role:'OWNER'},staff={id:s,business_id:b,role:'CASHIER',branch_id:branch};
let pool,svc,hospitality;
async function transaction(fn){const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
const deps={transaction};
const grant=(extra={})=>hospitality.createHospitalityGrant({businessId:b,staff:owner,requestId:randomUUID(),staffId:s,branchId:branch,rewardId:r,title:'Un café de cortesía',totalUnits:2,totalCost:10,unitCostLimit:5,startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),validHours:48,...extra},deps);
const issue=(grantId,extra={})=>hospitality.issueHospitality({businessId:b,staff,grantId,customerId:c,requestId:randomUUID(),...extra},deps);
suite('protected reward cycles and bounded hospitality',()=>{
 before(async()=>{const parsed=new URL(url);assert.ok(['localhost','127.0.0.1'].includes(parsed.hostname));assert.equal(parsed.pathname,'/reward_promise_test');pool=new pg.Pool({connectionString:url,max:12});
  await pool.query(`CREATE SCHEMA IF NOT EXISTS app;
 CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_tenant',true),'')::uuid $$;
 CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('app.platform_admin',true),''),'false')::boolean $$;
 CREATE TABLE IF NOT EXISTS businesses(id uuid PRIMARY KEY,plan text DEFAULT 'PRO',program_type text DEFAULT 'VISIT',program_json jsonb DEFAULT '{"points_per_visit":10}');
 CREATE TABLE IF NOT EXISTS branches(id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id),name text);
 CREATE TABLE IF NOT EXISTS staff_users(id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id),branch_id uuid REFERENCES branches(id),name text,role text,active boolean);
 CREATE TABLE IF NOT EXISTS customers(id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id),name text,deleted_at timestamptz,last_visit_at timestamptz);
 CREATE TABLE IF NOT EXISTS customer_balances(customer_id uuid PRIMARY KEY REFERENCES customers(id),points integer DEFAULT 0,pending_points integer DEFAULT 0,lifetime_points integer DEFAULT 0,updated_at timestamptz DEFAULT now());
 CREATE TABLE IF NOT EXISTS rewards(id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id),name text,description text,points_cost integer,active boolean DEFAULT true,stock integer,valid_until timestamptz,created_at timestamptz DEFAULT now());
 CREATE TABLE IF NOT EXISTS reward_branches(reward_id uuid REFERENCES rewards(id),branch_id uuid REFERENCES branches(id),PRIMARY KEY(reward_id,branch_id));
 CREATE TABLE IF NOT EXISTS redemptions(id uuid PRIMARY KEY,business_id uuid,branch_id uuid,reward_id uuid REFERENCES rewards(id),customer_id uuid REFERENCES customers(id),staff_user_id uuid,code text UNIQUE,points_cost integer,status text,redeemed_at timestamptz,created_at timestamptz DEFAULT now(),request_id uuid,balance_after integer,UNIQUE(business_id,request_id));
 CREATE TABLE IF NOT EXISTS transactions(id uuid PRIMARY KEY,business_id uuid,branch_id uuid,customer_id uuid,staff_user_id uuid,amount_q numeric(12,2),points integer,source text,meta jsonb,created_at timestamptz DEFAULT now());
 ALTER TABLE transactions ADD COLUMN IF NOT EXISTS visits integer DEFAULT 0,ADD COLUMN IF NOT EXISTS items integer DEFAULT 0,ADD COLUMN IF NOT EXISTS status text DEFAULT 'POSTED',ADD COLUMN IF NOT EXISTS available_at timestamptz;
 CREATE TABLE IF NOT EXISTS qr_tokens(jti uuid PRIMARY KEY,business_id uuid,customer_id uuid,expires_at timestamptz);
 CREATE TABLE IF NOT EXISTS audit_logs(id uuid PRIMARY KEY,business_id uuid,actor_type text,actor_id uuid,action text,ip text,ua text,meta jsonb,created_at timestamptz DEFAULT now());
 DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='reward_promise_test_app') THEN CREATE ROLE reward_promise_test_app NOLOGIN; END IF; END $$;`);
 for(const file of ['2026-11-10-reward-economics.sql','2026-11-11-reward-promises-hospitality.sql']){
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sql=await readFile(new URL(`../../src/app/migrations/${file}`,import.meta.url),'utf8').catch(()=>null);assert.ok(sql,`${file} must exist`);await pool.query(sql);
 }
 svc=await import('../../src/app/services/reward-promise-service.js');hospitality=await import('../../src/app/services/hospitality-service.js');
 });
 after(async()=>pool?.end());
 beforeEach(async()=>{await pool.query('TRUNCATE businesses,branches,staff_users,customers,rewards,redemptions,transactions,audit_logs CASCADE');await pool.query('INSERT INTO businesses(id) VALUES($1),($2)',[b,other]);await pool.query("INSERT INTO branches VALUES($1,$2,'Centro')",[branch,b]);await pool.query("INSERT INTO staff_users VALUES($1,$2,NULL,'Dueña','OWNER',true),($3,$2,$4,'Ana','CASHIER',true)",[o,b,s,branch]);await pool.query("INSERT INTO customers(id,business_id,name) VALUES($1,$2,'Cliente')",[c,b]);await pool.query('INSERT INTO customer_balances(customer_id,points) VALUES($1,60)',[c]);await pool.query("INSERT INTO rewards(id,business_id,name,description,points_cost,stock) VALUES($1,$2,'Café','Original',80,10),($3,$2,'Té','Alternativa',80,10)",[r,b,alt]);await pool.query('INSERT INTO reward_unit_costs(business_id,reward_id,unit_cost_q) VALUES($1,$2,5),($1,$3,4)',[b,r,alt]);});
 it('publishes new branch-scoped rewards only after their branches are assigned',async t=>{
  const {RewardRepo}=await import('../../src/app/repositories/reward-repository.js');
  const {transactionPool}=await import('../../src/app/database.js');
  t.mock.method(transactionPool,'connect',()=>pool.connect());
  t.mock.method(RewardRepo,'getById',async id=>(await pool.query('SELECT * FROM rewards WHERE id=$1',[id])).rows[0]);
  const fresh=randomUUID(),nextBranch=randomUUID();
  await pool.query("INSERT INTO branches(id,business_id,name) VALUES($1,$2,'Nueva')",[nextBranch,b]);
  const created=await RewardRepo.create({id:fresh,business_id:b,name:'Solo Centro',description:null,points_cost:90,active:true,stock:5,valid_until:null,branch_ids:[branch]});
  assert.equal(created.active,true);
  assert.equal((await svc.listCustomerEntitlements({businessId:b,customerId:c},deps)).cycle,null,'creation must not capture an unpublished unrestricted reward');
  assert.deepEqual((await pool.query('SELECT branch_id FROM reward_branches WHERE reward_id=$1',[fresh])).rows.map(row=>row.branch_id),[branch]);
  await RewardRepo.setBranches(fresh,[nextBranch]);
  const entitlement=(await svc.listCustomerEntitlements({businessId:b,customerId:c},deps)).promises.find(row=>row.reward_id===fresh);
  assert.deepEqual(entitlement.branch_ids,[branch],'later scope edits retain the published original scope');
 });
 it('still protects an active unrestricted reward when its first branch restriction is added',async()=>{
  await pool.query('INSERT INTO reward_branches(reward_id,branch_id) VALUES($1,$2)',[r,branch]);
  const entitlement=(await svc.listCustomerEntitlements({businessId:b,customerId:c},deps)).promises.find(row=>row.reward_id===r);
  assert.deepEqual(entitlement.branch_ids,[]);
 });
 for(const guard of ['max_redemptions_per_day','max_reward_redemptions_per_day'])it(`legacy ${guard} uses the business calendar instead of the database calendar`,async()=>{
  await pool.query('UPDATE businesses SET program_json=program_json||$2::jsonb WHERE id=$1',[b,JSON.stringify({region:{country:'US',currency:'USD',timezone:'America/New_York'},redemption_guard:{[guard]:1}})]);
  await pool.query('UPDATE customer_balances SET points=200 WHERE customer_id=$1',[c]);
  const bounds=await transaction(async client=>{await client.query("SET LOCAL TIME ZONE 'UTC'");return (await client.query("SELECT date_trunc('day',now()) AS utc_start,date_trunc('day',now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York' AS local_start")).rows[0];});
  const utc=new Date(bounds.utc_start).getTime(),local=new Date(bounds.local_start).getTime(),at=new Date((utc+local)/2);
  assert.notEqual(utc,local);
  await pool.query("INSERT INTO redemptions(id,business_id,customer_id,reward_id,points_cost,status,created_at,code) VALUES($1,$2,$3,$4,0,'REDEEMED',$5,$6)",[randomUUID(),b,c,r,at,randomUUID()]);
  const {redeemRewardWithDeps}=await import('../../src/app/services/staff-service.js');
  const redeem=()=>redeemRewardWithDeps({BusinessRepo:{getById:async()=>(await pool.query('SELECT * FROM businesses WHERE id=$1',[b])).rows[0]},RewardRepo:{listBranchIds:async()=>[]},withTransaction:fn=>transaction(async client=>{await client.query("SET LOCAL TIME ZONE 'UTC'");return fn(client);}),settlePendingPointsForCustomer:async()=>{},expirePointsForCustomer:async()=>{},enqueueWebhookEvent:async()=>{},protectedRedemptionReward:svc.protectedRedemptionReward,lockProtectedRedemptionBusiness:svc.lockProtectedRedemptionBusiness,completeLegacyProtectedRedemption:svc.completeLegacyProtectedRedemption},{staff,customerId:c,rewardId:r,requestId:randomUUID()});
  if(local<utc)await assert.rejects(redeem(),{statusCode:409});else assert.equal((await redeem()).newBalance,120);
 });
 it('preserves six of eight visits and the original choices across repeated changes',async()=>{await pool.query("UPDATE businesses SET program_json='{"+'"points_per_visit":5'+"}' WHERE id=$1",[b]);let p=await svc.listCustomerEntitlements({businessId:b,customerId:c},deps);assert.equal(p.cycle.progress_points,60);assert.equal(p.promises.find(x=>x.reward_id===r).points_cost,80);const effective=await transaction(client=>svc.protectedEarningBusiness(client,{business:{id:b,program_type:'VISIT',program_json:{points_per_visit:5}},customerId:c}));assert.equal(effective.program_json.points_per_visit,10);await pool.query('UPDATE rewards SET points_cost=120,name=$2 WHERE id=$1',[r,'Nuevo']);p=await svc.listCustomerEntitlements({businessId:b,customerId:c},deps);assert.equal(p.promises.find(x=>x.reward_id===r).reward_name,'Café');assert.equal(p.promises.length,2);});
 it('does not fabricate progress for zero/negative balances or unrelated settings changes',async()=>{await pool.query("UPDATE businesses SET program_json=program_json||'{\"unrelated\":true,\"points_per_q\":5,\"round\":\"floor\"}' WHERE id=$1",[b]);assert.equal((await svc.listCustomerEntitlements({businessId:b,customerId:c},deps)).cycle,null);await pool.query('UPDATE customer_balances SET points=-1 WHERE customer_id=$1',[c]);await pool.query('UPDATE rewards SET points_cost=100 WHERE id=$1',[r]);assert.equal((await svc.listCustomerEntitlements({businessId:b,customerId:c},deps)).cycle,null);});
 it('preserves pending progress without allowing pending points to redeem',async()=>{await pool.query('UPDATE customer_balances SET points=0,pending_points=60 WHERE customer_id=$1',[c]);await pool.query('UPDATE rewards SET points_cost=100 WHERE id=$1',[r]);const p=await svc.listCustomerEntitlements({businessId:b,customerId:c},deps);assert.equal(p.cycle.pending_points,60);await assert.rejects(svc.redeemEntitlement({businessId:b,staff,customerId:c,promiseId:p.promises.find(x=>x.reward_id===r).id,requestId:randomUUID()},deps),{statusCode:409});});
 it('redeems protected inactive terms once, snapshots actual cost and closes the earning cycle',async()=>{await pool.query('UPDATE rewards SET points_cost=120,active=false WHERE id=$1',[r]);await pool.query('UPDATE customer_balances SET points=80 WHERE customer_id=$1',[c]);const p=(await svc.listCustomerEntitlements({businessId:b,customerId:c},deps)).promises.find(x=>x.reward_id===r);const requestId=randomUUID();const attempts=await Promise.all(Array.from({length:4},()=>svc.redeemEntitlement({businessId:b,staff,customerId:c,promiseId:p.id,requestId},deps)));assert.equal(new Set(attempts.map(x=>x.redemptionId)).size,1);assert.equal(attempts.filter(x=>!x.replay).length,1);assert.equal(attempts[0].pointsCost,80);assert.equal((await pool.query('SELECT points FROM customer_balances')).rows[0].points,0);assert.equal((await pool.query('SELECT stock FROM rewards WHERE id=$1',[r])).rows[0].stock,9);assert.equal((await svc.listCustomerEntitlements({businessId:b,customerId:c},deps)).cycle,null);assert.equal(Number((await pool.query('SELECT unit_cost_q FROM redemption_cost_snapshots')).rows[0].unit_cost_q),5);});
 it('allows only owner-preapproved, explicitly accepted substitutes with original price and actual stock',async()=>{await pool.query('UPDATE rewards SET points_cost=100,stock=0 WHERE id=$1',[r]);await pool.query('UPDATE customer_balances SET points=80 WHERE customer_id=$1',[c]);const p=(await svc.listCustomerEntitlements({businessId:b,customerId:c},deps)).promises.find(x=>x.reward_id===r);const args={businessId:b,staff,customerId:c,promiseId:p.id,fulfillmentRewardId:alt,customerAccepted:true,requestId:randomUUID()};await assert.rejects(svc.redeemEntitlement(args,deps),{statusCode:403});await svc.configureRewardAvailability({businessId:b,staff:owner,rewardId:r,available:false,alternativeRewardIds:[alt]},deps);await assert.rejects(svc.redeemEntitlement({...args,customerAccepted:false},deps),{statusCode:400});const done=await svc.redeemEntitlement(args,deps);assert.equal(done.pointsCost,80);assert.equal((await pool.query('SELECT stock FROM rewards WHERE id=$1',[alt])).rows[0].stock,9);assert.equal(Number((await pool.query('SELECT unit_cost_q FROM redemption_cost_snapshots')).rows[0].unit_cost_q),4);});
 it('preserves redemption limits for protected alternatives',async()=>{await pool.query("UPDATE businesses SET program_json=program_json||'{\"redemption_guard\":{\"max_redemptions_per_day\":1}}' WHERE id=$1",[b]);await pool.query('UPDATE rewards SET points_cost=100 WHERE id=$1',[r]);await pool.query('UPDATE customer_balances SET points=80 WHERE customer_id=$1',[c]);await pool.query("INSERT INTO redemptions(id,business_id,customer_id,reward_id,points_cost,status) VALUES($1,$2,$3,$4,0,'REDEEMED')",[randomUUID(),b,c,alt]);const p=(await svc.listCustomerEntitlements({businessId:b,customerId:c},deps)).promises.find(x=>x.reward_id===r);await assert.rejects(svc.redeemEntitlement({businessId:b,staff,customerId:c,promiseId:p.id,requestId:randomUUID()},deps),{statusCode:409});assert.equal((await pool.query('SELECT points FROM customer_balances')).rows[0].points,80);});
 for (const guard of [{max_reward_redemptions_per_day:1},{reward_cooldown_hours:24}]) it(`applies ${Object.keys(guard)[0]} to a legacy redemption after an accepted substitute`,async()=>{
  await pool.query('UPDATE businesses SET program_json=program_json||$2::jsonb WHERE id=$1',[b,JSON.stringify({redemption_guard:guard})]);
  await pool.query('UPDATE rewards SET points_cost=100 WHERE id=$1',[r]);
  await pool.query('UPDATE customer_balances SET points=80 WHERE customer_id=$1',[c]);
  const promise=(await svc.listCustomerEntitlements({businessId:b,customerId:c},deps)).promises.find(x=>x.reward_id===r);
  await svc.configureRewardAvailability({businessId:b,staff:owner,rewardId:r,available:false,alternativeRewardIds:[alt]},deps);
  await svc.redeemEntitlement({businessId:b,staff,customerId:c,promiseId:promise.id,fulfillmentRewardId:alt,customerAccepted:true,requestId:randomUUID()},deps);
  await svc.configureRewardAvailability({businessId:b,staff:owner,rewardId:r,available:true,alternativeRewardIds:[]},deps);
  await pool.query('UPDATE customer_balances SET points=100 WHERE customer_id=$1',[c]);
  const {redeemRewardWithDeps}=await import('../../src/app/services/staff-service.js');
  const redeemDeps={BusinessRepo:{getById:async()=> (await pool.query('SELECT * FROM businesses WHERE id=$1',[b])).rows[0]},RewardRepo:{listBranchIds:async()=>[]},withTransaction:transaction,settlePendingPointsForCustomer:async()=>{},expirePointsForCustomer:async()=>{},enqueueWebhookEvent:async()=>{},protectedRedemptionReward:svc.protectedRedemptionReward,lockProtectedRedemptionBusiness:svc.lockProtectedRedemptionBusiness,completeLegacyProtectedRedemption:svc.completeLegacyProtectedRedemption};
  await assert.rejects(redeemRewardWithDeps(redeemDeps,{staff,customerId:c,rewardId:r,requestId:randomUUID()}),{statusCode:409});
  assert.equal((await pool.query('SELECT points FROM customer_balances WHERE customer_id=$1',[c])).rows[0].points,100);
  assert.equal((await pool.query('SELECT count(*)::int n FROM redemptions WHERE customer_id=$1',[c])).rows[0].n,1);
 });
 it('issues concurrently within unit/cost caps and replays the exact entitlement',async()=>{const g=await grant();const req=randomUUID();const results=await Promise.all(Array.from({length:4},()=>issue(g.grant.id,{requestId:req})));assert.equal(new Set(results.map(x=>x.entitlement.id)).size,1);await assert.rejects(issue(g.grant.id,{requestId:req,customerId:randomUUID()}),{statusCode:409});const unique=await Promise.allSettled(Array.from({length:4},()=>issue(g.grant.id)));assert.equal(unique.filter(x=>x.status==='fulfilled').length,1);const row=(await pool.query('SELECT * FROM hospitality_grants')).rows[0];assert.equal(row.used_units,2);assert.equal(Number(row.used_cost),10);});
 it('honors issued gestures after grant revocation and redeems exactly once without points',async()=>{const g=await grant();const e=(await issue(g.grant.id)).entitlement;await hospitality.revokeHospitalityGrant({businessId:b,staff:owner,grantId:g.grant.id},deps);await assert.rejects(issue(g.grant.id),{statusCode:403});const args={businessId:b,staff,customerId:c,hospitalityId:e.id,requestId:randomUUID()};const results=await Promise.all([svc.redeemEntitlement(args,deps),svc.redeemEntitlement(args,deps)]);assert.equal(results[0].redemptionId,results[1].redemptionId);assert.equal(results[0].pointsCost,0);assert.equal((await pool.query('SELECT points FROM customer_balances')).rows[0].points,60);await assert.rejects(svc.redeemEntitlement({...args,requestId:randomUUID()},deps),{statusCode:409});});
 it('rolls issuance and budget back when audit is unavailable',async()=>{const g=await grant();await pool.query("CREATE OR REPLACE FUNCTION test_hospitality_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER test_hospitality_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_hospitality_fail()");try{await assert.rejects(issue(g.grant.id),/audit unavailable/);assert.equal((await pool.query('SELECT used_units FROM hospitality_grants')).rows[0].used_units,0);}finally{await pool.query('DROP TRIGGER test_hospitality_fail ON audit_logs; DROP FUNCTION test_hospitality_fail()');}});
 it('rechecks external currency and integer minor units against the locked business',async()=>{
  await pool.query('UPDATE businesses SET program_json=$2 WHERE id=$1',[b,{points_per_visit:10,region:{country:'CL',currency:'CLP',timezone:'America/Santiago'},external_awards:{enabled:true}}]);
  const {awardFromExternalEventWithDeps}=await import('../../src/app/services/external-award-service.js'),{computePoints,computePointsWithEvidence}=await import('../../src/app/services/points-service.js');
  const business=(await pool.query('SELECT * FROM businesses WHERE id=$1',[b])).rows[0];
  const stale={...business,program_json:{...business.program_json,region:{country:'MX',currency:'MXN',timezone:'America/Mexico_City'}}};
  const awardDeps={withTransaction:transaction,setCurrentTenant:async()=>{},BusinessRepo:{getPublicBySlug:async()=>({id:b}),getById:async()=>stale},CustomerRepo:{getById:async()=>({id:c,business_id:b}),getByBusinessAndPhone:async()=>null},computePoints,computePointsWithEvidence,protectedEarningBusiness:svc.protectedEarningBusiness,timingSafeEqualString:()=>true};
  const award=extra=>awardFromExternalEventWithDeps(awardDeps,{businessSlug:'test',externalEventId:randomUUID(),customerId:c,visits:1,skipApiKeyCheck:true,...extra});
  await assert.rejects(award({amount_q:10,meta:{pos_sale:{currency:'MXN'}}}),{code:'CURRENCY_MISMATCH'});
  await assert.rejects(award({amount_q:10.5,expectedCurrency:'CLP'}),{statusCode:400});
  assert.equal((await pool.query('SELECT count(*)::int n FROM transactions')).rows[0].n,0);
  assert.equal((await award({amount_q:1500,expectedCurrency:'CLP'})).pointsAwarded,10);
 });
 it('uses protected purchase rules inside external transactions and ends them on legacy redemption',async()=>{
  await pool.query("UPDATE businesses SET program_json=program_json||'{\"external_awards\":{\"enabled\":true}}' WHERE id=$1",[b]);
  await pool.query("UPDATE businesses SET program_json=program_json||'{\"points_per_visit\":5}' WHERE id=$1",[b]);
  const {awardFromExternalEventWithDeps}=await import('../../src/app/services/external-award-service.js'),{computePoints,computePointsWithEvidence}=await import('../../src/app/services/points-service.js');
  const getBusiness=async()=> (await pool.query('SELECT * FROM businesses WHERE id=$1',[b])).rows[0];
  const awardDeps={withTransaction:transaction,setCurrentTenant:async()=>{},BusinessRepo:{getPublicBySlug:async()=>({id:b}),getById:getBusiness},CustomerRepo:{getById:async()=>({id:c,business_id:b}),getByBusinessAndPhone:async()=>null},computePoints,computePointsWithEvidence,protectedEarningBusiness:svc.protectedEarningBusiness,timingSafeEqualString:()=>true};
  const purchase=()=>awardFromExternalEventWithDeps(awardDeps,{businessSlug:'test',externalEventId:randomUUID(),customerId:c,visits:1,skipApiKeyCheck:true});
  assert.equal((await purchase()).pointsAwarded,10);assert.equal((await purchase()).pointsAwarded,10);
  const {redeemRewardWithDeps}=await import('../../src/app/services/staff-service.js');
  const result=await redeemRewardWithDeps({BusinessRepo:{getById:getBusiness},RewardRepo:{listBranchIds:async()=>[]},withTransaction:transaction,settlePendingPointsForCustomer:async()=>{},expirePointsForCustomer:async()=>{},enqueueWebhookEvent:async()=>{},protectedRedemptionReward:svc.protectedRedemptionReward,lockProtectedRedemptionBusiness:svc.lockProtectedRedemptionBusiness,completeLegacyProtectedRedemption:svc.completeLegacyProtectedRedemption},{staff,customerId:c,rewardId:r,requestId:randomUUID()});
  assert.equal(result.newBalance,0);assert.equal((await purchase()).pointsAwarded,5);assert.equal((await pool.query('SELECT count(*)::int AS n FROM reward_entitlement_fulfillments')).rows[0].n,1);
 });
 it('rechecks grant expiry after waiting and preserves immutable issue and fulfillment history',async()=>{
  const g=await grant({endsAt:new Date(Date.now()+200).toISOString()});const locker=await pool.connect();try{await locker.query('BEGIN');await locker.query('SELECT id FROM hospitality_grants WHERE id=$1 FOR UPDATE',[g.grant.id]);const rejected=assert.rejects(issue(g.grant.id),{statusCode:403});await locker.query('SELECT pg_sleep(0.25)');await locker.query('COMMIT');await rejected;}finally{await locker.query('ROLLBACK');locker.release();}
  const valid=await grant(),e=(await issue(valid.grant.id)).entitlement;await assert.rejects(pool.query("UPDATE hospitality_entitlements SET title='Changed' WHERE id=$1",[e.id]),/immutable/);await assert.rejects(pool.query("UPDATE hospitality_grants SET total_units=100 WHERE id=$1",[valid.grant.id]),/immutable/);
  const done=await svc.redeemEntitlement({businessId:b,staff,customerId:c,hospitalityId:e.id,requestId:randomUUID()},deps);await pool.query("UPDATE rewards SET name='Changed' WHERE id=$1",[r]);assert.equal((await pool.query('SELECT fulfilled_reward_name FROM reward_entitlement_fulfillments WHERE redemption_id=$1',[done.redemptionId])).rows[0].fulfilled_reward_name,'Café');assert.equal(await transaction(client=>svc.protectedRedemptionName(client,done.redemptionId)),'Café');await assert.rejects(pool.query('DELETE FROM reward_entitlement_fulfillments'),/immutable/);
 });
 it('executes all flows with restricted branch/redemption privileges and forced tenant RLS',async()=>{
  await pool.query(`GRANT USAGE ON SCHEMA public,app TO reward_promise_test_app;
   GRANT SELECT,UPDATE ON businesses,staff_users,customers,customer_balances,rewards TO reward_promise_test_app;
   GRANT SELECT,INSERT,DELETE ON reward_branches TO reward_promise_test_app;
   GRANT SELECT,INSERT ON branches,redemptions,transactions,reward_unit_costs,redemption_cost_snapshots,customer_reward_promises,hospitality_entitlements,reward_entitlement_fulfillments TO reward_promise_test_app;
   GRANT SELECT,INSERT,UPDATE ON reward_promise_cycles,reward_availability,hospitality_grants TO reward_promise_test_app;
   GRANT INSERT ON audit_logs TO reward_promise_test_app;`);
  const restricted={transaction:fn=>transaction(async client=>{await client.query('SET LOCAL ROLE reward_promise_test_app');await client.query("SELECT set_config('app.current_tenant',$1,true)",[b]);const access=(await client.query("SELECT has_table_privilege(current_user,'redemptions','UPDATE') AS red,has_table_privilege(current_user,'branches','UPDATE') AS branch")).rows[0];assert.equal(access.red,false);assert.equal(access.branch,false);return fn(client);})};
  await restricted.transaction(client=>client.query('UPDATE rewards SET points_cost=100 WHERE id=$1',[r]));const list=await svc.listCustomerEntitlements({businessId:b,customerId:c},restricted);assert.equal(list.promises.length,2);
  const opts={businessId:b,staff:owner,requestId:randomUUID(),staffId:s,branchId:branch,rewardId:r,title:'Cortesía aprobada',totalUnits:1,totalCost:5,unitCostLimit:5,startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),validHours:48};
  const g=await hospitality.createHospitalityGrant(opts,restricted),e=await hospitality.issueHospitality({businessId:b,staff,grantId:g.grant.id,customerId:c,requestId:randomUUID()},restricted);await svc.redeemEntitlement({businessId:b,staff,customerId:c,hospitalityId:e.entitlement.id,requestId:randomUUID()},restricted);
  await transaction(async client=>{await client.query('SET LOCAL ROLE reward_promise_test_app');await client.query("SELECT set_config('app.current_tenant',$1,true)",[other]);assert.equal((await client.query('SELECT * FROM hospitality_entitlements')).rowCount,0);assert.equal((await client.query('SELECT * FROM reward_promise_cycles')).rowCount,0);});
  const tables=(await pool.query("SELECT relforcerowsecurity FROM pg_class WHERE relname IN ('reward_promise_cycles','customer_reward_promises','reward_availability','hospitality_grants','hospitality_entitlements','reward_entitlement_fulfillments')")).rows;assert.equal(tables.length,6);assert.ok(tables.every(r=>r.relforcerowsecurity));
 });
 it('reports all issued entitlements beyond the history page with historical cost coverage',async()=>{
  const g=(await grant({totalUnits:150,totalCost:750})).grant;
  await pool.query(`INSERT INTO hospitality_entitlements(id,business_id,grant_id,customer_id,issued_by_staff_id,branch_id,reward_id,reward_name,title,unit_cost_limit,approved_cost,issued_at,expires_at,request_id,payload_fingerprint)
   SELECT gen_random_uuid(),$1,$2,$3,$4,$5,$6,'Café','Cortesía',5,4,now()-make_interval(hours=>106-n),CASE WHEN n<=65 THEN now()-interval '1 day' ELSE now()+interval '1 day' END,gen_random_uuid(),'fixture' FROM generate_series(1,105) n`,[b,g.id,c,s,branch,r]);
  await pool.query('UPDATE hospitality_grants SET used_units=105,used_cost=525 WHERE id=$1',[g.id]);
  await pool.query(`WITH delivered AS (INSERT INTO redemptions(id,business_id,customer_id,reward_id,points_cost,status,redeemed_at,request_id)
   SELECT gen_random_uuid(),business_id,customer_id,reward_id,0,'REDEEMED',now(),id FROM hospitality_entitlements WHERE grant_id=$1 ORDER BY issued_at LIMIT 35 RETURNING *)
   INSERT INTO reward_entitlement_fulfillments(id,business_id,hospitality_id,redemption_id,original_reward_id,fulfilled_reward_id,fulfilled_reward_name,customer_accepted,request_id,payload_fingerprint)
   SELECT gen_random_uuid(),business_id,request_id,id,reward_id,reward_id,'Café',false,gen_random_uuid(),'fixture' FROM delivered`,[g.id]);
  await pool.query(`INSERT INTO redemption_cost_snapshots(redemption_id,business_id,reward_id,points_cost,unit_cost_q,redeemed_at)
   SELECT redemption_id,$1,$2,0,CASE WHEN n<=20 THEN 5 WHEN n<=25 THEN 0 ELSE NULL END,now() FROM (SELECT f.redemption_id,row_number() OVER(ORDER BY e.issued_at) n FROM reward_entitlement_fulfillments f JOIN hospitality_entitlements e ON e.id=f.hospitality_id WHERE e.grant_id=$3) rows WHERE n<=30`,[b,r,g.id]);
  await pool.query('UPDATE reward_unit_costs SET unit_cost_q=99 WHERE business_id=$1 AND reward_id=$2',[b,r]);
  const result=await hospitality.listHospitality({businessId:b,staff:owner,owner:true},deps),report=result.grants[0].report;
  assert.equal(result.history.length,100);
  assert.deepEqual(report,{issued:105,fulfilled:35,expired_unused:30,pending:40,committed_cost:525,fulfilled_known_cost:100,fulfilled_cost_known_units:25,fulfilled_cost_unknown_units:10});
  assert.ok(Date.parse(result.server_now));
 });
 it('keeps empty and unknown fulfillment costs distinct and reports stopped promises',async()=>{
  const g=(await grant()).grant;
  let result=await hospitality.listHospitality({businessId:b,staff:owner,owner:true},deps);
  assert.deepEqual(result.grants[0].report,{issued:0,fulfilled:0,expired_unused:0,pending:0,committed_cost:0,fulfilled_known_cost:null,fulfilled_cost_known_units:0,fulfilled_cost_unknown_units:0});
  const e=(await issue(g.id)).entitlement;
  await hospitality.revokeHospitalityGrant({businessId:b,staff:owner,grantId:g.id},deps);
  result=await hospitality.listHospitality({businessId:b,staff:owner,owner:true},deps);
  assert.equal(result.grants[0].report.pending,1);
  const redeemed=await svc.redeemEntitlement({businessId:b,staff,customerId:c,hospitalityId:e.id,requestId:randomUUID()},deps);
  await pool.query('DELETE FROM redemption_cost_snapshots WHERE redemption_id=$1',[redeemed.redemptionId]);
  result=await hospitality.listHospitality({businessId:b,staff:owner,owner:true},deps);
  assert.equal(result.grants[0].report.fulfilled_known_cost,null);
  assert.equal(result.grants[0].report.fulfilled_cost_unknown_units,1);
  assert.equal(result.grants[0].report.pending,0);
  assert.equal(Number(result.grants[0].report.committed_cost),5);
 });
 it('keeps owner reports tenant scoped and out of staff reads',async()=>{
  await grant();
  await assert.rejects(hospitality.listHospitality({businessId:b,staff,owner:true},deps),{statusCode:403});
  await assert.rejects(hospitality.listHospitality({businessId:other,staff:owner,owner:true},deps),{statusCode:403});
  assert.equal((await hospitality.listHospitality({businessId:b,staff},deps)).grants[0].report,undefined);
 });
 it('includes older authorizations instead of truncating the owner report at 100 grants',async()=>{
  const g=(await grant()).grant;
  await pool.query(`INSERT INTO hospitality_grants(id,business_id,staff_id,branch_id,reward_id,title,total_units,total_cost,unit_cost_limit,starts_at,ends_at,valid_hours,request_id,payload_fingerprint,created_by_staff_id,reward_name)
   SELECT gen_random_uuid(),business_id,staff_id,branch_id,reward_id,title,total_units,total_cost,unit_cost_limit,starts_at,ends_at,valid_hours,gen_random_uuid(),'fixture',created_by_staff_id,reward_name FROM hospitality_grants CROSS JOIN generate_series(1,100) n WHERE id=$1`,[g.id]);
  const result=await hospitality.listHospitality({businessId:b,staff:owner,owner:true},deps);
  assert.equal(result.grants.length,101);
  assert.ok(result.grants.every(row=>row.report.issued===0));
 });
 it('reserves only whole units when the remaining budget is below one ceiling',async()=>{
  const g=(await grant({totalUnits:5,totalCost:12})).grant;
  const issued=await Promise.allSettled(Array.from({length:4},()=>issue(g.id)));
  assert.equal(issued.filter(x=>x.status==='fulfilled').length,2);
  const result=await hospitality.listHospitality({businessId:b,staff:owner,owner:true},deps);
  assert.equal(result.grants[0].report.issued,2);
  assert.equal(result.grants[0].report.committed_cost,10);
  assert.equal(Number(result.grants[0].remaining_cost),2);
 });
 it('rejects stale staff branch, foreign tenant and unknown/unapproved cost',async()=>{await assert.rejects(grant({staff}),{statusCode:403});await assert.rejects(grant({unitCostLimit:4}),{statusCode:400});const g=await grant();await assert.rejects(issue(g.grant.id,{businessId:other}),{statusCode:403});await pool.query('UPDATE staff_users SET branch_id=NULL WHERE id=$1',[s]);await assert.rejects(issue(g.grant.id),{statusCode:403});});
});
