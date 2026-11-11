import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,beforeEach,after,describe,it} from 'node:test';
import pg from 'pg';
const url=process.env.DECISION_OPERATIONS_TEST_DB_URL,suite=url?describe:describe.skip;
const bid=randomUUID(),cid=randomUUID(),sid=randomUUID(),campaignId=randomUUID(),runId=randomUUID();
const now=new Date('2026-11-11T15:00:00Z');
let db,database,automation,messages,recovery,campaignMessages,plans,previousPlans;
const settings={birthday_enabled:true,birthday_points:10,birthday_monthly_points_cap:100,winback_enabled:true,winback_days:30,winback_points:20,winback_monthly_points_cap:100,minimum_contact_days:7,scheduler_hour_local:9,scheduler_tz:'America/Guatemala'};
const pos={enabled:true,automatic:true,mode:'loyverse',last_completed_at:'2026-11-08T15:00:00Z',last_sync:{status:'ok'}};
const ctx=fn=>database.withDbClientContext({tenantId:bid,platformAdmin:false},fn);
const patch=change=>db.query("UPDATE businesses SET program_json=program_json||$2::jsonb WHERE id=$1",[bid,JSON.stringify(change)]);
const rows=async table=>(await db.query(`SELECT * FROM ${table==='transactions'?'transactions':'lifecycle_message_outbox'}`)).rows;
suite('data readiness and temporary promotion pause',()=>{
 before(async()=>{
  const parsed=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));assert.equal(parsed.pathname,'/decision_operations_test');
  Object.assign(process.env,{NODE_ENV:'test',DB_HOST:parsed.hostname,DB_PORT:parsed.port,DB_NAME:'decision_operations_test',DB_USER:decodeURIComponent(parsed.username),DB_PASSWORD:decodeURIComponent(parsed.password),DB_PASSWORD_FILE:'',DB_MIGRATIONS_PASSWORD_FILE:'',JWT_SECRET_FILE:'',JWT_SECRET:'fixture-decision-operations-secret-only'});
  db=new pg.Pool({connectionString:url});await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS app');
  await db.query(`CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_tenant',true),'')::uuid $$; CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.platform_admin',true),'')='true' $$`);
  for(const file of ['schema.sql','migrations/2026-11-10-customer-recovery.sql','migrations/2026-11-10-growth-campaigns.sql','migrations/2026-11-10-growth-messaging.sql','migrations/2026-11-10-growth-limits.sql','migrations/2026-11-10-automation-controls.sql','migrations/2026-11-10-reusable-audiences.sql']){
   // Fixed repository fixture list, not request input.
   // eslint-disable-next-line security/detect-non-literal-fs-filename
   await db.query(await readFile(new URL('../../src/app/'+file,import.meta.url),'utf8'));
  }
  database=await import('../../src/app/database.js');automation=await import('../../src/app/services/automation-controls-service.js');messages=await import('../../src/app/services/automation-message-service.js');recovery=await import('../../src/app/services/customer-recovery-service.js');campaignMessages=await import('../../src/app/services/campaign-message-service.js');
  plans=(await import('../../src/app/services/plan-config-service.js')).PlanConfigService;previousPlans=plans.getPlanFeatureOverrides;
  Object.assign((await import('../../src/config/index.js')).config,{MESSAGE_PROVIDER_ORDER:['waha'],WAHA_BASE_URL:'http://fixture.invalid',WAHA_API_KEY:'fixture-only'});
 });
 after(async()=>{if(plans)plans.getPlanFeatureOverrides=previousPlans;await database?.closeDatabase();await db?.end();});
 beforeEach(async()=>{
  plans.getPlanFeatureOverrides=async()=>({});await db.query('TRUNCATE businesses CASCADE');
  await db.query("INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_json) VALUES($1,'Fixture','decisions','fixture@example.test','unused','NEGOCIO',$2)",[bid,{lifecycle:settings}]);
  await db.query("INSERT INTO staff_users(id,business_id,name,email,password_hash,role) VALUES($1,$2,'Owner','owner@example.test','unused','OWNER')",[sid,bid]);
  await db.query("INSERT INTO customers(id,business_id,name,phone,birthday,last_visit_at) VALUES($1,$2,'Fixture','+50255550001','1990-11-11','2026-10-12T15:00:00Z')",[cid,bid]);
  await db.query("INSERT INTO customer_balances(customer_id,points,lifetime_points) VALUES($1,0,0) ON CONFLICT(customer_id) DO UPDATE SET points=0,lifetime_points=0",[cid]);
  await db.query("INSERT INTO customer_marketing_preferences(business_id,customer_id,marketing_opt_in) VALUES($1,$2,true)",[bid,cid]);
  await db.query("INSERT INTO transactions(id,business_id,customer_id,amount_q,visits,points,created_at) VALUES($1,$2,$3,20,1,0,'2026-10-01T15:00:00Z')",[randomUUID(),bid,cid]);
 });
 it('blocks stale winback awards while birthday remains available',async()=>{
  await patch({pos_integration:pos});const outcome=await ctx(()=>automation.runAutomationRule({businessId:bid,rule:'winback',now}));
  assert.equal(outcome.reason,'data_quality_sync_stale');assert.equal((await rows('transactions')).length,1);
  const birthday=await ctx(()=>automation.runAutomationRule({businessId:bid,rule:'birthday',now}));assert.equal(birthday.points,10);
 });
 it('shows unavailable recovery counts and rejects new snapshots without persisting a claim',async()=>{
  await patch({pos_integration:pos});const audience=await ctx(()=>recovery.getRecoveryAudience({businessId:bid,now}));assert.equal(audience.paused,true);assert.equal(audience.count_status,'unavailable');assert.deepEqual(audience.customers,[]);
  await assert.rejects(ctx(()=>recovery.createRecoveryRun({businessId:bid,staffId:sid,requestId:randomUUID(),name:'No stale campaign',inactiveDays:30,now})),{statusCode:409});assert.equal((await db.query('SELECT * FROM recovery_runs')).rowCount,0);
 });
 it('defers busy invitations without spending an attempt or removing already awarded points, then resumes',async()=>{
  await ctx(()=>automation.runAutomationRule({businessId:bid,rule:'birthday',now}));await patch({merchant_operating_mode:{mode:'busy',until:'2026-11-11T17:00:00Z'}});let sent=0;
  const send=async()=>{sent++;return{ok:true,accepted:true,provider:'fixture'};};
  await messages.processAutomationMessagesOnce({businessId:bid,now:()=>now,send});let row=(await rows('outbox'))[0];assert.equal(sent,0);assert.equal(row.status,'queued');assert.equal(row.reason,'business_busy');assert.equal(row.attempts,0);assert.equal((await db.query('SELECT points FROM customer_balances')).rows[0].points,10);
  await messages.processAutomationMessagesOnce({businessId:bid,now:()=>new Date('2026-11-11T17:00:00Z'),send});row=(await rows('outbox'))[0];assert.equal(sent,1);assert.equal(row.status,'accepted');
 });
 it('rechecks data after a claim before provider I/O and returns it to the queue',async()=>{
  await ctx(()=>automation.runAutomationRule({businessId:bid,rule:'winback',now}));let calls=0,sent=0;
  plans.getPlanFeatureOverrides=async()=>{calls++;if(calls===2)await patch({pos_integration:pos});return{};};
  await messages.processAutomationMessagesOnce({businessId:bid,now:()=>now,send:async()=>{sent++;return{ok:true,accepted:true,provider:'fixture'};}});
  const row=(await rows('outbox'))[0];assert.equal(sent,0);assert.equal(row.status,'queued');assert.equal(row.reason,'data_quality_sync_stale');assert.equal(row.attempts,0);
 });
 it('prevents activity-based campaign queueing on stale data while preserving the live offer',async()=>{
  await db.query("INSERT INTO recovery_runs(id,business_id,request_id,name,inactive_days,requested_limit,member_count) VALUES($1,$2,$3,'Fixture',30,1,1)",[runId,bid,randomUUID()]);
  await db.query("INSERT INTO growth_campaigns(id,business_id,request_id,recovery_run_id,name,status,bonus_points,minimum_purchase_q,holdout_percent,duration_days,starts_at,expires_at) VALUES($1,$2,$3,$4,'Fixture','active',10,0,20,7,$5,$6)",[campaignId,bid,randomUUID(),runId,now,new Date(now.getTime()+7*86400000)]);
  await db.query("INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation) VALUES($1,$2,$3,$4,'treatment')",[randomUUID(),bid,campaignId,cid]);await patch({pos_integration:pos});
  const report=await ctx(()=>campaignMessages.getCampaignMessages({businessId:bid,campaignId,now}));assert.equal(report.can_queue,false);assert.equal(report.pause_reason,'data_quality_sync_stale');
  await assert.rejects(ctx(()=>campaignMessages.queueCampaignMessages({businessId:bid,campaignId,request_id:randomUUID(),now})),{statusCode:409});assert.equal((await db.query('SELECT status FROM growth_campaigns')).rows[0].status,'active');
 });
});
