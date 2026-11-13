import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,describe,it} from 'node:test';
import pg from 'pg';
import * as authority from '../../src/app/services/staff-delegation-service.js';
import * as completion from '../../src/app/services/service-completion-service.js';
import * as recovery from '../../src/app/services/service-recovery-service.js';
import * as promises from '../../src/app/services/reward-promise-service.js';
import * as migration from '../../src/app/services/customer-migration-service.js';
const url=process.env.SERVICE_COMPLETION_TEST_DB_URL,suite=url?describe:describe.skip;
const b=randomUUID(),other=randomUUID(),o=randomUUID(),s=randomUUID(),branch=randomUUID(),c=randomUUID(),r=randomUUID(),alt=randomUUID();
const owner={id:o,business_id:b,role:'OWNER',branch_id:null},staff={id:s,business_id:b,role:'CASHIER',branch_id:branch};
let pool;async function transaction(fn){const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
const deps={transaction};const grant=(extra={})=>authority.createServiceGrant({requestId:randomUUID(),businessId:b,staff:owner,staffId:s,branchId:null,action:'operating_mode',perActionPoints:1,totalPoints:1,maxActions:2,frequencyLimit:2,frequencyMinutes:60,perActionCost:5,totalCost:8,startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),...extra},deps);
const consume=(extra={})=>transaction(client=>authority.consumeStaffAuthority(client,{merchantId:b,staffId:s,action:'operating_mode',locationId:null,points:0,costAmount:4,referenceType:'operating_mode',referenceId:randomUUID(),...extra}));
suite('completed staff operations with real isolated PostgreSQL',()=>{
 before(async()=>{const parsed=new URL(url);assert.equal(parsed.pathname,'/service_completion_test');assert.ok(['localhost','127.0.0.1'].includes(parsed.hostname));pool=new pg.Pool({connectionString:url,max:12});
 await pool.query("INSERT INTO businesses(id,name,slug,email,password_hash,program_type,program_json) VALUES($1,'Service test',$2,$3,'test','VISIT','{\"points_per_visit\":10}'),($4,'Other service',$5,$6,'test','VISIT','{}')",[b,`service-${b}`,`${b}@example.test`,other,`service-${other}`,`${other}@example.test`]);
 await pool.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$2,'Centro',$3)",[branch,b,branch]);
 await pool.query("INSERT INTO staff_users(id,business_id,branch_id,name,role,password_hash) VALUES($1,$2,NULL,'Owner','OWNER','test'),($3,$2,$4,'Staff','CASHIER','test')",[o,b,s,branch]);
 await pool.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,$3,'Fictional fixture')",[c,b,`502${String(Date.now()).slice(-8)}`]);await pool.query('INSERT INTO customer_balances(customer_id,points) VALUES($1,80) ON CONFLICT(customer_id) DO UPDATE SET points=80',[c]);
 await pool.query("INSERT INTO rewards(id,business_id,name,description,points_cost,stock,valid_until) VALUES($1,$2,'Coffee','One coffee',80,10,clock_timestamp()+interval '1 hour'),($3,$2,'Tea','One tea',80,10,NULL)",[r,b,alt]);
 await pool.query('INSERT INTO reward_unit_costs(business_id,reward_id,unit_cost_q) VALUES($1,$2,4),($1,$3,3)',[b,r,alt]);
 });after(async()=>pool?.end());
 it('enforces operational cost, frequency and total actions atomically and replays once',async()=>{
  assert.equal(typeof authority.consumeStaffAuthority,'function');await grant();const referenceId=randomUUID();const results=await Promise.all([consume({referenceId}),consume({referenceId})]);assert.equal(results[0].usageId,results[1].usageId);await assert.rejects(consume({referenceId,costAmount:3}),{statusCode:409});
  const attempts=await Promise.allSettled([consume(),consume(),consume()]);assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);await assert.rejects(consume(),{statusCode:403});
 });
 it('a branch-specific grant cannot authorize a global operational change',async()=>{await grant({branchId:branch,action:'offer_template'});await assert.rejects(consume({action:'offer_template'}),{statusCode:403});});
 it('requires live owner grants and rolls all usage back if auditing fails',async()=>{
  await assert.rejects(grant({staff}),{statusCode:403});await grant({action:'extend_promise'});
  await pool.query("CREATE OR REPLACE FUNCTION service_completion_test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.business_id='"+b+"' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER service_completion_test_audit_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION service_completion_test_audit_fail()");
  try{await assert.rejects(consume({action:'extend_promise'}),/audit unavailable/);}finally{await pool.query('DROP TRIGGER service_completion_test_audit_fail ON audit_logs; DROP FUNCTION service_completion_test_audit_fail()');}
  assert.equal((await pool.query("SELECT count(*)::int n FROM staff_service_usage WHERE business_id=$1 AND action='extend_promise'",[b])).rows[0].n,0);
 });
 it('retains six decimal cost precision and never rounds a charge down to fit a grant',async()=>{
  await grant({action:'fulfill_promise',maxActions:1,perActionCost:1.123456,totalCost:1.123456});await assert.rejects(consume({action:'fulfill_promise',costAmount:1.123457}),{statusCode:403});
  await consume({action:'fulfill_promise',costAmount:1.123456});assert.equal((await pool.query("SELECT used_cost FROM staff_service_grants WHERE business_id=$1 AND action='fulfill_promise' ORDER BY created_at DESC LIMIT 1",[b])).rows[0].used_cost,'1.123456');
 });
 it('rejects a money authorization carrying a different currency',async()=>{
  const created=await grant({action:'fulfill_promise'});await pool.query("UPDATE staff_service_grants SET currency='USD' WHERE id=$1",[created.grant.id]);
  await assert.rejects(consume({action:'fulfill_promise'}),{statusCode:403});
 });
 it('automatic briefing is versioned from configuration and acknowledgements stay private',async()=>{
  const first=await completion.getAutomaticBriefing({businessId:b,staff},deps);await completion.acknowledgeAutomaticBriefing({businessId:b,staff,briefingId:first.briefing.id,version:first.briefing.version},deps);
  assert.equal((await completion.getAutomaticBriefing({businessId:b,staff},deps)).briefing.acknowledged,true);
  await promises.configureRewardAvailability({businessId:b,staff:owner,rewardId:r,available:false,alternativeRewardIds:[alt]},deps);
  const next=await completion.getAutomaticBriefing({businessId:b,staff},deps);assert.equal(next.briefing.version,first.briefing.version+1);assert.equal(next.briefing.acknowledged,false);assert.equal(next.briefing.payload.unavailable_rewards[0].alternatives[0].name,'Tea');
  await assert.rejects(completion.acknowledgeAutomaticBriefing({businessId:b,staff,briefingId:first.briefing.id,version:first.briefing.version},deps),{statusCode:409});
 });
 it('marks expired or other-branch substitutes unavailable in the staff briefing',async()=>{
  const elsewhere=randomUUID();await pool.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$2,'Other branch',$3)",[elsewhere,b,elsewhere]);
  await pool.query('INSERT INTO reward_branches(reward_id,branch_id) VALUES($1,$2)',[alt,elsewhere]);
  try{const scoped=await completion.getAutomaticBriefing({businessId:b,staff},deps);assert.equal(scoped.briefing.payload.unavailable_rewards.find(x=>x.id===r).alternatives[0].available,false);}finally{await pool.query('DELETE FROM reward_branches WHERE reward_id=$1 AND branch_id=$2',[alt,elsewhere]);}
  await pool.query("UPDATE rewards SET valid_until=clock_timestamp()-interval '1 day' WHERE id=$1",[alt]);
  try{const expired=await completion.getAutomaticBriefing({businessId:b,staff},deps);assert.equal(expired.briefing.payload.unavailable_rewards.find(x=>x.id===r).alternatives[0].available,false);}finally{await pool.query('UPDATE rewards SET valid_until=NULL WHERE id=$1',[alt]);}
 });
 it('persists full rehearsal with no customer, ledger, stock or balance mutations and rejects foreign access',async()=>{
  const before=(await pool.query('SELECT points FROM customer_balances WHERE customer_id=$1',[c])).rows[0].points;
  const initial=await completion.startRehearsal({businessId:b,staff,requestId:randomUUID()},deps);let session=initial.session;
  for(const input of [{action:'signup'},{action:'ineligibility',rewardId:alt},{action:'earn',quantity:8},{action:'unlock',rewardId:alt},{action:'redeem',rewardId:alt},{action:'refund'}]){
   const args={businessId:b,staff,rehearsalId:session.id,version:session.version,requestId:randomUUID(),...input};const results=await Promise.all([completion.advanceRehearsal(args,deps),completion.advanceRehearsal(args,deps)]);assert.equal(results[0].session.version,results[1].session.version);session=results[0].session;
  }
  assert.ok(session.completed_at);assert.equal((await completion.getRehearsal({businessId:b,staff},deps)).session.state.complete,true);
  assert.equal((await pool.query('SELECT points FROM customer_balances WHERE customer_id=$1',[c])).rows[0].points,before);assert.equal((await pool.query('SELECT stock FROM rewards WHERE id=$1',[alt])).rows[0].stock,10);
  await assert.rejects(completion.advanceRehearsal({businessId:other,staff,rehearsalId:session.id,version:session.version,requestId:randomUUID(),action:'signup'},deps),{statusCode:403});
 });
 it('assigns and escalates cases, extends a promise deadline without rewriting it, fulfills the approved substitute and records actual outcome',async()=>{
  assert.equal(typeof recovery.manageServiceCase,'function');
  await pool.query('UPDATE rewards SET points_cost=90 WHERE id=$1',[r]);const entitlement=(await promises.listCustomerEntitlements({businessId:b,customerId:c},deps)).promises.find(x=>x.reward_id===r);
  const created=await recovery.createServiceCase({businessId:b,staff,customerId:c,rewardId:r,kind:'unavailable',reason:'Stock unavailable',requestId:randomUUID()},deps);
  let row=(await recovery.manageServiceCase({businessId:b,staff:owner,caseId:created.case.id,version:1,requestId:randomUUID(),action:'assign',assignedStaffId:s,reason:'Responsible cashier'},deps)).case;
  row=(await recovery.manageServiceCase({businessId:b,staff,caseId:row.id,version:row.version,requestId:randomUUID(),action:'escalate',reason:'Needs owner policy'},deps)).case;
  const extended=await promises.extendRewardPromise({businessId:b,staff:owner,promiseId:entitlement.id,extendedUntil:new Date(Date.now()+86400000).toISOString(),reason:'Customer recovery',requestId:randomUUID()},deps);assert.ok(extended.extension.id);
  assert.equal(new Date((await pool.query('SELECT valid_until FROM customer_reward_promises WHERE id=$1',[entitlement.id])).rows[0].valid_until).toISOString(),new Date(entitlement.valid_until).toISOString());
  const done=await recovery.resolveServiceCase({businessId:b,staff:owner,caseId:row.id,version:row.version,requestId:randomUUID(),resolution:'alternative_accepted',reason:'Delivered approved tea',attested:true,promiseId:entitlement.id,fulfillmentRewardId:alt},deps);
  assert.equal(done.evidence_level,'fulfilled');assert.ok(done.fulfillment.redemptionId);const detail=await recovery.getServiceCase({businessId:b,staff:owner,caseId:row.id},deps);assert.equal(detail.events.at(-1).details.evidence_level,'fulfilled');
 });
 it('extends an expired issued promise, then fulfills its original reward using the preserved price',async()=>{
  const customer=randomUUID(),cycle=randomUUID(),promise=randomUUID();
  await pool.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,$3,'Expired promise fixture')",[customer,b,`502${String(Date.now()).slice(-8)}`]);await pool.query('INSERT INTO customer_balances(customer_id,points) VALUES($1,80)',[customer]);
  await pool.query("INSERT INTO reward_promise_cycles(id,business_id,customer_id,program_type,earning_terms,progress_points,pending_points) VALUES($1,$2,$3,'VISIT','{\"points_per_visit\":10}',80,0)",[cycle,b,customer]);
  await pool.query("INSERT INTO customer_reward_promises(id,business_id,cycle_id,reward_id,reward_name,description,points_cost,valid_until,branch_ids) VALUES($1,$2,$3,$4,'Coffee as promised','Original cup',80,clock_timestamp()-interval '1 day','{}')",[promise,b,cycle,r]);
  await promises.configureRewardAvailability({businessId:b,staff:owner,rewardId:r,available:true,alternativeRewardIds:[alt]},deps);
  let row=(await recovery.createServiceCase({businessId:b,staff:owner,customerId:customer,rewardId:r,kind:'unavailable',reason:'Expired while unavailable',requestId:randomUUID()},deps)).case;
  const original=(await pool.query('SELECT valid_until FROM customer_reward_promises WHERE id=$1',[promise])).rows[0].valid_until;
  row=(await recovery.manageServiceCase({businessId:b,staff:owner,caseId:row.id,version:row.version,requestId:randomUUID(),action:'extend_expiry',promiseId:promise,extendedUntil:new Date(Date.now()+86400000).toISOString(),reason:'Honor original benefit'},deps)).case;
  const request={businessId:b,staff:owner,caseId:row.id,version:row.version,requestId:randomUUID(),resolution:'original_fulfilled',reason:'Original coffee delivered',attested:true,promiseId:promise};
  const done=await recovery.resolveServiceCase(request,deps);assert.equal(done.fulfillment.pointsCost,80);assert.equal(done.evidence_level,'fulfilled');assert.equal((await recovery.resolveServiceCase(request,deps)).fulfillment.redemptionId,done.fulfillment.redemptionId);
  assert.equal(+new Date((await pool.query('SELECT valid_until FROM customer_reward_promises WHERE id=$1',[promise])).rows[0].valid_until),+new Date(original));
  await assert.rejects(promises.extendRewardPromise({businessId:b,staff:owner,promiseId:promise,extendedUntil:new Date(Date.now()+2*86400000).toISOString(),reason:'Already fulfilled',requestId:randomUUID()},deps),{statusCode:409});
 });
 it('rejects stale automatic acknowledgement even when configuration changes before another reader opens it',async()=>{
  const before=await completion.getAutomaticBriefing({businessId:b,staff},deps);await pool.query("UPDATE businesses SET program_json=program_json||'{\"points_per_visit\":11}' WHERE id=$1",[b]);
  await assert.rejects(completion.acknowledgeAutomaticBriefing({businessId:b,staff,briefingId:before.briefing.id,version:before.briefing.version},deps),{statusCode:409});
 });
 it('rechecks delegation expiration after waiting for the locked grant and isolates frequency from total caps',async()=>{
  const g=await grant({action:'assigned_decision',endsAt:new Date(Date.now()+350).toISOString()});const locker=await pool.connect();try{await locker.query('BEGIN');await locker.query('SELECT id FROM staff_service_grants WHERE id=$1 FOR UPDATE',[g.grant.id]);const attempt=assert.rejects(consume({action:'assigned_decision'}),{statusCode:403});await locker.query('SELECT pg_sleep(0.45)');await locker.query('COMMIT');await attempt;}finally{await locker.query('ROLLBACK');locker.release();}
  await grant({action:'assigned_decision',maxActions:10,frequencyLimit:1,totalCost:100});await consume({action:'assigned_decision'});await assert.rejects(consume({action:'assigned_decision'}),{statusCode:403});
 });
 it('never reads case counts from other branches into an unassigned cashier briefing',async()=>{
  const unassigned=randomUUID();await pool.query("INSERT INTO staff_users(id,business_id,name,role,password_hash) VALUES($1,$2,'Unassigned','CASHIER','test')",[unassigned,b]);
  const made=await recovery.createServiceCase({businessId:b,staff,customerId:c,rewardId:r,kind:'unavailable',reason:'Branch-only case',requestId:randomUUID()},deps);
  assert.ok(made.case.id);const brief=await completion.getAutomaticBriefing({businessId:b,staff:{id:unassigned,business_id:b,branch_id:null,role:'CASHIER'}},deps);assert.equal(brief.briefing.payload.cases.length,0);
 });
 it('retains case history after customer deletion while withholding active entitlements',async()=>{
  const row=(await recovery.createServiceCase({businessId:b,staff,customerId:c,rewardId:r,kind:'unavailable',reason:'Historical support case',requestId:randomUUID()},deps)).case;
  await pool.query('UPDATE customers SET deleted_at=clock_timestamp() WHERE id=$1',[c]);
  const detail=await recovery.getServiceCase({businessId:b,staff:owner,caseId:row.id},deps);assert.equal(detail.case.id,row.id);assert.equal(detail.events[0].event_type,'reported');assert.deepEqual(detail.promises,[]);assert.equal(detail.customer_active,false);
 });
 it('imports paper progress with owner-approved evidence and preserves duplicate preview',async()=>{
  const source={type:'paper_card',label:'Counter cards',evidence:'Owner verified numbered register',conversion:{points_per_unit:10,approved:true}};
  const csv='Phone,Name,Stamps\n55559177,Import fixture,6',columns={phone:'Phone',name:'Name',points:'Stamps'};
  const preview=await migration.previewCustomerMigration({businessId:b,csv,columns,source},{query:(...args)=>pool.query(...args)});assert.equal(preview.summary.opening_points,60);
  const args={businessId:b,staffId:o,csv,columns,source,requestId:randomUUID(),label:'Paper cards',confirmed:true};const result=await migration.commitCustomerMigration(args,deps);assert.equal(result.batch.opening_points,60);assert.equal(result.batch.source_evidence.type,'paper_card');
  const duplicate=await migration.previewCustomerMigration({businessId:b,csv,columns,source},{query:(...args)=>pool.query(...args)});assert.equal(duplicate.summary.existing_customers,1);assert.equal(duplicate.summary.opening_points,0);
 });
});
