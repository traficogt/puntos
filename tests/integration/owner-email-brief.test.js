import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,beforeEach,after,describe,it} from 'node:test';
import pg from 'pg';
const url=process.env.OWNER_EMAIL_BRIEF_TEST_DB_URL,suite=url?describe:describe.skip;
const businessId=randomUUID(),staffId=randomUUID(),otherBusiness=randomUUID();
let db,weekly,second,database,deps,sent;
const now=new Date('2026-11-11T16:00:00Z');
suite('verified owner email briefs on disposable PostgreSQL',()=>{
 before(async()=>{
  const u=new URL(url);assert.ok(['localhost','127.0.0.1'].includes(u.hostname));assert.equal(u.pathname,'/activation_brief_test');
  Object.assign(process.env,{NODE_ENV:'test',DB_HOST:u.hostname,DB_PORT:u.port,DB_NAME:'activation_brief_test',DB_USER:decodeURIComponent(u.username),DB_PASSWORD:decodeURIComponent(u.password),DB_PASSWORD_FILE:'',DB_MIGRATIONS_PASSWORD_FILE:'',JWT_SECRET_FILE:'',JWT_SECRET:'fixture-owner-email-secret-12345678'});
  db=new pg.Pool({connectionString:url});await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS app');
  await db.query(`CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_tenant',true),'')::uuid $$; CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.platform_admin',true),'')='true' $$`);
  const files=['schema.sql','schema-extensions.sql',...['2026-11-10-customer-recovery','2026-11-10-growth-campaigns','2026-11-10-growth-limits','2026-11-10-reusable-audiences','2026-11-10-growth-messaging','2026-11-10-automation-controls','2026-11-10-reward-economics','2026-11-11-campaign-expansion','2026-11-11-guided-owner-growth','2026-11-11-owner-email-brief'].map(x=>`migrations/${x}.sql`)];
  for(const file of files){ // Fixed isolated fixture migrations, never production.
   // eslint-disable-next-line security/detect-non-literal-fs-filename
   await db.query(await readFile(new URL(`../../src/app/${file}`,import.meta.url),'utf8'));
  }
  // Fixed repository migration, replayed against this isolated fixture only.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await db.query(await readFile(new URL('../../src/app/migrations/2026-11-11-owner-email-brief.sql',import.meta.url),'utf8')); // Replay must preserve legacy data contracts.
  database=await import('../../src/app/database.js');weekly=await import('../../src/app/services/weekly-owner-brief-service.js');second=await import('../../src/app/services/second-visit-service.js');
  deps={query:db.query.bind(db),audit:async()=>{},getOwnerOutcomeEvidence:async()=>null,getPlanFeatureOverrides:async()=>({}),runInTenant:async(_id,fn)=>fn(),providerReady:()=>true,emailProviderReady:()=>true,
   sendEmail:async input=>{sent.push(input);return{ok:true,accepted:true,provider:'fixture'};},transaction:async fn=>{const c=await db.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 });
 after(async()=>{await database?.closeDatabase();await db?.end();});
 beforeEach(async()=>{sent=[];await db.query('TRUNCATE businesses CASCADE');await db.query("INSERT INTO businesses(id,name,slug,email,password_hash,plan) VALUES($1,'Café','one','one@example.invalid','unused','NEGOCIO'),($2,'Other','two','two@example.invalid','unused','NEGOCIO')",[businessId,otherBusiness]);await db.query("INSERT INTO staff_users(id,business_id,name,email,phone,role,password_hash) VALUES($1,$2,'Owner','owner@example.invalid','+50255550000','OWNER','unused')",[staffId,businessId]);});
 const actor=()=>({businessId,staffId,now});
 const save=patch=>weekly.saveWeeklyBriefSettings({...actor(),settings:{enabled:true,weekday:3,hour:10,...patch}},deps);
 const verify=async()=>{const requestId=randomUUID();await weekly.requestOwnerBriefEmailVerification({...actor(),requestId},deps);const token=sent.at(-1).body.match(/Código: ([A-Za-z0-9_-]+)/)[1];await weekly.confirmOwnerBriefEmailVerification({...actor(),requestId,token},deps);return{requestId,token};};
 it('keeps expired purchases in weekly activity, excludes reversals and previews without sending',async()=>{
  const customerId=randomUUID();await db.query("INSERT INTO customers(id,business_id,name,phone) VALUES($1,$2,'Member','+50255550101')",[customerId,businessId]);
  for(const status of ['POSTED','EXPIRED','PENDING','REVERSED'])await db.query("INSERT INTO transactions(id,business_id,customer_id,amount_q,points,status,source,type,created_at) VALUES($1,$2,$3,20,10,$4,'online','PURCHASE',$5)",[randomUUID(),businessId,customerId,status,new Date(now.getTime()-1000)]);
  const preview=await weekly.previewWeeklyOwnerBrief(actor(),deps),activity=preview.findings.find(f=>f.key==='recorded_activity');
  assert.equal(activity.evidence.posted_purchases,2);assert.equal(activity.evidence.pending_purchases,1);assert.match(activity.text,/puntos pendientes/);assert.equal(sent.length,0);assert.equal((await db.query('SELECT * FROM weekly_owner_briefs')).rowCount,0);
 });
 it('selects three outcome actions and delivers the immutable snapshot through the fake email provider',async()=>{
  const outcomes={as_of:now.toISOString(),region:{currency:'USD',locale:'es-SV',timezone:'America/El_Salvador'},period:{days:30,start:'2026-10-12T16:00:00Z',end:now.toISOString()},costs:{active:4,missing:1},hospitality:{total:8,fulfilled:5,expired_unused:3,reserved_unused:15},returns:{cohort:{start:'2026-08-14T06:00:00Z',end:now.toISOString()},completed:{customers:10,returned_customers:4},ongoing:{customers:5}}};
  const enriched={...deps,getOwnerOutcomeEvidence:async()=>outcomes};
  const preview=await weekly.previewWeeklyOwnerBrief(actor(),enriched);
  assert.deepEqual(preview.findings.map(f=>f.key),['operation-economics','hospitality-unused','redemption-follow-up']);assert.equal(preview.additional_count,0);assert.equal(sent.length,0);
  assert.match(preview.findings[2].href,/\/negocio\/\?ver=visitas-tras-canje#resumen$/);
  await verify();sent=[];await weekly.requestWeeklyOwnerBriefTest({...actor(),requestId:randomUUID()},enriched);
  outcomes.hospitality.expired_unused=7;
  await weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now},enriched);
  assert.equal(sent.length,1);assert.match(sent[0].body,/Preparado:/);assert.match(sent[0].body,/Período:/);assert.match(sent[0].body,/Todas las sucursales/);assert.ok(sent[0].body.includes(new Intl.DateTimeFormat('es-GT',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Guatemala'}).format(now)));assert.match(sent[0].body,/3 de 8 cortesías/);assert.doesNotMatch(sent[0].body,/7 de 8 cortesías/);assert.equal((await weekly.getWeeklyBriefControls(actor(),deps)).settings.enabled,false);
 });
 it('prioritizes stale data and delivery issues, suppresses return conclusions and links remaining observations',async()=>{
  await db.query('UPDATE businesses SET program_json=$2 WHERE id=$1',[businessId,{pos_integration:{mode:'loyverse',automatic:true,enabled:true}}]);
  /** @type {{includeReturns:boolean}|undefined} */
  let requested;
  const custom={...deps,getOwnerOutcomeEvidence:async options=>{requested=options;return{as_of:now.toISOString(),period:{start:'2026-10-12T16:00:00Z',end:now.toISOString()},costs:{active:1,missing:1},hospitality:{total:3,expired_unused:3,reserved_unused:15}};},query:async(sql,args)=>sql.includes('AS messages_needing_review')?{rows:[{posted_purchases:1,pending_purchases:0,second_visit_offers:0,second_visit_claims:0,messages_needing_review:2}]}:deps.query(sql,args)};
  const preview=await weekly.previewWeeklyOwnerBrief(actor(),custom);
  assert.ok(requested);assert.equal(requested.includeReturns,false);assert.deepEqual(preview.findings.map(f=>f.key),['data_quality','delivery_quality','operation-economics']);assert.equal(preview.additional_count,1);assert.match(preview.inbox_href,/\/negocio\/#decisiones$/);
 });
 it('starts email off, requires verification, exposes configuration without claiming delivery',async()=>{
  const data=await weekly.getWeeklyBriefControls(actor(),deps);assert.equal(data.channel,'email');assert.equal(data.settings.enabled,false);assert.equal(data.email_verified,false);
  await assert.rejects(save(),{statusCode:400});assert.equal(sent.length,0);
  await verify();await save();const stored=(await db.query('SELECT program_json FROM businesses WHERE id=$1',[businessId])).rows[0].program_json.weekly_owner_brief;
  assert.equal(stored.destination,'owner@example.invalid');assert.equal(stored.channel,'email');assert.equal(stored.owner_id,staffId);
  assert.equal((await weekly.getWeeklyBriefControls(actor(),deps)).email_verified,true);
 });
 it('binds a single-use challenge to owner, email and tenant and persists failed attempt limits',async()=>{
  const requestId=randomUUID();await weekly.requestOwnerBriefEmailVerification({...actor(),requestId},deps);const token=sent[0].body.match(/Código: ([A-Za-z0-9_-]+)/)[1];
  await assert.rejects(weekly.confirmOwnerBriefEmailVerification({...actor(),businessId:otherBusiness,requestId,token},deps),{statusCode:403});
  for(let i=0;i<5;i++)await assert.rejects(weekly.confirmOwnerBriefEmailVerification({...actor(),requestId,token:'x'.repeat(43)},deps),{statusCode:400});
  await assert.rejects(weekly.confirmOwnerBriefEmailVerification({...actor(),requestId,token},deps),{statusCode:400});
  const good=await verify();await assert.rejects(weekly.confirmOwnerBriefEmailVerification({...actor(),...good},deps),{statusCode:400});
  await db.query("UPDATE staff_users SET email='new@example.invalid' WHERE id=$1",[staffId]);assert.equal((await weekly.getWeeklyBriefControls(actor(),deps)).email_verified,false);
 });
 it('durably deduplicates verification requests and limits deliberate resends',async()=>{
  const requestId=randomUUID();await Promise.all([weekly.requestOwnerBriefEmailVerification({...actor(),requestId},deps),weekly.requestOwnerBriefEmailVerification({...actor(),requestId},deps)]);assert.equal(sent.length,1);
  for(let i=0;i<2;i++)await weekly.requestOwnerBriefEmailVerification({...actor(),requestId:randomUUID()},deps);
  await assert.rejects(weekly.requestOwnerBriefEmailVerification({...actor(),requestId:randomUUID()},deps),{statusCode:409});assert.equal(sent.length,3);
 });
 it('queues explicit test separately from the weekly schedule, deduplicates, bounds, and does not enable it',async()=>{
  await verify();sent=[];const requestId=randomUUID();await Promise.all([weekly.requestWeeklyOwnerBriefTest({...actor(),requestId},deps),weekly.requestWeeklyOwnerBriefTest({...actor(),requestId},deps)]);
  assert.equal((await db.query("SELECT * FROM weekly_owner_briefs WHERE kind='test'")).rowCount,1);assert.equal((await weekly.getWeeklyBriefControls(actor(),deps)).settings.enabled,false);
  await weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now},deps);assert.equal(sent.length,1);assert.equal(sent[0].to,'owner@example.invalid');
  await weekly.requestWeeklyOwnerBriefTest({...actor(),requestId:randomUUID()},deps);
  await assert.rejects(weekly.requestWeeklyOwnerBriefTest({...actor(),requestId:randomUUID()},deps),{statusCode:409});
 });
 it('rechecks owner email and role before dispatch and never retries uncertain SMTP acknowledgements',async()=>{
  await verify();await save();sent=[];await weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now},{...deps,sendEmail:async()=>{sent.push('attempt');throw Error('unknown');}});
  await weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now},deps);assert.equal(sent.length,1);assert.equal((await db.query('SELECT status FROM weekly_owner_briefs')).rows[0].status,'uncertain');
  await weekly.requestWeeklyOwnerBriefTest({...actor(),requestId:randomUUID()},deps);await db.query("UPDATE staff_users SET role='CASHIER' WHERE id=$1",[staffId]);await weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now},deps);assert.equal(sent.length,1);assert.equal((await db.query("SELECT status FROM weekly_owner_briefs WHERE kind='test'")).rows[0].status,'suppressed');
 });
 it('preserves legacy phone delivery and stored rows through the additive migration',async()=>{
  await db.query("UPDATE businesses SET program_json=$2 WHERE id=$1",[businessId,{weekly_owner_brief:{settings:{enabled:true,weekday:3,hour:10},owner_id:staffId,destination:'50255550000',enabled_at:now.toISOString()}}]);
  assert.equal((await weekly.getWeeklyBriefControls(actor(),deps)).channel,'phone');let calls=0;await weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now,send:async input=>{calls++;assert.equal(input.destinations.email,null);return{ok:true,accepted:true};}},deps);assert.equal(calls,1);
 });
 it('reports actual configured reward and explicitly unknown economics for review',async()=>{
  await db.query("UPDATE businesses SET program_json='{}' WHERE id=$1",[businessId]);assert.equal((await second.getSecondVisitControls({businessId,now},deps)).recommendation.settings,null);
  await db.query('UPDATE businesses SET program_json=$2 WHERE id=$1',[businessId,{points_per_q:0.1}]);await db.query("INSERT INTO rewards(id,business_id,name,points_cost) VALUES($1,$2,'Café',80)",[randomUUID(),businessId]);const data=await second.getSecondVisitControls({businessId,now},deps);assert.equal(data.recommendation.settings.bonus_points,8);assert.equal(data.recommendation.estimated_cost,null);
 });
 it('does not contact providers when unconfigured and does not queue a test for unverified email',async()=>{
  await assert.rejects(weekly.requestOwnerBriefEmailVerification({...actor(),requestId:randomUUID()},{...deps,emailProviderReady:()=>false}),{statusCode:409});
  await assert.rejects(weekly.requestWeeklyOwnerBriefTest({...actor(),requestId:randomUUID()},deps),{statusCode:400});assert.equal(sent.length,0);
 });
 it('suppresses queued email after account address change, even if it is later changed back',async()=>{
  await verify();await weekly.requestWeeklyOwnerBriefTest({...actor(),requestId:randomUUID()},deps);sent=[];
  await db.query("UPDATE staff_users SET email='temporary@example.invalid' WHERE id=$1",[staffId]);await db.query("UPDATE staff_users SET email='owner@example.invalid' WHERE id=$1",[staffId]);
  await weekly.processWeeklyOwnerBriefsOnce({businessId,now:()=>now},deps);assert.equal(sent.length,0);assert.equal((await db.query('SELECT status FROM weekly_owner_briefs')).rows[0].status,'suppressed');
 });
 it('retains immutable destinations and protects verification data with tenant isolation',async()=>{
  await verify();await weekly.requestWeeklyOwnerBriefTest({...actor(),requestId:randomUUID()},deps);
  await assert.rejects(db.query("UPDATE weekly_owner_briefs SET destination='other@example.invalid'"),{code:'23514'});
  await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='activation_brief_reader') THEN CREATE ROLE activation_brief_reader; END IF; END $$; GRANT USAGE ON SCHEMA public,app TO activation_brief_reader; GRANT SELECT ON owner_brief_email_verifications,weekly_owner_briefs TO activation_brief_reader`);
  const c=await db.connect();try{await c.query('SET ROLE activation_brief_reader');assert.equal((await c.query('SELECT * FROM owner_brief_email_verifications')).rowCount,0);await c.query("SELECT set_config('app.current_tenant',$1,false)",[otherBusiness]);assert.equal((await c.query('SELECT * FROM owner_brief_email_verifications')).rowCount,0);assert.equal((await c.query('SELECT * FROM weekly_owner_briefs')).rowCount,0);}finally{await c.query('RESET ROLE');await c.query("SELECT set_config('app.current_tenant','',false)");c.release();}
 });

 it('rejects a reviewed bonus that exceeds the actual purchase guard before activation',async()=>{
  await db.query('UPDATE businesses SET program_json=$2 WHERE id=$1',[businessId,{points_per_q:0.1,award_guard:{max_points_per_tx:5}}]);
  await assert.rejects(second.saveSecondVisitSettings({...actor(),settings:{enabled:true,bonus_points:10,minimum_purchase_q:0,duration_days:7,monthly_points_cap:100,monthly_offer_cap:10}},deps),{statusCode:400});
 });

 it('checks the base earning unit at activation and again before creating item or visit offers',async()=>{
  for(const [type,key] of [['ITEM','points_per_item'],['VISIT','points_per_visit']]){
   await db.query('UPDATE businesses SET program_type=$2,program_json=$3 WHERE id=$1',[businessId,type,{[key]:10,award_guard:{max_points_per_tx:12}}]);
   const settings={enabled:true,bonus_points:3,minimum_purchase_q:0,duration_days:7,monthly_points_cap:100,monthly_offer_cap:10};
   await assert.rejects(second.saveSecondVisitSettings({...actor(),settings},deps),{statusCode:400});
   const saved=await second.saveSecondVisitSettings({...actor(),settings:{...settings,bonus_points:2}},deps);assert.equal(saved.settings.enabled,true);
   await db.query("UPDATE businesses SET program_json=jsonb_set(program_json,ARRAY[$2],to_jsonb(12)) WHERE id=$1",[businessId,key]);
   assert.equal((await second.runSecondVisitBusiness({businessId,now},deps)).reason,'bonus_exceeds_purchase_guard');
  }
  await db.query('UPDATE businesses SET program_type=$2,program_json=$3 WHERE id=$1',[businessId,'SPEND',{points_per_q:10,award_guard:{max_points_per_tx:12}}]);
  assert.equal((await second.saveSecondVisitSettings({...actor(),settings:{enabled:true,bonus_points:10,minimum_purchase_q:0,duration_days:7,monthly_points_cap:100,monthly_offer_cap:10}},deps)).settings.enabled,true);
 });

 it('exposes stale weekly recipient binding until the same settings are explicitly saved again',async()=>{
  await verify();await save();assert.equal((await weekly.getWeeklyBriefControls(actor(),deps)).subscription_binding_current,true);
  await db.query("UPDATE staff_users SET email='new-owner@example.invalid' WHERE id=$1",[staffId]);await verify();
  const stale=await weekly.getWeeklyBriefControls(actor(),deps);assert.equal(stale.email_verified,true);assert.equal(stale.subscription_binding_current,false);assert.equal(stale.settings.enabled,true);
  await weekly.requestWeeklyOwnerBriefTest({...actor(),requestId:randomUUID()},deps);assert.equal((await weekly.getWeeklyBriefControls(actor(),deps)).subscription_binding_current,false,'test email does not rebind the weekly subscription');
  await weekly.saveWeeklyBriefSettings({...actor(),settings:stale.settings},deps);
  assert.equal((await weekly.getWeeklyBriefControls(actor(),deps)).subscription_binding_current,true);
  assert.equal((await db.query('SELECT program_json FROM businesses WHERE id=$1',[businessId])).rows[0].program_json.weekly_owner_brief.destination,'new-owner@example.invalid');
 });

 it('preserves the deployed weekly ON CONFLICT insert while allowing multiple null-period test rows',async()=>{
  const legacyInsert=period=>db.query('INSERT INTO weekly_owner_briefs(id,business_id,owner_id,destination,period_start,snapshot,next_attempt_at,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$7) ON CONFLICT(business_id,period_start) DO NOTHING',[randomUUID(),businessId,staffId,'50255550000',period,{legacy:true},now,new Date(now.getTime()+86400000)]);
  assert.equal((await legacyInsert('2026-11-09')).rowCount,1);assert.equal((await legacyInsert('2026-11-09')).rowCount,0);
  await assert.rejects(legacyInsert(null),{code:'23514'});
  await verify();await weekly.requestWeeklyOwnerBriefTest({...actor(),requestId:randomUUID()},deps);await weekly.requestWeeklyOwnerBriefTest({...actor(),requestId:randomUUID()},deps);
  const rows=(await db.query("SELECT period_start,snapshot FROM weekly_owner_briefs WHERE business_id=$1 AND kind='test'",[businessId])).rows;
  assert.equal(rows.length,2);assert.ok(rows.every(row=>row.period_start===null));assert.ok(rows.every(row=>row.snapshot.period.until===now.toISOString()));
  assert.equal((await legacyInsert('2026-11-09')).rowCount,0,'new test rows cannot break deployed weekly conflict inference');
 });

});
