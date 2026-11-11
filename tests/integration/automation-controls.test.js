import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,beforeEach,after,describe,it} from 'node:test';
import pg from 'pg';
const url=process.env.AUTOMATION_TEST_DB_URL;
const suite=url?describe:describe.skip;
let db,service,messages,prefs,database,plans,originalPlans;
const businessId=randomUUID(),otherBusiness=randomUUID(),a=randomUUID(),b=randomUUID(),c=randomUUID();
const now=new Date('2026-11-10T15:00:00Z');
const ctx=fn=>database.withDbClientContext({tenantId:businessId,platformAdmin:false},fn);
const settings={birthday_enabled:true,birthday_points:40,birthday_monthly_points_cap:60,winback_enabled:false,winback_days:30,winback_points:20,winback_monthly_points_cap:100,minimum_contact_days:7,scheduler_hour_local:9,scheduler_tz:'America/Guatemala'};
const generate=(extra={})=>ctx(()=>service.runAutomationRule({businessId,rule:'birthday',now,...extra}));
const send=async()=>({ok:true,accepted:true,provider:'fixture',providerId:'fixture-reference',id:randomUUID(),simulated:false});
const dispatch=(extra={})=>messages.processAutomationMessagesOnce({businessId,now:()=>now,send,...extra});
suite('guided automations on disposable PostgreSQL',()=>{
  before(async()=>{
    const parsed=new URL(url);assert.ok(['localhost','127.0.0.1'].includes(parsed.hostname));assert.equal(parsed.pathname,'/automation_test');
    Object.assign(process.env,{NODE_ENV:'test',DB_HOST:parsed.hostname,DB_PORT:parsed.port,DB_NAME:'automation_test',DB_USER:decodeURIComponent(parsed.username),DB_PASSWORD:decodeURIComponent(parsed.password),DB_PASSWORD_FILE:'',DB_MIGRATIONS_PASSWORD_FILE:'',JWT_SECRET_FILE:'',JWT_SECRET:'fixture-automation-secret-12345678'});
    db=new pg.Pool({connectionString:url});await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS app');
    await db.query(`CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_tenant',true),'')::uuid $$; CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.platform_admin',true),'')='true' $$`);
    for(const path of ['../../src/app/schema.sql','../../src/app/migrations/2026-11-10-customer-recovery.sql','../../src/app/migrations/2026-11-10-growth-campaigns.sql','../../src/app/migrations/2026-11-10-growth-messaging.sql','../../src/app/migrations/2026-11-10-growth-limits.sql','../../src/app/migrations/2026-11-10-automation-controls.sql']) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await db.query(await readFile(new URL(path,import.meta.url),'utf8'));
    }
    database=await import('../../src/app/database.js');service=await import('../../src/app/services/automation-controls-service.js');messages=await import('../../src/app/services/automation-message-service.js');prefs=await import('../../src/app/services/marketing-preference-service.js');
    plans=(await import('../../src/app/services/plan-config-service.js')).PlanConfigService;originalPlans=plans.getPlanFeatureOverrides;plans.getPlanFeatureOverrides=async()=>({});
  });
  after(async()=>{if(plans)plans.getPlanFeatureOverrides=originalPlans;await database?.closeDatabase();await db?.end();});
  beforeEach(async()=>{
    await db.query('TRUNCATE businesses CASCADE');
    await db.query(`INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_json) VALUES($1,'Café','automation','fixture@example.test','unused','NEGOCIO',$3),($2,'Other','other','other@example.test','unused','NEGOCIO','{}')`,[businessId,otherBusiness,{lifecycle:{...settings,suspicious_digest_enabled:true},other:{preserve:true}}]);
    for(const [customer,phone] of [[a,'+50255550001'],[b,'+50255550002'],[c,'+50255550003']]) {
      await db.query(`INSERT INTO customers(id,business_id,phone,name,birthday,last_visit_at) VALUES($1,$2,$3,'Fixture','1990-11-10','2026-10-11T15:00:00Z')`,[customer,businessId,phone]);
      await db.query(`INSERT INTO customer_balances(customer_id,points,lifetime_points) VALUES($1,0,0) ON CONFLICT(customer_id) DO UPDATE SET points=0,lifetime_points=0`,[customer]);
    }
    await ctx(()=>prefs.setMarketingPreference({businessId,customerId:a,marketing_opt_in:true}));await ctx(()=>prefs.setMarketingPreference({businessId,customerId:b,marketing_opt_in:true}));
  });
  it('preserves unrelated settings, validates budget, and defaults new businesses off',async()=>{
    const saved=await ctx(()=>service.saveAutomationSettings({businessId,settings:{...settings,birthday_monthly_points_cap:80}}));
    assert.equal(saved.settings.birthday_monthly_points_cap,80);
    const row=(await db.query('SELECT program_json FROM businesses WHERE id=$1',[businessId])).rows[0];assert.equal(row.program_json.other.preserve,true);assert.equal(row.program_json.lifecycle.suspicious_digest_enabled,true);
    await assert.rejects(ctx(()=>service.saveAutomationSettings({businessId,settings:{...settings,birthday_monthly_points_cap:1}})),{statusCode:400});
    const fresh=await database.withDbClientContext({tenantId:otherBusiness},()=>service.getAutomationControls({businessId:otherBusiness,now}));assert.equal(fresh.settings.birthday_enabled,false);assert.equal(fresh.settings.winback_enabled,false);
  });
  it('concurrent runs atomically respect gross budgets and event idempotency',async()=>{
    await Promise.all([generate(),generate(),generate()]);
    assert.equal(Number((await db.query('SELECT sum(points) AS n FROM transactions')).rows[0].n),40);
    assert.equal((await db.query('SELECT * FROM lifecycle_message_outbox')).rowCount,1);
    assert.equal((await db.query('SELECT points_committed FROM lifecycle_automation_budgets')).rows[0].points_committed,40);
    await db.query('UPDATE transactions SET status=\'REVERSED\'; UPDATE customer_balances SET points=0');await generate();assert.equal((await db.query('SELECT * FROM lifecycle_message_outbox')).rowCount,1);
  });
  it('consent, deletion, scheduling and plan eligibility are checked before granting points',async()=>{
    await db.query('UPDATE customers SET deleted_at=now() WHERE id=$1',[a]);await ctx(()=>prefs.setMarketingPreference({businessId,customerId:b,marketing_opt_in:false}));await generate();assert.equal((await db.query('SELECT * FROM transactions')).rowCount,0);
    await db.query('UPDATE customers SET deleted_at=NULL');await ctx(()=>prefs.setMarketingPreference({businessId,customerId:a,marketing_opt_in:true}));await generate({now:new Date('2026-11-10T14:00:00Z')});assert.equal((await db.query('SELECT * FROM transactions')).rowCount,0);
    await db.query("UPDATE businesses SET plan='EMPRENDEDOR'");await generate();assert.equal((await db.query('SELECT * FROM transactions')).rowCount,0);
  });
  it('uses Guatemala calendar day and does not count stale historical events again',async()=>{
    await db.query(`INSERT INTO lifecycle_events(id,business_id,customer_id,event_type,event_date) VALUES($1,$2,$3,'birthday','2026-11-10')`,[randomUUID(),businessId,a]);
    await generate();const recipients=(await db.query('SELECT customer_id FROM lifecycle_message_outbox')).rows.map(x=>x.customer_id);assert.deepEqual(recipients,[b]);
    assert.equal(service.automationLocalDate(new Date('2026-11-11T02:00:00Z')),'2026-11-10');
  });
  it('rolls back budget, event and points together when queue persistence fails',async()=>{
    await db.query(`CREATE FUNCTION reject_automation_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER reject_automation_queue BEFORE INSERT ON lifecycle_message_outbox FOR EACH ROW EXECUTE FUNCTION reject_automation_queue()`);
    try {await assert.rejects(generate());assert.equal((await db.query('SELECT * FROM transactions')).rowCount,0);assert.equal((await db.query('SELECT * FROM lifecycle_events')).rowCount,0);assert.equal((await db.query('SELECT * FROM lifecycle_automation_budgets')).rowCount,0);} finally {await db.query('DROP TRIGGER reject_automation_queue ON lifecycle_message_outbox; DROP FUNCTION reject_automation_queue()');}
  });
  it('records real preview counts and historical execution results',async()=>{
    const initial=await ctx(()=>service.getAutomationControls({businessId,now}));assert.equal(initial.rules.birthday.candidates,3);assert.equal(initial.rules.birthday.consented,2);assert.equal(initial.rules.birthday.available_awards,1);
    await generate();const report=await ctx(()=>service.getAutomationControls({businessId,now}));assert.equal(report.rules.birthday.points_committed,40);assert.equal(report.history[0].points,40);assert.equal(report.counts.queued,1);
  });
  it('dispatch is exactly once across workers, respects quiet hours and preserves acceptance facts',async()=>{
    await generate();let calls=0;const fake=async()=>{calls++;await new Promise(r=>setTimeout(r,20));return{ok:true,accepted:true,provider:'fixture'};};
    await dispatch({send:fake,now:()=>new Date('2026-11-11T01:00:00Z')});assert.equal(calls,0);
    await Promise.all([dispatch({send:fake,now:()=>new Date('2026-11-11T15:00:00Z')}),dispatch({send:fake,now:()=>new Date('2026-11-11T15:00:00Z')})]);assert.equal(calls,1);assert.equal((await db.query('SELECT status FROM lifecycle_message_outbox')).rows[0].status,'accepted');
  });
  it('rechecks pause and opt-out at dispatch, while points already granted remain',async()=>{
    await generate();await ctx(()=>service.saveAutomationSettings({businessId,settings:{...settings,birthday_enabled:false}}));let calls=0;await dispatch({send:async()=>{calls++;return send();}});assert.equal(calls,0);assert.equal((await db.query('SELECT status FROM lifecycle_message_outbox')).rows[0].status,'suppressed');assert.equal(Number((await db.query('SELECT sum(points) AS n FROM transactions')).rows[0].n),40);
  });
  it('never automatically resends an ambiguous result or expired processing lease',async()=>{
    await generate();let calls=0;await dispatch({send:async()=>{calls++;throw new Error('response lost');}});await dispatch({send:async()=>{calls++;return send();}});assert.equal(calls,1);assert.equal((await db.query('SELECT status FROM lifecycle_message_outbox')).rows[0].status,'uncertain');
    await db.query(`UPDATE lifecycle_message_outbox SET status='processing',lease_until=$1,claim_token=$2`,[new Date(now.getTime()-60000),randomUUID()]);await dispatch({send:async()=>{calls++;return send();}});assert.equal(calls,1);assert.equal((await db.query('SELECT status FROM lifecycle_message_outbox')).rows[0].status,'uncertain');
  });
  it('retries definite failures at most three times and never calls simulation accepted',async()=>{
    await generate();let calls=0;const rejected=async()=>{calls++;return{ok:false,error:'NO_DELIVERY_PROVIDER'};};
    for(const minutes of [0,5,15,60]) await dispatch({send:rejected,now:()=>new Date(now.getTime()+minutes*60000)});assert.equal(calls,3);
    await db.query(`UPDATE lifecycle_message_outbox SET status='queued',attempts=0,next_attempt_at=$1`,[now]);await dispatch({send:async()=>({ok:true,accepted:false,simulated:true,provider:'dev'})});assert.equal((await db.query('SELECT status FROM lifecycle_message_outbox')).rows[0].status,'suppressed');
  });
  it('opt-out suppresses queued work and expired messages never dispatch',async()=>{
    await generate();const row=(await db.query('SELECT customer_id FROM lifecycle_message_outbox')).rows[0];
    await ctx(()=>prefs.setMarketingPreference({businessId,customerId:row.customer_id,marketing_opt_in:false}));
    assert.equal((await db.query('SELECT status FROM lifecycle_message_outbox')).rows[0].status,'suppressed');
    await db.query("UPDATE lifecycle_message_outbox SET status='queued'; UPDATE customer_marketing_preferences SET marketing_opt_in=true");
    await dispatch({now:()=>new Date(now.getTime()+3*86400000),send:async()=>assert.fail('Expired message dispatched')});
    assert.equal((await db.query('SELECT reason FROM lifecycle_message_outbox')).rows[0].reason,'message_expired');
  });
  it('campaign and automation workers share a customer reservation and frequency limit',async()=>{
    await ctx(()=>prefs.setMarketingPreference({businessId,customerId:b,marketing_opt_in:false}));
    await ctx(()=>service.saveAutomationSettings({businessId,settings:{...settings,minimum_contact_days:14}}));
    await generate();
    const campaign=randomUUID();
    await db.query(`INSERT INTO growth_campaigns(id,business_id,request_id,name,status,bonus_points,minimum_purchase_q,duration_days,holdout_percent,starts_at,expires_at) VALUES($1,$2,$3,'Fixture','active',50,20,30,20,$4,$5)`,[campaign,businessId,randomUUID(),now,new Date(now.getTime()+30*86400000)]);
    await db.query(`INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation) VALUES($1,$2,$3,$4,'treatment')`,[randomUUID(),businessId,campaign,a]);
    await db.query(`INSERT INTO growth_message_outbox(id,business_id,campaign_id,customer_id,next_attempt_at) VALUES($1,$2,$3,$4,$5)`,[randomUUID(),businessId,campaign,a,now]);
    const campaigns=await import('../../src/app/services/campaign-message-service.js');
    let calls=0;const fake=async()=>{calls++;await new Promise(r=>setTimeout(r,20));return send();};
    await Promise.all([dispatch({send:fake}),campaigns.processCampaignMessagesOnce({businessId,now:()=>now,send:fake})]);assert.equal(calls,1);
    await dispatch({send:fake,now:()=>new Date(now.getTime()+8*86400000)});
    await campaigns.processCampaignMessagesOnce({businessId,now:()=>new Date(now.getTime()+8*86400000),send:fake});assert.equal(calls,1);
  });
  it('winback only selects the exact inactivity day and the budget persists across deletion',async()=>{
    await ctx(()=>service.saveAutomationSettings({businessId,settings:{...settings,winback_enabled:true}}));
    await db.query("UPDATE customers SET last_visit_at='2026-10-10T15:00:00Z' WHERE id=$1",[b]);
    await generate({rule:'winback'});const row=(await db.query('SELECT customer_id,rule FROM lifecycle_message_outbox')).rows[0];assert.equal(row.customer_id,a);assert.equal(row.rule,'winback');
    await db.query('DELETE FROM customers WHERE id=$1',[a]);assert.equal((await db.query('SELECT points_committed FROM lifecycle_automation_budgets')).rows[0].points_committed,20);
  });
  it('normalizes legacy non-object lifecycle data and keeps new rules off',async()=>{
    for(const lifecycle of [null,[],true,'legacy']) {
      await db.query('UPDATE businesses SET program_json=$2 WHERE id=$1',[businessId,{lifecycle}]);
      const report=await ctx(()=>service.getAutomationControls({businessId,now}));assert.equal(report.settings.birthday_enabled,false);assert.equal((await generate()).reason,'inactive');
    }
  });
  it('threshold edits cannot award the same inactivity episode twice, including legacy events',async()=>{
    await ctx(()=>prefs.setMarketingPreference({businessId,customerId:b,marketing_opt_in:false}));
    await ctx(()=>service.saveAutomationSettings({businessId,settings:{...settings,winback_enabled:true}}));await generate({rule:'winback'});
    await ctx(()=>service.saveAutomationSettings({businessId,settings:{...settings,winback_enabled:true,winback_days:31}}));
    const tomorrow=new Date(now.getTime()+86400000);await generate({rule:'winback',now:tomorrow});assert.equal((await db.query('SELECT * FROM lifecycle_message_outbox')).rowCount,1);
    await db.query(`UPDATE lifecycle_events SET meta='{}'`);await generate({rule:'winback',now:tomorrow});assert.equal((await db.query('SELECT * FROM lifecycle_message_outbox')).rowCount,1);
    await db.query('UPDATE customers SET last_visit_at=$2 WHERE id=$1',[a,tomorrow]);
    await generate({rule:'winback',now:new Date(tomorrow.getTime()+31*86400000)});assert.equal((await db.query('SELECT * FROM lifecycle_message_outbox')).rowCount,2);
  });
  it('rechecks increased frequency immediately before provider dispatch',async()=>{
    await ctx(()=>prefs.setMarketingPreference({businessId,customerId:b,marketing_opt_in:false}));await generate();
    const eventId=randomUUID(),old=new Date(now.getTime()-20*86400000);
    await db.query(`INSERT INTO lifecycle_events(id,business_id,customer_id,event_type,event_date) VALUES($1,$2,$3,'winback',$4)`,[eventId,businessId,a,old]);
    await db.query(`INSERT INTO lifecycle_message_outbox(id,business_id,customer_id,event_id,rule,points,status,next_attempt_at,expires_at,last_attempt_at,created_at) VALUES($1,$2,$3,$4,'winback',0,'accepted',$5,$6,$5,$5)`,[randomUUID(),businessId,a,eventId,old,now]);
    let reads=0;
    plans.getPlanFeatureOverrides=async()=>{if(++reads===2)await db.query(`UPDATE businesses SET program_json=jsonb_set(program_json,'{lifecycle,minimum_contact_days}','30') WHERE id=$1`,[businessId]);return{};};
    try{await dispatch({send:async()=>assert.fail('Frequency increased after claim')});}finally{plans.getPlanFeatureOverrides=async()=>({});}
    assert.equal((await db.query("SELECT reason FROM lifecycle_message_outbox WHERE rule='birthday'")).rows[0].reason,'frequency_cap');
  });
  it('uses the business timezone for schedules, calendar previews and message delivery',async()=>{
    await db.query(`UPDATE businesses SET program_json=program_json||'{"region":{"country":"US","currency":"USD","timezone":"America/New_York"}}'::jsonb WHERE id=$1`,[businessId]);
    const saved=await ctx(()=>service.saveAutomationSettings({businessId,settings}));
    assert.equal(saved.settings.scheduler_tz,'America/New_York');
    const boundary=await ctx(()=>service.getAutomationControls({businessId,now:new Date('2026-11-01T04:30:00Z')}));
    assert.equal(boundary.date,'2026-11-01');assert.equal(boundary.month,'2026-11-01');assert.equal(boundary.timezone,'America/New_York');
    await generate({now:new Date('2026-11-10T15:00:00Z')});assert.equal((await db.query('SELECT * FROM lifecycle_message_outbox')).rowCount,0);
    await generate({now:new Date('2026-11-10T14:00:00Z')});assert.equal((await db.query('SELECT * FROM lifecycle_message_outbox')).rowCount,1);
    let calls=0;await dispatch({now:()=>new Date('2026-11-10T14:00:00Z'),send:async()=>{calls++;return send();}});assert.equal(calls,1);
  });
  it('uses the regional calendar for winback eligibility and legacy inactivity anchors',async()=>{
    await db.query(`UPDATE businesses SET program_json=program_json||'{"region":{"country":"US","currency":"USD","timezone":"America/New_York"}}'::jsonb WHERE id=$1`,[businessId]);
    await ctx(()=>service.saveAutomationSettings({businessId,settings:{...settings,birthday_enabled:false,winback_enabled:true,scheduler_tz:'America/New_York'}}));
    await db.query("UPDATE customers SET last_visit_at='2026-10-11T04:30:00Z' WHERE business_id=$1",[businessId]);
    const preview=await ctx(()=>service.getAutomationControls({businessId,now}));assert.equal(preview.rules.winback.consented,2);
    await db.query(`INSERT INTO lifecycle_events(id,business_id,customer_id,event_type,event_date) VALUES($1,$2,$3,'winback','2026-10-11')`,[randomUUID(),businessId,a]);
    await ctx(()=>service.runAutomationRule({businessId,rule:'winback',now:new Date('2026-11-10T14:00:00Z')}));
    assert.deepEqual((await db.query('SELECT customer_id FROM lifecycle_message_outbox')).rows.map(row=>row.customer_id),[b]);
  });
  it('bounds tenant visibility through FORCE RLS',async()=>{
    await generate();await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='automation_rls') THEN CREATE ROLE automation_rls NOLOGIN; END IF; END $$; GRANT USAGE ON SCHEMA public,app TO automation_rls; GRANT SELECT,INSERT,UPDATE ON lifecycle_message_outbox,lifecycle_automation_budgets TO automation_rls`);
    const client=await db.connect();try {await client.query('BEGIN; SET LOCAL ROLE automation_rls');await client.query("SELECT set_config('app.current_tenant',$1,true)",[otherBusiness]);assert.equal((await client.query('SELECT * FROM lifecycle_message_outbox')).rowCount,0);assert.equal((await client.query('SELECT * FROM lifecycle_automation_budgets')).rowCount,0);await client.query('ROLLBACK');}finally{client.release();}
  });
});
