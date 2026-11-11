import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';import {before,beforeEach,after,describe,it} from 'node:test';import pg from 'pg';
const url=process.env.DECISIONS_INBOX_TEST_DB_URL,suite=url?describe:describe.skip;
const bid=randomUUID(),other=randomUUID(),sid=randomUUID(),cid=randomUUID();const now=new Date('2026-11-11T18:00:00Z');let db,service,deps;
const operations={sections:[{id:'messaging',title:'Mensajes pendientes',state:'needs_attention',summary:'Hay resultados inciertos.',metrics:[{key:'uncertain',value:1}],reasons:[{code:'uncertain',count:1}],action:{label:'Revisar',href:'#ofertas'}}]};
const inbox=()=>service.getDecisionInbox({businessId:bid},deps);
suite('merchant decisions and operating controls',()=>{
 before(async()=>{
  const parsed=new URL(url);assert.equal(parsed.pathname,'/decisions_inbox_test');assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));db=new pg.Pool({connectionString:url});await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS app');
  await db.query(`CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_tenant',true),'')::uuid $$; CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.platform_admin',true),'')='true' $$`);
  for(const file of ['schema.sql','migrations/2026-11-10-customer-recovery.sql','migrations/2026-11-10-growth-campaigns.sql','migrations/2026-11-10-growth-messaging.sql','migrations/2026-11-10-growth-limits.sql','migrations/2026-11-10-automation-controls.sql','migrations/2026-11-11-merchant-decisions.sql']){
   // Fixed fixture list.
   // eslint-disable-next-line security/detect-non-literal-fs-filename
   await db.query(await readFile(new URL('../../src/app/'+file,import.meta.url),'utf8'));
  }
  await db.query("CREATE TABLE service_cases(id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,status text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())");
  await db.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='decisions_rls_test') THEN CREATE ROLE decisions_rls_test NOLOGIN;END IF;END $$;GRANT USAGE ON SCHEMA public,app TO decisions_rls_test;GRANT SELECT,INSERT,UPDATE ON merchant_decision_reviews TO decisions_rls_test;");
  await db.query('CREATE TABLE service_redemption_restorations(id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,redemption_id uuid,points_restored int,created_at timestamptz);CREATE TABLE redemption_cost_snapshots(redemption_id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,unit_cost_q numeric)');
  await db.query(`CREATE TABLE reward_unit_costs(business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,reward_id uuid,unit_cost_q numeric);
   CREATE TABLE hospitality_entitlements(id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,expires_at timestamptz,unit_cost_limit numeric);
   CREATE TABLE reward_entitlement_fulfillments(id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,hospitality_id uuid UNIQUE);`);
  service=await import('../../src/app/services/merchant-decisions-service.js');deps={getOwnerOutcomeEvidence:async()=>null,query:db.query.bind(db),getOperationsHealth:async()=>structuredClone(operations),getPlanFeatureOverrides:async()=>({}),now:()=>now,transaction:async fn=>{const c=await db.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 });
 after(async()=>db?.end());beforeEach(async()=>{
  await db.query('TRUNCATE businesses CASCADE');await db.query("INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_json) VALUES($1,'Fixture','decisions','fixture@example.test','unused','NEGOCIO','{\"preserved\":true}'),($2,'Other','other','other@example.test','unused','NEGOCIO','{}')",[bid,other]);
  await db.query("INSERT INTO staff_users(id,business_id,name,email,password_hash,role) VALUES($1,$2,'Owner','owner@example.test','unused','OWNER')",[sid,bid]);
  await db.query("INSERT INTO customers(id,business_id,name,phone) VALUES($1,$2,'Fixture','+50255550001')",[cid,bid]);
 });
 it('integrates real outcome evidence into inbox and preserves reviewed state while data is blocked',async()=>{
  const {getOwnerOutcomeEvidence}=await import('../../src/app/services/owner-outcome-service.js');const full={...deps,getOwnerOutcomeEvidence};
  await db.query('UPDATE businesses SET program_json=$2 WHERE id=$1',[bid,{pos_integration:{mode:'loyverse',automatic:true,enabled:true}}]);
  await db.query("INSERT INTO rewards(id,business_id,name,points_cost) VALUES($1,$2,'Reward',100)",[randomUUID(),bid]);
  await db.query("INSERT INTO hospitality_entitlements VALUES($1,$2,'2026-11-10T18:00:00Z',5)",[randomUUID(),bid]);
  const read=()=>service.getDecisionInbox({businessId:bid},full),out=await read();assert.equal(out.data_readiness.state,'blocked');assert.ok(out.decisions.find(x=>x.key==='operation-economics'));assert.equal(out.decisions.some(x=>x.key==='redemption-follow-up'),false);
  const item=out.decisions.find(x=>x.key==='hospitality-unused');assert.equal(item.evidence.expired_unused,1);
  await service.reviewDecision({businessId:bid,staffId:sid,input:{decision_key:item.key,fingerprint:item.fingerprint,version:0,status:'reviewed'}},full);
  assert.equal((await read()).decisions.find(x=>x.key===item.key).review_state,'reviewed');
  await db.query("UPDATE businesses SET plan='EMPRENDEDOR' WHERE id=$1",[bid]);let called=false;await service.getDecisionInbox({businessId:bid},{...full,getOwnerOutcomeEvidence:async()=>{called=true;return null;}});assert.equal(called,false,'analytics entitlement gates expensive outcome reads');
 });
 it('GET is read-only, preserves unknown coverage, and shows open cases',async()=>{
  await db.query("INSERT INTO service_cases(id,business_id,status) VALUES($1,$2,'open'),($3,$4,'open')",[randomUUID(),bid,randomUUID(),other]);const out=await inbox();assert.equal(out.data_readiness.state,'recorded_only');assert.equal(out.decisions.find(x=>x.key==='service-cases').evidence.open,1);assert.equal((await db.query('SELECT * FROM merchant_decision_reviews')).rowCount,0);
 });
 it('snoozes only reviewed evidence and rejects stale versions under concurrency',async()=>{
  const item=(await inbox()).decisions[0],input={decision_key:item.key,fingerprint:item.fingerprint,version:0,status:'snoozed',snooze_hours:1};
  const outcomes=await Promise.allSettled([service.reviewDecision({businessId:bid,staffId:sid,input},deps),service.reviewDecision({businessId:bid,staffId:sid,input},deps)]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(outcomes.find(x=>x.status==='rejected').reason.statusCode,409);
  assert.equal((await inbox()).decisions[0].review_state,'snoozed');const later=await service.getDecisionInbox({businessId:bid},{...deps,now:()=>new Date('2026-11-11T19:00:00Z')});assert.equal(later.decisions[0].review_state,'open');
 });
 it('rejects tampered evidence and rolls back a review if audit persistence fails',async()=>{
  const item=(await inbox()).decisions[0],input={decision_key:item.key,fingerprint:'0'.repeat(64),version:0,status:'reviewed'};await assert.rejects(service.reviewDecision({businessId:bid,staffId:sid,input},deps),{statusCode:409});
  await db.query("CREATE FUNCTION reject_decision_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit';END $$;CREATE TRIGGER reject_decision_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_decision_audit()");
  try{await assert.rejects(service.reviewDecision({businessId:bid,staffId:sid,input:{...input,fingerprint:item.fingerprint}},deps),/fixture audit/);assert.equal((await db.query('SELECT * FROM merchant_decision_reviews')).rowCount,0);}finally{await db.query('DROP TRIGGER reject_decision_audit ON audit_logs;DROP FUNCTION reject_decision_audit()');}
 });
 it('sets an expiring pause with optimistic concurrency and preserves unrelated settings',async()=>{
  const first=await inbox(),input={mode:'busy',minutes:120,version:first.operating_mode.version};const saved=await service.setOperatingMode({businessId:bid,staffId:sid,input},deps);assert.equal(saved.operating_mode.until,'2026-11-11T20:00:00.000Z');
  assert.equal((await db.query('SELECT program_json FROM businesses WHERE id=$1',[bid])).rows[0].program_json.preserved,true);await assert.rejects(service.setOperatingMode({businessId:bid,staffId:sid,input},deps),{statusCode:409});
  const normal=await service.setOperatingMode({businessId:bid,staffId:sid,input:{mode:'normal',version:saved.operating_mode.version}},deps);assert.equal(normal.operating_mode.mode,'normal');
 });
 it('reports overlapping treatment members without contact details or claiming stacking',async()=>{
  const a=randomUUID(),b=randomUUID();for(const [id,name] of [[a,'First'],[b,'Second']]){await db.query("INSERT INTO growth_campaigns(id,business_id,request_id,name,status,bonus_points,minimum_purchase_q,duration_days,holdout_percent,starts_at,expires_at) VALUES($1,$2,$3,$4,'active',10,0,7,20,'2026-11-11T15:00:00Z','2026-11-18T15:00:00Z')",[id,bid,randomUUID(),name]);await db.query("INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation) VALUES($1,$2,$3,$4,'treatment')",[randomUUID(),bid,id,cid]);}
  const out=await inbox();assert.equal(out.collisions.overlapping_pairs,1);assert.equal(out.collisions.pairs[0].shared_customers,1);assert.equal(JSON.stringify(out.collisions).includes('+502'),false);assert.match(out.collisions.note,/no demuestra/);
 });
 it('separates restored points from retained original reward costs and isolates dates and tenants',async()=>{
  const costs=await import('../../src/app/services/reward-commitment-service.js');
  for(const [tenant,points,cost,at] of [[bid,50,7,'2026-11-10T18:00:00Z'],[bid,100,null,'2026-11-10T18:00:00Z'],[other,999,500,'2026-11-10T18:00:00Z'],[bid,999,500,'2026-01-01T18:00:00Z']]){
   const rid=randomUUID();await db.query('INSERT INTO service_redemption_restorations VALUES($1,$2,$3,$4,$5)',[randomUUID(),tenant,rid,points,at]);await db.query('INSERT INTO redemption_cost_snapshots VALUES($1,$2,$3)',[rid,tenant,cost]);
  }
  const result=await costs.getServiceRestorationCosts({businessId:bid,days:30,now},db.query.bind(db));assert.equal(result.restored_redemptions,2);assert.equal(result.restored_points,150);assert.equal(result.known_original_cost_q,7);assert.equal(result.unknown_original_costs,1);assert.equal((await db.query('SELECT count(*)::int AS n FROM redemption_cost_snapshots')).rows[0].n,4);
 });
 it('forced RLS prevents cross-tenant decisions and denies deletion',async()=>{
  const item=(await inbox()).decisions[0];await service.reviewDecision({businessId:bid,staffId:sid,input:{decision_key:item.key,fingerprint:item.fingerprint,version:0,status:'reviewed'}},deps);
  await deps.transaction(async client=>{await client.query('SET LOCAL ROLE decisions_rls_test');await client.query("SELECT set_config('app.current_tenant',$1,true)",[other]);assert.equal((await client.query('SELECT * FROM merchant_decision_reviews')).rowCount,0);await client.query('SAVEPOINT denied');await assert.rejects(client.query('DELETE FROM merchant_decision_reviews'),/permission denied/);await client.query('ROLLBACK TO SAVEPOINT denied');});
 });
});
