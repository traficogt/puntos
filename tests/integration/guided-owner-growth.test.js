import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,beforeEach,after,describe,it} from 'node:test';
import pg from 'pg';
const url=process.env.GUIDED_OWNER_GROWTH_TEST_DB_URL, suite=url?describe:describe.skip;
const businessId=randomUUID(),otherBusiness=randomUUID(),staffId=randomUUID();
let db,second,weekly,targeted,deps,customers,database;
const now=new Date('2026-11-11T16:00:00Z');
const read=async path=>{
 // Fixed repository migrations in this isolated fixture.
 // eslint-disable-next-line security/detect-non-literal-fs-filename
 return readFile(new URL(path,import.meta.url),'utf8');
};
suite('second visit and weekly owner brief on isolated PostgreSQL',()=>{
 before(async()=>{
  const p=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(p.hostname));assert.ok(['/guided_owner_growth_test','/activation_brief_test'].includes(p.pathname));
  Object.assign(process.env,{NODE_ENV:'test',DB_HOST:p.hostname,DB_PORT:p.port,DB_NAME:p.pathname.slice(1),DB_USER:decodeURIComponent(p.username),DB_PASSWORD:decodeURIComponent(p.password),DB_PASSWORD_FILE:'',DB_MIGRATIONS_PASSWORD_FILE:'',JWT_SECRET_FILE:'',JWT_SECRET:'fixture-guided-growth-secret-12345678'});
  db=new pg.Pool({connectionString:url});await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS app');
  await db.query(`CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_tenant',true),'')::uuid $$; CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.platform_admin',true),'')='true' $$`);
  for(const p of ['../../src/app/schema.sql','../../src/app/schema-extensions.sql','../../src/app/migrations/2026-11-10-customer-recovery.sql','../../src/app/migrations/2026-11-10-growth-campaigns.sql','../../src/app/migrations/2026-11-10-growth-limits.sql','../../src/app/migrations/2026-11-10-reusable-audiences.sql','../../src/app/migrations/2026-11-10-growth-messaging.sql','../../src/app/migrations/2026-11-10-automation-controls.sql','../../src/app/migrations/2026-11-10-reward-economics.sql','../../src/app/migrations/2026-11-11-campaign-expansion.sql'])await db.query(await read(p));
  let migration='';try{migration=await read('../../src/app/migrations/2026-11-11-guided-owner-growth.sql');}catch{/* missing feature */}
  assert.ok(migration,'Second visit and owner brief durable schema must exist');await db.query(migration);await db.query(await read('../../src/app/migrations/2026-11-11-owner-email-brief.sql'));
  database=await import('../../src/app/database.js');
  second=await import('../../src/app/services/second-visit-service.js');weekly=await import('../../src/app/services/weekly-owner-brief-service.js');targeted=await import('../../src/app/services/targeted-offer-service.js');
  deps={getOwnerOutcomeEvidence:async()=>null,query:db.query.bind(db),audit:async()=>{},getPlanFeatureOverrides:async()=>({}),runInTenant:async(_id,fn)=>fn(),listBusinessIds:async()=>[businessId],providerReady:()=>true,
   transaction:async fn=>{const c=await db.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 });
 after(async()=>{await database?.closeDatabase();await db?.end();});
 beforeEach(async()=>{
  customers=Array.from({length:5},()=>randomUUID());await db.query('TRUNCATE businesses CASCADE');
  await db.query("INSERT INTO businesses(id,name,slug,email,password_hash,plan) VALUES($1,'Cafe','one','one@example.invalid','unused','NEGOCIO'),($2,'Other','two','two@example.invalid','unused','NEGOCIO')",[businessId,otherBusiness]);
  await db.query("INSERT INTO staff_users(id,business_id,name,email,phone,role,password_hash) VALUES($1,$2,'Owner','owner@example.invalid','+50255550000','OWNER','unused')",[staffId,businessId]);
  for(const [i,id] of customers.entries())await db.query("INSERT INTO customers(id,business_id,name,phone) VALUES($1,$2,'Member',$3)",[id,businessId,`+5025555000${i+1}`]);
 });
 const settings={enabled:true,bonus_points:50,minimum_purchase_q:10,duration_days:7,monthly_points_cap:100,monthly_offer_cap:2};
 const save=patch=>second.saveSecondVisitSettings({businessId,staffId,settings:{...settings,...patch},now:new Date(now.getTime()-3600000)},deps);
 const purchase=async(customerId,patch={})=>{const id=randomUUID();await db.query("INSERT INTO transactions(id,business_id,customer_id,amount_q,points,status,source,type,created_at) VALUES($1,$2,$3,20,10,$4,$5,$6,$7)",[id,businessId,customerId,patch.status??'POSTED',patch.source??'online',patch.type??'PURCHASE',patch.at??now]);return id;};
 const run=()=>second.runSecondVisitAutomationsOnce({businessId,now},deps);
 it('starts disabled, rejects unsafe terms, and excludes opening balances, pending and already-returned customers',async()=>{
  assert.equal((await second.getSecondVisitControls({businessId,now},deps)).settings.enabled,false);
  await assert.rejects(save({duration_days:15}),{statusCode:400});await assert.rejects(save({monthly_points_cap:10}),{statusCode:400});await save();
  await purchase(customers[0]);await purchase(customers[1],{type:'OPENING_BALANCE',source:'migration'});await purchase(customers[2],{status:'PENDING'});await purchase(customers[3]);await purchase(customers[3]);
  await run();assert.equal((await db.query('SELECT * FROM second_visit_enrollments')).rowCount,1);
  assert.equal((await db.query('SELECT * FROM growth_message_outbox')).rowCount,0,'no consent means no invitation');
 });
 it('concurrent generation caps offers and reserves gross monthly budget without immediate points',async()=>{
  await save();for(const id of customers)await purchase(id);
  await Promise.all([run(),run(),run()]);const rows=(await db.query('SELECT * FROM second_visit_enrollments')).rows;
  assert.equal(rows.length,2);assert.equal((await db.query('SELECT points_committed FROM second_visit_budgets')).rows[0].points_committed,100);
  assert.equal((await db.query('SELECT * FROM transactions')).rowCount,5);
  await db.query("UPDATE transactions SET status='REVERSED'");await run();assert.equal((await db.query('SELECT points_committed FROM second_visit_budgets')).rows[0].points_committed,100);
 });
 it('grants on a qualifying second purchase once and excludes a reversed source or a missed second visit',async()=>{
  await save();await purchase(customers[0]);const reversed=await purchase(customers[1]);await run();
  await db.query("UPDATE transactions SET status='REVERSED' WHERE id=$1",[reversed]);
  // The true DB clock is used at claim; fixture validity covers it without changing source terms.
  await db.query('ALTER TABLE growth_campaigns DISABLE TRIGGER growth_campaigns_terms_guard');await db.query("UPDATE growth_campaigns SET starts_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()+interval '1 day'");await db.query('ALTER TABLE growth_campaigns ENABLE TRIGGER growth_campaigns_terms_guard');
  const award=customerId=>deps.transaction(async client=>{const id=randomUUID(),business=(await client.query('SELECT * FROM businesses WHERE id=$1',[businessId])).rows[0];const bonus=await targeted.claimTargetedOffer({client,business,customerId,transactionId:id,source:'online',amountQ:20,basePoints:10,planFeatureOverrides:{}});await client.query('INSERT INTO transactions(id,business_id,customer_id,amount_q,points) VALUES($1,$2,$3,20,$4)',[id,businessId,customerId,10+bonus.bonusPoints]);return bonus;});
  assert.equal((await award(customers[0])).bonusPoints,50);assert.equal((await award(customers[0])).bonusPoints,0);assert.equal((await award(customers[1])).bonusPoints,0);
  const report=await second.getSecondVisitControls({businessId,now:new Date(now.getTime()+3600000)},deps);assert.equal(report.results.offers_created,2);assert.equal(report.results.bonuses_claimed,1);
 });
 it('queues only consented invitations, pauses stale data, and preserves existing offers when settings pause',async()=>{
  await save();await purchase(customers[0]);await db.query('INSERT INTO customer_marketing_preferences(business_id,customer_id,marketing_opt_in) VALUES($1,$2,true)',[businessId,customers[0]]);
  await db.query(`UPDATE businesses SET program_json=program_json||'{"pos_integration":{"mode":"loyverse","automatic":true,"enabled":true}}' WHERE id=$1`,[businessId]);await run();assert.equal((await db.query('SELECT * FROM second_visit_enrollments')).rowCount,0);
  await db.query("UPDATE businesses SET program_json=program_json-'pos_integration' WHERE id=$1",[businessId]);await run();assert.equal((await db.query('SELECT * FROM growth_message_outbox')).rowCount,1);
  await save({enabled:false});assert.equal((await db.query('SELECT status FROM growth_campaigns')).rows[0].status,'active');assert.equal((await db.query('SELECT status FROM growth_message_outbox')).rows[0].status,'suppressed');
 });
 it('suppresses an in-flight second-visit invitation after an owner pauses the rule',async()=>{
  await save();await purchase(customers[0]);await db.query('INSERT INTO customer_marketing_preferences(business_id,customer_id,marketing_opt_in) VALUES($1,$2,true)',[businessId,customers[0]]);await run();
  const {PlanConfigService}=await import('../../src/app/services/plan-config-service.js'),original=PlanConfigService.getPlanFeatureOverrides;
  const {processCampaignMessagesOnce}=await import('../../src/app/services/campaign-message-service.js');let reads=0,sends=0;
  PlanConfigService.getPlanFeatureOverrides=async()=>{if(++reads===2)await save({enabled:false});return{};};
  try{await processCampaignMessagesOnce({businessId,now:()=>now,send:async()=>{sends++;return{ok:true,accepted:true,provider:'fixture',id:randomUUID(),providerId:'fixture-reference',simulated:false};}});assert.equal(sends,0);assert.equal((await db.query('SELECT status FROM growth_message_outbox')).rows[0].status,'suppressed');}
  finally{PlanConfigService.getPlanFeatureOverrides=original;}
 });
 it('rolls back enrollment and budget on queue persistence failure',async()=>{
  await save();await purchase(customers[0]);await db.query('INSERT INTO customer_marketing_preferences(business_id,customer_id,marketing_opt_in) VALUES($1,$2,true)',[businessId,customers[0]]);
  await db.query("CREATE FUNCTION fail_growth_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER fail_queue BEFORE INSERT ON growth_message_outbox FOR EACH ROW EXECUTE FUNCTION fail_growth_queue()");
  try{await run();assert.equal((await db.query('SELECT * FROM second_visit_enrollments')).rowCount,0);assert.equal((await db.query('SELECT * FROM second_visit_budgets')).rowCount,0);}finally{await db.query('DROP TRIGGER fail_queue ON growth_message_outbox; DROP FUNCTION fail_growth_queue()');}
 });
 const briefSettings={enabled:true,weekday:3,hour:10};
 const saveBrief=async patch=>{
  // Preserve the existing phone-subscription regression fixture after email became the new-account default.
  await db.query("UPDATE businesses SET program_json=jsonb_set(program_json,'{weekly_owner_brief}',$2) WHERE id=$1 AND NOT(program_json?'weekly_owner_brief')",[businessId,{owner_id:staffId,channel:'phone'}]);
  return weekly.saveWeeklyBriefSettings({businessId,staffId,settings:{...briefSettings,...patch},now},deps);
 };
 it('prepares exactly three honest findings without sending and binds destination to the authenticated owner',async()=>{
  const initial=await weekly.getWeeklyBriefControls({businessId,staffId,now},deps);assert.equal(initial.settings.enabled,false);
  const sample=await weekly.previewWeeklyOwnerBrief({businessId,staffId,now},deps);assert.equal(sample.findings.length,3);assert.ok(sample.findings.every(f=>f.evidence&&f.href.includes('/negocio/#')));assert.equal((await db.query('SELECT * FROM weekly_owner_briefs')).rowCount,0);
  await assert.rejects(saveBrief({recipient:'+50259999999'}),{statusCode:400});await saveBrief();
  const row=(await db.query('SELECT program_json FROM businesses WHERE id=$1',[businessId])).rows[0];assert.equal(row.program_json.weekly_owner_brief.owner_id,staffId);
  await db.query("UPDATE staff_users SET role='CASHIER' WHERE id=$1",[staffId]);await assert.rejects(saveBrief(),{statusCode:403});
 });
 it('uses local weekly boundaries through DST and does not duplicate a repeated local hour',()=>{
  const b={program_json:{region:{country:'US',currency:'USD',timezone:'America/New_York'}}},settings={enabled:true,weekday:7,hour:1};
  const a=weekly.weeklyBriefPeriod(new Date('2026-11-01T05:30:00Z'),b,settings),r=weekly.weeklyBriefPeriod(new Date('2026-11-01T06:30:00Z'),b,settings);
  assert.equal(a.period_start,'2026-10-26');assert.equal(r.period_start,a.period_start);assert.equal(a.due,true);assert.equal(r.due,true);
 });
 it('waits for the next scheduled week when enabled after this week’s chosen time',async()=>{
  await saveBrief({weekday:1});let calls=0;
  await weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now,send:async()=>{calls++;return{ok:true,accepted:true,provider:'fixture'};}},deps);
  assert.equal(calls,0);assert.equal((await db.query('SELECT * FROM weekly_owner_briefs')).rowCount,0);
 });
 it('dispatches a due report once across workers and never sends a preview',async()=>{
  await saveBrief();let sends=0;const send=async()=>{sends++;await new Promise(r=>setTimeout(r,20));return{ok:true,accepted:true,provider:'fixture'};};
  await Promise.all([weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now,send},deps),weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now,send},deps)]);
  assert.equal(sends,1);const rows=(await db.query('SELECT * FROM weekly_owner_briefs')).rows;assert.equal(rows.length,1);assert.equal(rows[0].status,'accepted');assert.equal(rows[0].snapshot.findings.length,3);
 });
 it('does not resend lost acknowledgements or expired dispatch leases and rechecks owner destination',async()=>{
  await saveBrief();let sends=0;const send=async()=>{sends++;throw Error('lost acknowledgement');};
  await weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now,send},deps);await weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now,send},deps);assert.equal(sends,1);assert.equal((await db.query('SELECT status FROM weekly_owner_briefs')).rows[0].status,'uncertain');
  await db.query("UPDATE weekly_owner_briefs SET status='processing',lease_until=$1,claim_token=$2",[new Date(now.getTime()-1),randomUUID()]);await weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now,send},deps);assert.equal(sends,1);
  await db.query("UPDATE weekly_owner_briefs SET status='queued',next_attempt_at=$1",[now]);await db.query("UPDATE staff_users SET phone='+50251111111' WHERE id=$1",[staffId]);await weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now,send},deps);assert.equal(sends,1);assert.equal((await db.query('SELECT status FROM weekly_owner_briefs')).rows[0].status,'suppressed');
 });
 it('bounds definite failure retries, cancels queued reports on pause and enforces tenant RLS',async()=>{
  await saveBrief();let sends=0;const send=async()=>{sends++;return{ok:false,definiteFailure:true};};
  for(const minutes of [0,5,15,60])await weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>new Date(now.getTime()+minutes*60000),send},deps);assert.equal(sends,3);
  await saveBrief({enabled:false});assert.equal((await db.query('SELECT status FROM weekly_owner_briefs')).rows[0].status,'suppressed');
  await assert.rejects(weekly.getWeeklyBriefControls({businessId:otherBusiness,staffId,now},deps),{statusCode:403});
  await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='guided_growth_reader') THEN CREATE ROLE guided_growth_reader; END IF; END $$; GRANT USAGE ON SCHEMA public,app TO guided_growth_reader; GRANT SELECT ON second_visit_enrollments,second_visit_budgets,weekly_owner_briefs TO guided_growth_reader`);
  const c=await db.connect();try{await c.query('SET ROLE guided_growth_reader');assert.equal((await c.query('SELECT * FROM weekly_owner_briefs')).rowCount,0);await c.query("SELECT set_config('app.current_tenant',$1,false)",[otherBusiness]);assert.equal((await c.query('SELECT * FROM weekly_owner_briefs')).rowCount,0);}finally{await c.query('RESET ROLE');await c.query("SELECT set_config('app.current_tenant','',false)");c.release();}
 });
});
