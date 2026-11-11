import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,beforeEach,after,describe,it} from 'node:test';
import pg from 'pg';
const url=process.env.GROWTH_MESSAGING_TEST_DB_URL;
const suite=url?describe:describe.skip;
let db,service,prefs,database,originalPlans,plans,messagingConfig;
const businessId=randomUUID(),otherBusiness=randomUUID();
const customerA=randomUUID(),customerB=randomUUID(),customerC=randomUUID();
const campaignId=randomUUID();
const start=new Date('2026-11-10T15:00:00Z');
const ctx=fn=>database.withDbClientContext({tenantId:businessId,platformAdmin:false},fn);
const queue=(extra={})=>ctx(()=>service.queueCampaignMessages({businessId,campaignId,request_id:randomUUID(),now:start,...extra}));
async function dispatch(send,at=start,extra={}) {return service.processCampaignMessagesOnce({businessId,now:()=>at,send,...extra});}
async function rows() {return (await db.query('SELECT * FROM growth_message_outbox ORDER BY id')).rows;}
suite('campaign messaging on disposable PostgreSQL',()=>{
  before(async()=>{
    const parsed=new URL(url);
    assert.ok(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname));
    assert.equal(parsed.pathname,'/growth_messaging_test');
    Object.assign(process.env,{NODE_ENV:'test',DB_HOST:parsed.hostname,DB_PORT:parsed.port,DB_NAME:'growth_messaging_test',DB_USER:decodeURIComponent(parsed.username),DB_PASSWORD:decodeURIComponent(parsed.password),DB_PASSWORD_FILE:'',DB_MIGRATIONS_PASSWORD_FILE:'',JWT_SECRET_FILE:'',JWT_SECRET:'fixture-growth-messaging-secret-12345678'});
    db=new pg.Pool({connectionString:url});
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS app');
    await db.query(`CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_tenant',true),'')::uuid $$;
      CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.platform_admin',true),'')='true' $$`);
    for(const path of ['../../src/app/schema.sql','../../src/app/migrations/2026-11-10-customer-recovery.sql','../../src/app/migrations/2026-11-10-growth-campaigns.sql','../../src/app/migrations/2026-11-10-growth-messaging.sql','../../src/app/migrations/2026-11-10-growth-limits.sql','../../src/app/migrations/2026-11-10-automation-controls.sql']) {
      // Fixed repository fixtures; the environment URL cannot select a SQL file.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await db.query(await readFile(new URL(path,import.meta.url),'utf8'));
    }
    await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='growth_messaging_rls') THEN CREATE ROLE growth_messaging_rls NOLOGIN; END IF; END $$;
      GRANT USAGE ON SCHEMA public,app TO growth_messaging_rls; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO growth_messaging_rls;`);
    database=await import('../../src/app/database.js');
    messagingConfig=(await import('../../src/config/index.js')).config;
    service=await import('../../src/app/services/campaign-message-service.js');
    prefs=await import('../../src/app/services/marketing-preference-service.js');
    plans=(await import('../../src/app/services/plan-config-service.js')).PlanConfigService;
    originalPlans=plans.getPlanFeatureOverrides;plans.getPlanFeatureOverrides=async()=>({});
  });
  after(async()=>{if(plans)plans.getPlanFeatureOverrides=originalPlans;await database?.closeDatabase();await db?.end();});
  beforeEach(async()=>{
    plans.getPlanFeatureOverrides=async()=>({});
    Object.assign(messagingConfig,{MESSAGE_PROVIDER_ORDER:['waha'],WAHA_BASE_URL:'http://fixture.invalid',WAHA_API_KEY:'fixture-only'});
    await db.query('TRUNCATE businesses CASCADE');
    await db.query(`INSERT INTO businesses(id,name,slug,email,password_hash,plan) VALUES($1,'Café','fixture','fixture@example.test','unused','NEGOCIO'),($2,'Other','other','other@example.test','unused','NEGOCIO')`,[businessId,otherBusiness]);
    await db.query(`INSERT INTO customers(id,business_id,phone,name) VALUES($1,$4,'+50255550001','Ana'),($2,$4,'+50255550002','Beto'),($3,$4,'+50255550003','Carla')`,[customerA,customerB,customerC,businessId]);
    await db.query(`INSERT INTO growth_campaigns(id,business_id,request_id,name,status,bonus_points,minimum_purchase_q,duration_days,holdout_percent,starts_at,expires_at)
      VALUES($1,$2,$3,'Fixture','active',50,20,30,20,$4,$5)`,[campaignId,businessId,randomUUID(),start,new Date(start.getTime()+30*86400000)]);
    for(const [customer,allocation] of [[customerA,'treatment'],[customerB,'control'],[customerC,'treatment']]) await db.query(`INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation) VALUES($1,$2,$3,$4,$5)`,[randomUUID(),businessId,campaignId,customer,allocation]);
    await ctx(()=>prefs.setMarketingPreference({businessId,customerId:customerA,marketing_opt_in:true}));
    await ctx(()=>prefs.setMarketingPreference({businessId,customerId:customerB,marketing_opt_in:true}));
  });
  it('defaults out, queues only consenting treatment members, and replays idempotently',async()=>{
    assert.equal((await ctx(()=>prefs.getMarketingPreference({businessId,customerId:customerC}))).marketing_opt_in,false);
    const request_id=randomUUID();
    const results=await Promise.all([queue({request_id}),queue({request_id})]);
    assert.deepEqual(results.map(r=>r.queued_count).sort(),[0,1]);
    assert.equal((await queue()).queued_count,0);
    assert.deepEqual((await rows()).map(r=>r.customer_id),[customerA]);
    assert.equal((await rows())[0].status,'queued');
  });
  it('GET capability is read only; POST revokes preference and suppresses queued messages, without exposing contact',async()=>{
    await queue();
    const link=await ctx(()=>prefs.issueMarketingUnsubscribeUrl({businessId,customerId:customerA}));
    const token=new URL(link).searchParams.get('token');
    assert.match(token,/^[A-Za-z0-9_-]{43}$/);
    const stored=(await db.query('SELECT * FROM marketing_unsubscribe_tokens')).rows[0];
    assert.notEqual(stored.token_hash,token);
    assert.deepEqual(await prefs.tokenMarketingPreference({token}),{ok:true,business_name:'Café',marketing_opt_in:true});
    assert.equal((await rows())[0].status,'queued');
    assert.equal((await prefs.tokenMarketingPreference({token,confirm:true})).marketing_opt_in,false);
    assert.equal((await rows())[0].status,'suppressed');
    await assert.rejects(prefs.tokenMarketingPreference({token:'wrong'}),{statusCode:404});
  });
  it('concurrent workers accept exactly one provider request and preserve safe identifiers',async()=>{
    await queue();let calls=0;
    const send=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,30));return {ok:true,accepted:true,provider:'fixture',providerId:'opaque-reference',id:randomUUID()};};
    await Promise.all([dispatch(send),dispatch(send)]);
    assert.equal(calls,1);const row=(await rows())[0];assert.equal(row.status,'accepted');assert.equal(row.provider_reference,'opaque-reference');
  });
  it('backs off definite failures at most three times; ambiguous failures and crashes never resend',async()=>{
    await queue();let calls=0;
    const rejected=async()=>{calls++;return {ok:false,error:'NO_DELIVERY_PROVIDER'};};
    await dispatch(rejected);await dispatch(rejected);assert.equal(calls,1);
    await dispatch(rejected,new Date(start.getTime()+5*60000));
    await dispatch(rejected,new Date(start.getTime()+15*60000));
    await dispatch(rejected,new Date(start.getTime()+60*60000));
    assert.equal(calls,3);assert.equal((await rows())[0].status,'failed');
    await db.query(`UPDATE growth_message_outbox SET status='processing',attempts=1,lease_until=$1,last_attempt_at=$1,claim_token=$2`,[new Date(start.getTime()-60000),randomUUID()]);
    await dispatch(rejected);assert.equal(calls,3);assert.equal((await rows())[0].status,'uncertain');
    await db.query(`UPDATE growth_message_outbox SET status='queued',attempts=0,next_attempt_at=$1`,[start]);
    await dispatch(async()=>{calls++;throw new Error('network response lost');});
    await dispatch(rejected,new Date(start.getTime()+86400000));
    assert.equal(calls,4);assert.equal((await rows())[0].status,'uncertain');
  });
  it('refuses a live queue when only the development provider is configured',async()=>{
    messagingConfig.MESSAGE_PROVIDER_ORDER=['dev'];
    await assert.rejects(queue(),{statusCode:409});
    assert.equal((await rows()).length,0);
  });
  it('does not count simulation as acceptance',async()=>{
    await queue();const result=await dispatch(async()=>({ok:true,accepted:false,provider:'dev',simulated:true}));
    assert.equal(result.accepted,0);assert.equal((await rows())[0].status,'suppressed');
  });
  it('enforces quiet hours and one message per seven days across campaigns',async()=>{
    await queue();let calls=0;const send=async()=>{calls++;return{ok:true,accepted:true,provider:'fixture'};};
    const quiet=new Date('2026-11-11T01:00:00Z');await dispatch(send,quiet);assert.equal(calls,0);
    const daytime=new Date('2026-11-11T16:00:00Z');await dispatch(send,daytime);assert.equal(calls,1);
    const second=randomUUID();
    await db.query(`INSERT INTO growth_campaigns(id,business_id,request_id,name,status,bonus_points,minimum_purchase_q,duration_days,holdout_percent,starts_at,expires_at)
      SELECT $1,business_id,$2,name,status,bonus_points,minimum_purchase_q,duration_days,holdout_percent,starts_at,expires_at FROM growth_campaigns WHERE id=$3`,[second,randomUUID(),campaignId]);
    await db.query(`INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation) VALUES($1,$2,$3,$4,'treatment')`,[randomUUID(),businessId,second,customerA]);
    await queue({campaignId:second});await dispatch(send,daytime);assert.equal(calls,1);
    await dispatch(send,new Date(daytime.getTime()+7*86400000));assert.equal(calls,2);
  });
  it('dispatch rechecks pause, expiry, consent, deletion and plan eligibility',async()=>{
    for(const mutation of [
      `UPDATE growth_campaigns SET status='paused',paused_at=now()`,
      `UPDATE growth_campaigns SET expires_at='2026-11-10T16:00:00Z'`,
      `UPDATE customer_marketing_preferences SET marketing_opt_in=false`,
      `UPDATE customers SET deleted_at=now() WHERE id='${customerA}'`,
      `UPDATE businesses SET plan='EMPRENDEDOR'`
    ]) {
      await db.query(`UPDATE growth_campaigns SET status='active',paused_at=NULL,expires_at='2026-12-10T15:00:00Z'; UPDATE customers SET deleted_at=NULL; UPDATE businesses SET plan='NEGOCIO'; UPDATE customer_marketing_preferences SET marketing_opt_in=true; TRUNCATE growth_message_outbox,growth_message_requests`);
      await queue();await db.query(mutation);
      await dispatch(async()=>{assert.fail('ineligible message must not reach provider');},new Date('2026-11-10T17:00:00Z'));
      assert.equal((await rows())[0].status,'suppressed');
    }
  });
  it('requires the same campaign, lifecycle and analytics entitlements for readiness and queueing',async()=>{
    for(const feature of ['campaign_rules','lifecycle_automation','analytics']) {
      plans.getPlanFeatureOverrides=async()=>({NEGOCIO:{[feature]:false}});
      const preview=await ctx(()=>service.getCampaignMessages({businessId,campaignId,now:start}));
      assert.equal(preview.can_queue,false,feature);
      await assert.rejects(queue(),{statusCode:403});
      assert.equal((await rows()).length,0);
    }
  });
  it('suppresses queued offers when analytics is revoked before dispatch',async()=>{
    await queue();
    plans.getPlanFeatureOverrides=async()=>({NEGOCIO:{analytics:false}});
    await dispatch(async()=>{assert.fail('analytics-revoked offer must not reach provider');});
    assert.equal((await rows())[0].status,'suppressed');
    assert.equal((await rows())[0].reason,'plan_unavailable');
  });
  it('rechecks analytics after claiming and immediately before provider dispatch',async()=>{
    await queue();let reads=0;
    plans.getPlanFeatureOverrides=async()=>++reads===1?{}:{NEGOCIO:{analytics:false}};
    await dispatch(async()=>{assert.fail('analytics revoked after claim must not reach provider');});
    assert.equal((await rows())[0].status,'suppressed');
    assert.equal((await rows())[0].reason,'dispatch_suppressed');
  });
  it('legacy lifecycle entry points honor saved opt-in rules and cannot send directly',async()=>{
    const lifecycle=await import('../../src/app/services/lifecycle-service.js');
    await db.query('UPDATE customers SET birthday=current_date WHERE id=$1',[customerA]);
    const out=await ctx(()=>lifecycle.processBirthdayBusiness(businessId));
    assert.deepEqual(out,{sent:0,queued:0,awarded:0,points:0,reason:'inactive'});
    assert.equal((await db.query('SELECT * FROM lifecycle_message_outbox')).rowCount,0);
    assert.equal((await db.query('SELECT * FROM message_logs')).rowCount,0);
  });
  it('legacy marketing suppresses unconsented recipients and never falls back to development sends',async()=>{
    const {sendMessage}=await import('../../src/app/services/messaging-service.js');
    messagingConfig.MESSAGE_PROVIDER_ORDER=['dev'];
    const blocked=await ctx(()=>sendMessage({businessId,customerId:customerC,channel:'lifecycle',to:'+50255550003',body:'fixture'}));
    assert.equal(blocked.suppressed,true);assert.equal((await db.query('SELECT * FROM message_logs')).rowCount,0);
    const noLiveProvider=await ctx(()=>sendMessage({businessId,customerId:customerA,channel:'lifecycle',to:'+50255550001',body:'fixture'}));
    assert.equal(noLiveProvider.ok,false);assert.equal(noLiveProvider.error,'NO_DELIVERY_PROVIDER');
    const logs=(await db.query('SELECT body,status FROM message_logs')).rows;
    assert.equal(logs[0].status,'FAILED');assert.match(logs[0].body,/token=\[REDACTED\]/);
  });
  it('never previews, queues or dispatches an already-used one-time offer',async()=>{
    await db.query(`UPDATE growth_campaign_members SET claimed_at=now(),bonus_points_awarded=50 WHERE customer_id=$1`,[customerA]);
    const preview=await ctx(()=>service.getCampaignMessages({businessId,campaignId,now:start}));
    assert.equal(preview.eligible_count,0);assert.equal((await queue()).queued_count,0);
    await db.query(`UPDATE growth_campaign_members SET claimed_at=NULL,bonus_points_awarded=0 WHERE customer_id=$1`,[customerA]);
    await queue();
    await db.query(`UPDATE growth_campaign_members SET claimed_at=now(),bonus_points_awarded=50 WHERE customer_id=$1`,[customerA]);
    await dispatch(async()=>{assert.fail('used offer must not reach provider');});
    assert.equal((await rows())[0].status,'suppressed');assert.equal((await rows())[0].reason,'offer_already_used');
  });
  it('restricts tenants through RLS and composite foreign keys, and permits customer deletion',async()=>{
    await queue();const client=await db.connect();
    try {await client.query('BEGIN; SET LOCAL ROLE growth_messaging_rls');await client.query(`SELECT set_config('app.current_tenant',$1,true)`,[otherBusiness]);
      assert.equal((await client.query('SELECT * FROM growth_message_outbox')).rowCount,0);
      assert.equal((await client.query('SELECT * FROM customer_marketing_preferences')).rowCount,0);
      await assert.rejects(client.query(`INSERT INTO customer_marketing_preferences(business_id,customer_id) VALUES($1,$2)`,[otherBusiness,customerA]),{code:'23503'});
    } finally {await client.query('ROLLBACK');client.release();}
    await db.query('DELETE FROM customers WHERE id=$1',[customerA]);
    assert.equal((await rows()).length,0);
  });
});
