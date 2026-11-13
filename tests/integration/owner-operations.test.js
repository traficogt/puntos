import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,beforeEach,after,describe,it} from 'node:test';
import pg from 'pg';
const url=process.env.OWNER_OPERATIONS_TEST_DB_URL,suite=url?describe:describe.skip;
const b=randomUUID(),other=randomUUID(),ownerId=randomUUID(),staffId=randomUUID(),foreignStaff=randomUUID(),customer=randomUUID(),reward=randomUUID();
const owner={id:ownerId,business_id:b,role:'OWNER'},staff={id:staffId,business_id:b,role:'MANAGER'};
let db,decisions,economics,operating,deps;
const operations={sections:[{id:'messaging',state:'needs_attention',title:'Mensajes',summary:'Un envío incierto',metrics:[{value:1}],action:{href:'#ofertas',label:'Revisar'}}]};
suite('complete owner workflows in isolated PostgreSQL',()=>{
 before(async()=>{
  const parsed=new URL(url);assert.equal(parsed.pathname,'/owner_operations_test');assert.ok(['localhost','127.0.0.1'].includes(parsed.hostname));assert.notEqual(parsed.port,'5432');
  db=new pg.Pool({connectionString:url,max:12});await db.query('DROP SCHEMA public CASCADE;CREATE SCHEMA public;CREATE SCHEMA IF NOT EXISTS app');
  await db.query("CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_tenant',true),'')::uuid $$;CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.platform_admin',true),'')='true' $$");
  for(const file of ['schema.sql','migrations/2026-11-10-customer-recovery.sql','migrations/2026-11-10-growth-campaigns.sql','migrations/2026-11-10-growth-limits.sql','migrations/2026-11-10-growth-messaging.sql','migrations/2026-11-10-automation-controls.sql','migrations/2026-11-10-reusable-audiences.sql','migrations/2026-11-10-reward-economics.sql','migrations/2026-11-11-staff-delegation.sql','migrations/2026-11-11-campaign-expansion.sql','migrations/2026-11-11-merchant-decisions.sql','migrations/2026-11-11-reward-promises-hospitality.sql']) {
   // Static fixture paths only.
   // eslint-disable-next-line security/detect-non-literal-fs-filename
   await db.query(await readFile(new URL('../../src/app/'+file,import.meta.url),'utf8'));
  }
  await db.query("CREATE TABLE loyalty_tiers(id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id),name text,points_multiplier numeric,perks jsonb,active boolean,tier_level int)");
  await db.query('CREATE TABLE reward_promise_extensions(business_id uuid,promise_id uuid,extended_until timestamptz)');
  await db.query('CREATE TABLE service_cases(id uuid,business_id uuid,status text,created_at timestamptz,updated_at timestamptz)');
  // Compatibility fixture for the independently migrated delegation extension.
  await db.query(`ALTER TABLE staff_service_grants DROP CONSTRAINT staff_service_grants_action_check;
   ALTER TABLE staff_service_grants ADD COLUMN currency text,ADD COLUMN max_actions int DEFAULT 100000,ADD COLUMN used_actions int DEFAULT 0,ADD COLUMN frequency_limit int DEFAULT 100000,ADD COLUMN frequency_minutes int DEFAULT 1440,ADD COLUMN per_action_cost numeric DEFAULT 0,ADD COLUMN total_cost numeric DEFAULT 0,ADD COLUMN used_cost numeric DEFAULT 0;
   ALTER TABLE staff_service_usage DROP CONSTRAINT staff_service_usage_action_check;ALTER TABLE staff_service_usage DROP CONSTRAINT staff_service_usage_points_check;
   ALTER TABLE staff_service_usage ADD COLUMN currency text,ADD COLUMN cost_amount numeric DEFAULT 0,ADD COLUMN reference_type text,ADD COLUMN reference_id uuid;`);
  // Static migration URL.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const migration=await readFile(new URL('../../src/app/migrations/2026-11-13-owner-operations.sql',import.meta.url),'utf8').catch(()=>null);assert.ok(migration,'owner completion migration must exist');await db.query(migration);
  decisions=await import('../../src/app/services/merchant-decisions-service.js');economics=await import('../../src/app/services/reward-commitment-service.js');operating=await import('../../src/app/services/operating-template-service.js');
  deps={query:db.query.bind(db),getPlanFeatureOverrides:async()=>({}),getOperationsHealth:async()=>operations,getOwnerOutcomeEvidence:async()=>null,now:()=>new Date(),transaction:async fn=>{const c=await db.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 });
 after(async()=>db?.end());
 beforeEach(async()=>{
  await db.query('TRUNCATE businesses CASCADE');await db.query("INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_json) VALUES($1,'Fixture','owner','owner@test.invalid','unused','NEGOCIO','{\"points_per_q\":1}'),($2,'Other','other','other@test.invalid','unused','NEGOCIO','{}')",[b,other]);
  await db.query("INSERT INTO staff_users(id,business_id,name,email,password_hash,role) VALUES($1,$2,'Dueña','boss@test.invalid','unused','OWNER'),($3,$2,'Ana','ana@test.invalid','unused','MANAGER'),($4,$5,'Other','x@test.invalid','unused','MANAGER')",[ownerId,b,staffId,foreignStaff,other]);
  await db.query("INSERT INTO customers(id,business_id,name,phone) VALUES($1,$2,'Member','50255550000')",[customer,b]);await db.query('INSERT INTO customer_balances(customer_id,points) VALUES($1,50)',[customer]);
  await db.query("INSERT INTO rewards(id,business_id,name,points_cost) VALUES($1,$2,'Cafe',100)",[reward,b]);
 });
 const inbox=()=>decisions.getDecisionInbox({businessId:b},deps);
 const review=(item,extra={})=>decisions.reviewDecision({businessId:b,staffId:ownerId,staff:owner,input:{decision_key:item.key,fingerprint:item.fingerprint,version:item.review_version,status:'open',...extra}},deps);
 it('assigns only tenant staff, exposes only assigned decisions, requires dismissal reason and records versioned history',async()=>{
  const item=(await inbox()).decisions[0];await assert.rejects(review(item,{assigned_staff_id:foreignStaff}),{statusCode:400});
  await review(item,{assigned_staff_id:staffId});let assigned=(await decisions.getDelegatedDecisionInbox({businessId:b,staff},deps)).decisions;assert.equal(assigned.length,1);assert.equal(assigned[0].assigned_staff_id,staffId);
  await assert.rejects(review(assigned[0],{status:'dismissed'}),{statusCode:400});
  await decisions.reviewDecision({businessId:b,staffId,staff,delegated:true,input:{decision_key:item.key,fingerprint:item.fingerprint,version:1,status:'dismissed',dismiss_reason:'Proveedor confirmó la entrega'}},deps);
  assert.equal((await inbox()).decisions[0].review_state,'dismissed');const history=await decisions.getDecisionHistory({businessId:b,staff,delegated:true,decisionKey:item.key},deps);assert.equal(history.events.length,2);
  await assert.rejects(decisions.reviewDecision({businessId:b,staffId:foreignStaff,staff:{id:foreignStaff,business_id:other,role:'MANAGER'},delegated:true,input:{decision_key:item.key,fingerprint:item.fingerprint,version:2,status:'open'}},deps),{statusCode:403});
 });
 it('serializes assignment changes and rolls back if immutable history cannot be recorded',async()=>{
  const item=(await inbox()).decisions[0];const results=await Promise.allSettled([review(item,{assigned_staff_id:staffId}),review(item,{status:'reviewed'})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  await db.query("CREATE FUNCTION reject_owner_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'history unavailable';END $$;CREATE TRIGGER reject_owner_history BEFORE INSERT ON merchant_decision_events FOR EACH ROW EXECUTE FUNCTION reject_owner_history()");
  try{await assert.rejects(review((await inbox()).decisions[0],{status:'dismissed',dismiss_reason:'Documentado'}),/history unavailable/);assert.equal((await db.query('SELECT version FROM merchant_decision_reviews')).rows[0].version,1);}finally{await db.query('DROP TRIGGER reject_owner_history ON merchant_decision_events;DROP FUNCTION reject_owner_history()');}
 });
 it('snapshots issue-time retail and fulfillment cost and never fills a historical unknown',async()=>{
  await db.query('INSERT INTO reward_unit_costs(business_id,reward_id,unit_cost_q,retail_value_q) VALUES($1,$2,4,12)',[b,reward]);
  const unknownReward=randomUUID();await db.query("INSERT INTO rewards(id,business_id,name,points_cost) VALUES($1,$2,'Sin costo',50)",[unknownReward,b]);
  await db.query('UPDATE rewards SET points_cost=110 WHERE id=$1',[reward]);
  let report=await economics.getIssuedCommitments({businessId:b},db.query.bind(db));let promise=report.groups.find(x=>x.kind==='protected_reward');assert.equal(promise.units,2);assert.equal(promise.unknown_cost_units,1);assert.equal(promise.known_retail_value,12);assert.equal(promise.known_fulfillment_cost,4);
  await db.query('UPDATE reward_unit_costs SET unit_cost_q=20,retail_value_q=30 WHERE business_id=$1',[b]);report=await economics.getIssuedCommitments({businessId:b},db.query.bind(db));assert.equal(report.groups.find(x=>x.kind==='protected_reward').known_fulfillment_cost,4);
  await db.query('INSERT INTO reward_unit_costs(business_id,reward_id,unit_cost_q,retail_value_q) VALUES($1,$2,9,20)',[b,unknownReward]);
  assert.equal((await economics.getIssuedCommitments({businessId:b},db.query.bind(db))).groups.find(x=>x.kind==='protected_reward').unknown_cost_units,1);
  await assert.rejects(db.query('UPDATE issued_commitment_values SET retail_value=99'),/immutable/);assert.equal(report.points_separate,true);
 });
 async function template(maximumRuns=1,pointsBudget=10){const campaign=randomUUID();await db.query("INSERT INTO growth_campaigns(id,business_id,request_id,name,bonus_points,minimum_purchase_q,duration_days,holdout_percent,offer_kind,duration_minutes,points_budget,estimated_cost_per_point_q) VALUES($1,$2,$3,'Hora tranquila',10,5,NULL,0,'quiet',60,$4,0.1)",[campaign,b,randomUUID(),pointsBudget]);await db.query('INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id) VALUES($1,$2,$3,$4)',[randomUUID(),b,campaign,customer]);return operating.approveOperatingTemplate({businessId:b,staff:owner,input:{request_id:randomUUID(),campaign_id:campaign,maximum_runs:maximumRuns,capacity:1,expires_at:new Date(Date.now()+86400000).toISOString()}},deps);}
 it('activates a fixed approved template once, replays safely and preserves earned offers on busy',async()=>{
  const approved=await template(),requestId=randomUUID();const input={template_id:approved.template.id,version:1,request_id:requestId};
  const activated=await operating.triggerOperatingTemplate({businessId:b,staff:owner,input},deps);assert.equal(activated.campaign.status,'active');assert.equal(activated.operating_mode.mode,'quiet');assert.equal((await operating.triggerOperatingTemplate({businessId:b,staff:owner,input},deps)).replay,true);
  await assert.rejects(operating.triggerOperatingTemplate({businessId:b,staff:owner,input:{...input,version:2,request_id:randomUUID()}},deps),{statusCode:409});
  await decisions.setOperatingMode({businessId:b,staffId:ownerId,staff:owner,input:{mode:'busy',minutes:30,version:activated.operating_mode.version}},deps);
  assert.equal((await db.query('SELECT status FROM growth_campaigns WHERE id=$1',[activated.campaign.id])).rows[0].status,'active');assert.equal((await db.query('SELECT * FROM growth_message_outbox')).rowCount,0);
 });
 it('replays an operating change by request and preserves owner capacity when pausing',async()=>{
  const initial=(await inbox()).operating_mode,request_id=randomUUID(),input={mode:'quiet',minutes:60,capacity:4,version:initial.version,request_id};
  const results=await Promise.all([decisions.setOperatingMode({businessId:b,staffId:ownerId,staff:owner,input},deps),decisions.setOperatingMode({businessId:b,staffId:ownerId,staff:owner,input},deps)]);assert.equal(results.filter(x=>x.replay).length,1);
  const paused=await decisions.setOperatingMode({businessId:b,staffId:ownerId,staff:owner,input:{mode:'busy',minutes:30,version:results[0].operating_mode.version}},deps);assert.equal(paused.operating_mode.capacity,4);
 });
 it('previews contacts, branch availability and tier descriptions without writes',async()=>{
  const approved=await template(),branch=randomUUID(),wrong=randomUUID(),tier=randomUUID();
  await db.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$2,'Centro','test-centro'),($3,$2,'Norte','test-norte')",[branch,b,wrong]);
  await db.query('INSERT INTO reward_branches(reward_id,branch_id) VALUES($1,$2)',[reward,branch]);
  await db.query("INSERT INTO loyalty_tiers VALUES($1,$2,'Oro',1.5,$3,true,1)",[tier,b,JSON.stringify(['Atención prioritaria'])]);
  const service=await import('../../src/app/services/campaign-collision-service.js'),auditCount=(await db.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n;
  const out=await service.previewCampaignCollisions({businessId:b,campaignId:approved.template.source_campaign_id,input:{amount_q:20,branch_id:wrong,reward_id:reward,tier_id:tier}},deps);
  assert.equal(out.sample.program_points,20);assert.equal(out.sample.most_generous_supported_total,30);assert.deepEqual(out.reward_availability.issues,['wrong_branch']);assert.equal(out.tier.applied_to_sample,false);assert.equal(out.sample.external_discounts,'unknown');assert.equal((await db.query('SELECT count(*)::int AS n FROM audit_logs')).rows[0].n,auditCount);
  await assert.rejects(service.previewCampaignCollisions({businessId:other,campaignId:approved.template.source_campaign_id,input:{amount_q:20}},deps),{statusCode:404});
 });
 it('requires explicit global authority for manager templates and consumes cost and count atomically',async()=>{
  const approved=await template(),input={template_id:approved.template.id,version:1,request_id:randomUUID()};
  assert.equal((await operating.listOperatingTemplates({businessId:b,staff,delegated:true},deps)).authorized,false);
  await assert.rejects(operating.triggerOperatingTemplate({businessId:b,staff,input},deps),{statusCode:403});
  const delegation=await import('../../src/app/services/staff-delegation-service.js');
  await delegation.createServiceGrant({businessId:b,staff:owner,staffId,action:'offer_template',perActionPoints:10,totalPoints:10,maxActions:1,perActionCost:1,totalCost:1,startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),requestId:randomUUID()},deps);
  assert.equal((await operating.listOperatingTemplates({businessId:b,staff,delegated:true},deps)).authorized,true);
  const out=await operating.triggerOperatingTemplate({businessId:b,staff,input},deps);assert.equal(out.campaign.status,'active');assert.equal((await operating.triggerOperatingTemplate({businessId:b,staff,input},deps)).replay,true);
  const used=(await db.query('SELECT used_actions,used_points,used_cost FROM staff_service_grants WHERE business_id=$1',[b])).rows[0];assert.equal(used.used_actions,1);assert.equal(used.used_points,10);assert.equal(Number(used.used_cost),1);
 });
 it('caps simultaneous operational bonuses using fixed audience even when the point budget is larger',async()=>{
  const approved=await template(3,100);assert.equal(approved.template.terms.maximum_commitment_points,10);
  await operating.triggerOperatingTemplate({businessId:b,staff:owner,input:{template_id:approved.template.id,version:1,request_id:randomUUID()}},deps);
  await assert.rejects(operating.triggerOperatingTemplate({businessId:b,staff:owner,input:{template_id:approved.template.id,version:2,request_id:randomUUID()}},deps),/capacidad/);
  assert.equal((await db.query('SELECT used_runs FROM operating_offer_templates')).rows[0].used_runs,1);
  const preflights=await import('../../src/app/services/campaign-preflight-service.js'),growth=await import('../../src/app/services/growth-campaign-service.js');
  const preview=await preflights.createCampaignPreflight({businessId:b,campaignId:approved.template.source_campaign_id},deps);assert.equal(preview.preflight.can_activate,false);assert.ok(preview.preflight.blockers.some(item=>item.code==='capacity_exceeded'));
  await assert.rejects(growth.activateGrowthCampaign({businessId:b,staffId:ownerId,campaignId:approved.template.source_campaign_id,preflightId:preview.preflight.id},deps),{statusCode:409});
 });
 it('protects owner-approved audience and financial terms from later changes',async()=>{
  const approved=await template();await assert.rejects(db.query("UPDATE operating_offer_templates SET terms='{}' WHERE id=$1",[approved.template.id]),/immutable/);
  await db.query('UPDATE businesses SET program_json=program_json||$2::jsonb WHERE id=$1',[b,{region:{country:'US',currency:'USD',timezone:'America/New_York'}}]);
  await assert.rejects(operating.triggerOperatingTemplate({businessId:b,staff:owner,input:{template_id:approved.template.id,version:1,request_id:randomUUID()}},deps),{statusCode:409});
 });
 it('rolls back template, allowance and campaign activation if audit persistence fails',async()=>{
  const approved=await template(),before=(await db.query('SELECT count(*)::int AS n FROM growth_campaigns')).rows[0].n;
  await db.query("CREATE FUNCTION reject_owner_activation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='operating.template.triggered' THEN RAISE EXCEPTION 'audit unavailable';END IF;RETURN NEW;END $$;CREATE TRIGGER reject_owner_activation BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_owner_activation()");
  try{await assert.rejects(operating.triggerOperatingTemplate({businessId:b,staff:owner,input:{template_id:approved.template.id,version:1,request_id:randomUUID()}},deps),/audit unavailable/);assert.equal((await db.query('SELECT used_runs FROM operating_offer_templates')).rows[0].used_runs,0);assert.equal((await db.query('SELECT count(*)::int AS n FROM growth_campaigns')).rows[0].n,before);}finally{await db.query('DROP TRIGGER reject_owner_activation ON audit_logs;DROP FUNCTION reject_owner_activation()');}
 });
 it('enforces tenant isolation and immutable history for owner operation tables',async()=>{
  const approved=await template();await review((await inbox()).decisions[0],{assigned_staff_id:staffId});
  await db.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='owner_operation_rls_test') THEN CREATE ROLE owner_operation_rls_test NOLOGIN;END IF;END $$;GRANT USAGE ON SCHEMA public,app TO owner_operation_rls_test;GRANT SELECT ON operating_offer_templates,merchant_decision_events,issued_commitment_values,operating_template_runs,operating_mode_changes TO owner_operation_rls_test");
  await deps.transaction(async client=>{await client.query('SET LOCAL ROLE owner_operation_rls_test');await client.query("SELECT set_config('app.current_tenant',$1,true)",[other]);assert.equal((await client.query('SELECT * FROM operating_offer_templates')).rowCount,0);assert.equal((await client.query('SELECT * FROM merchant_decision_events')).rowCount,0);await client.query("SELECT set_config('app.current_tenant',$1,true)",[b]);assert.equal((await client.query('SELECT id FROM operating_offer_templates')).rows[0].id,approved.template.id);});
  await assert.rejects(db.query("UPDATE merchant_decision_events SET status='reviewed'"),/immutable/);
 });
 it('rejects foreign drafts and concurrent activation above cap',async()=>{
  const approved=await template();const calls=Array.from({length:3},()=>operating.triggerOperatingTemplate({businessId:b,staff:owner,input:{template_id:approved.template.id,version:1,request_id:randomUUID()}},deps));const results=await Promise.allSettled(calls);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  await assert.rejects(operating.approveOperatingTemplate({businessId:other,staff:{id:foreignStaff,business_id:other},input:{request_id:randomUUID(),campaign_id:approved.template.source_campaign_id,maximum_runs:1,capacity:1,expires_at:new Date(Date.now()+86400000).toISOString()}},deps));
 });
});
