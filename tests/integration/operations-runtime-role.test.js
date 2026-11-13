import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,describe,it} from 'node:test';
import pg from 'pg';
import {APP_TABLE_PRIVILEGES,buildGrantPlan} from '../../src/scripts/create-app-role.mjs';

const url=process.env.OPERATIONS_RUNTIME_TEST_DB_URL;
const suite=url?describe:describe.skip;
const role=`ops_runtime_${randomUUID().replaceAll('-','')}`;
const b=randomUUID(),other=randomUUID(),staff=randomUUID(),customer=randomUUID(),reward=randomUUID(),campaign=randomUUID();
const tables=['merchant_decision_events','issued_commitment_values','operating_offer_templates','operating_template_runs','operating_mode_changes','demand_topics','demand_requests','demand_request_receipts','demand_events','supplier_agreements','supplier_claims','supplier_claim_events','staff_auto_briefings','staff_auto_briefing_acknowledgements','reward_promise_extensions','staff_rehearsals','staff_rehearsal_events','ingestion_health_events','transaction_evidence_events','redemption_evidence_events'];
let client,roleCreated=false;
const rows=new Map();
const ident=value=>{assert.match(value,/^[a-z_][a-z0-9_]*$/);return `"${value}"`;};
async function insert(table,values){
 const entries=Object.entries(values),columns=entries.map(([key])=>ident(key)).join(','),parameters=entries.map((_,i)=>`$${i+1}`).join(',');
 const row=(await client.query(`INSERT INTO ${ident(table)}(${columns}) VALUES(${parameters}) RETURNING *`,entries.map(([,value])=>value))).rows[0];
 rows.set(table,row);return row;
}
async function denied(query,values=[]){
 await client.query('SAVEPOINT expected_denial');
 try{await assert.rejects(client.query(query,values),{code:'42501'});}finally{await client.query('ROLLBACK TO SAVEPOINT expected_denial');await client.query('RELEASE SAVEPOINT expected_denial');}
}
suite('integrated operations least-privilege runtime role',()=>{
 before(async()=>{
  const parsed=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));assert.equal(parsed.port,'55470');assert.equal(parsed.pathname,'/operations_completion_test');
  client=new pg.Client({connectionString:url});await client.connect();
  await client.query(`CREATE ROLE ${ident(role)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);roleCreated=true;
  const plan=buildGrantPlan({appDbUser:role,dbName:'operations_completion_test'});
  for(const statement of plan.statements)await client.query(statement);await client.query(plan.grantFunctionsSql);
  await client.query('BEGIN');
  await client.query("INSERT INTO businesses(id,name,slug,email,password_hash,program_type,program_json) VALUES($1,'Runtime fixture',$2,$3,'fixture','VISIT','{\"points_per_visit\":10}'),($4,'Other runtime fixture',$5,$6,'fixture','VISIT','{}')",[b,`runtime-${b}`,`${b}@example.test`,other,`runtime-${other}`,`${other}@example.test`]);
  await client.query("INSERT INTO staff_users(id,business_id,name,role,password_hash) VALUES($1,$2,'Runtime owner','OWNER','fixture')",[staff,b]);
  await client.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,$3,'Runtime customer')",[customer,b,`502${String(Date.now()).slice(-8)}`]);
  await client.query("INSERT INTO rewards(id,business_id,name,description,points_cost) VALUES($1,$2,'Runtime coffee','One coffee',10)",[reward,b]);
  await client.query("INSERT INTO growth_campaigns(id,business_id,request_id,name,bonus_points,minimum_purchase_q,duration_days,holdout_percent) VALUES($1,$2,$3,'Runtime draft',10,0,7,10)",[campaign,b,randomUUID()]);
  await client.query(`SET LOCAL ROLE ${ident(role)}`);await client.query("SELECT set_config('app.current_tenant',$1,true),set_config('app.platform_admin','false',true)",[b]);
 });
 after(async()=>{
  if(client){await client.query('ROLLBACK');if(roleCreated){await client.query(`DROP OWNED BY ${ident(role)}`);await client.query(`DROP ROLE ${ident(role)}`);}await client.end();}
 });
 it('matches the explicit grant registry and forced tenant policies for all 20 new tables',async()=>{
  const actor=(await client.query('SELECT rolsuper,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=current_user')).rows[0];assert.deepEqual(actor,{rolsuper:false,rolbypassrls:false,rolinherit:false});
  for(const table of tables){
   const policy=(await client.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',[table])).rows[0];assert.deepEqual(policy,{relrowsecurity:true,relforcerowsecurity:true},table);
   for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']){
    const actual=(await client.query('SELECT has_table_privilege(current_user,$1,$2) AS allowed',[table,privilege])).rows[0].allowed;
    assert.equal(actual,APP_TABLE_PRIVILEGES[table].includes(privilege),`${table} ${privilege}`);
   }
  }
 });
 it('writes the owner, demand, funding, service and health records and runs evidence triggers as the runtime role',async()=>{
  const redemption=await insert('redemptions',{id:randomUUID(),business_id:b,reward_id:reward,customer_id:customer,staff_user_id:staff,code:randomUUID().replaceAll('-','').slice(0,16),points_cost:10,status:'REDEEMED',redeemed_at:new Date()});
  const transaction=await insert('transactions',{id:randomUUID(),business_id:b,customer_id:customer,staff_user_id:staff,points:10,source:'staff',status:'PENDING',meta:{award_evidence:{schema_version:1,fixture:true}}});
  await client.query("UPDATE transactions SET status='POSTED' WHERE id=$1",[transaction.id]);
  await client.query("UPDATE redemptions SET status='CANCELLED' WHERE id=$1",[redemption.id]);
  const transactionEvents=(await client.query('SELECT * FROM transaction_evidence_events WHERE business_id=$1 AND transaction_id=$2 ORDER BY created_at,id',[b,transaction.id])).rows;
  assert.equal(transactionEvents.length,2);assert.equal(transactionEvents[0].event_type,'recorded');assert.equal(transactionEvents[1].event_type,'changed');assert.equal(transactionEvents[1].previous_state.status,'PENDING');assert.equal(transactionEvents[1].recorded_state.status,'POSTED');rows.set('transaction_evidence_events',transactionEvents[0]);
  const redemptionEvents=(await client.query('SELECT * FROM redemption_evidence_events WHERE business_id=$1 AND redemption_id=$2 ORDER BY created_at,id',[b,redemption.id])).rows;
  assert.equal(redemptionEvents.length,2);assert.equal(redemptionEvents[0].rule_snapshot.name,'Runtime coffee');assert.equal(redemptionEvents[1].previous_status,'REDEEMED');assert.equal(redemptionEvents[1].recorded_status,'CANCELLED');rows.set('redemption_evidence_events',redemptionEvents[0]);
  await insert('reward_unit_costs',{business_id:b,reward_id:reward,unit_cost_q:2.123456,retail_value_q:5});
  const cycle=await insert('reward_promise_cycles',{id:randomUUID(),business_id:b,customer_id:customer,program_type:'VISIT',earning_terms:{points_per_visit:10},progress_points:10,pending_points:0});
  const promise=await insert('customer_reward_promises',{id:randomUUID(),business_id:b,cycle_id:cycle.id,reward_id:reward,reward_name:'Runtime coffee',points_cost:10,branch_ids:[]});
  const commitment=(await client.query('SELECT * FROM issued_commitment_values WHERE business_id=$1 AND source_id=$2',[b,promise.id])).rows[0];assert.equal(Number(commitment.fulfillment_cost),Number((await client.query('SELECT unit_cost_q FROM reward_unit_costs WHERE business_id=$1 AND reward_id=$2',[b,reward])).rows[0].unit_cost_q));assert.equal(commitment.currency,'GTQ');rows.set('issued_commitment_values',commitment);
  await insert('merchant_decision_events',{id:randomUUID(),business_id:b,decision_key:'runtime_fixture',version:1,actor_staff_id:staff,evidence_fingerprint:'fixture',status:'open'});
  const template=await insert('operating_offer_templates',{id:randomUUID(),business_id:b,source_campaign_id:campaign,name:'Runtime template',terms:{},maximum_runs:2,capacity:1,expires_at:new Date(Date.now()+86400000),created_by_staff_id:staff,request_id:randomUUID(),payload_fingerprint:'fixture'});
  await insert('operating_template_runs',{id:randomUUID(),business_id:b,template_id:template.id,campaign_id:campaign,request_id:randomUUID(),staff_id:staff,payload_fingerprint:'fixture'});
  await insert('operating_mode_changes',{id:randomUUID(),business_id:b,request_id:randomUUID(),staff_id:staff,payload_fingerprint:'fixture',result:{mode:'quiet'}});
  const topic=await insert('demand_topics',{id:randomUUID(),business_id:b,topic_key:randomUUID(),category:'product',topic:'Runtime request'});
  const request=await insert('demand_requests',{id:randomUUID(),business_id:b,topic_id:topic.id,customer_id:customer,staff_id:staff,source:'staff',note:'Fictional runtime check',request_id:randomUUID(),request_fingerprint:'fixture'});
  await insert('demand_request_receipts',{business_id:b,request_id:randomUUID(),demand_request_id:request.id,request_fingerprint:'fixture',deduplicated:false});
  await insert('demand_events',{id:randomUUID(),business_id:b,topic_id:topic.id,staff_id:staff,request_id:randomUUID(),request_fingerprint:'fixture',version:1,details:{status:'new'}});
  const agreement=await insert('supplier_agreements',{id:randomUUID(),business_id:b,supplier_name:'Runtime supplier',title:'Runtime agreement',reward_ids:[reward],starts_at:new Date(),ends_at:new Date(Date.now()+86400000),currency:'GTQ',minor_units:2,unit_amount_minor:500,cap_minor:1000,created_by_staff_id:staff,request_id:randomUUID(),request_fingerprint:'fixture'});
  const claim=await insert('supplier_claims',{id:randomUUID(),business_id:b,agreement_id:agreement.id,redemption_id:redemption.id,amount_minor:500,currency:'GTQ',evidence:{fixture:true},request_id:randomUUID(),request_fingerprint:'fixture',created_by_staff_id:staff});
  await insert('supplier_claim_events',{id:randomUUID(),business_id:b,claim_id:claim.id,staff_id:staff,request_id:randomUUID(),request_fingerprint:'fixture',version:1,details:{status:'draft'}});
  const briefing=await insert('staff_auto_briefings',{id:randomUUID(),business_id:b,scope_key:'all',payload_fingerprint:'fixture',payload:{fixture:true}});
  await insert('staff_auto_briefing_acknowledgements',{business_id:b,briefing_id:briefing.id,staff_id:staff});
  await insert('reward_promise_extensions',{id:randomUUID(),business_id:b,promise_id:promise.id,extended_until:new Date(Date.now()+86400000),reason:'Runtime fixture',actor_staff_id:staff,request_id:randomUUID(),payload_fingerprint:'fixture'});
  const rehearsal=await insert('staff_rehearsals',{id:randomUUID(),business_id:b,staff_id:staff,config_fingerprint:'fixture',state:{fictional:true}});
  await insert('staff_rehearsal_events',{id:randomUUID(),business_id:b,rehearsal_id:rehearsal.id,request_id:randomUUID(),payload_fingerprint:'fixture',result:{fictional:true}});
  await insert('ingestion_health_events',{id:randomUUID(),business_id:b,monitor_id:randomUUID(),request_id:randomUUID(),fingerprint:'fixture',details:{fictional:true}});
  for(const table of tables)assert.ok((await client.query(`SELECT 1 FROM ${ident(table)} WHERE business_id=$1`,[b])).rowCount,table);
 });
 it('allows only intended mutable fields while denying runtime history updates and deletes',async()=>{
  await client.query('UPDATE operating_offer_templates SET used_runs=used_runs+1,version=version+1 WHERE business_id=$1',[b]);
  await client.query("UPDATE demand_topics SET status='reviewing',version=version+1 WHERE business_id=$1",[b]);
  await client.query('UPDATE supplier_agreements SET closed_at=clock_timestamp() WHERE business_id=$1',[b]);
  await client.query("UPDATE supplier_claims SET status='submitted',version=version+1 WHERE business_id=$1",[b]);
  await client.query("UPDATE staff_rehearsals SET state='{\"fictional\":true,\"checked\":true}',version=version+1 WHERE business_id=$1",[b]);
  for(const table of tables){
   if(!APP_TABLE_PRIVILEGES[table].includes('UPDATE'))await denied(`UPDATE ${ident(table)} SET business_id=business_id WHERE business_id=$1`,[b]);
   await denied(`DELETE FROM ${ident(table)} WHERE business_id=$1`,[b]);
  }
 });
 it('excludes other tenants and rejects writes across every new tenant boundary',async()=>{
  await client.query("SELECT set_config('app.current_tenant',$1,true)",[other]);
  try{for(const table of tables){
   assert.equal((await client.query(`SELECT 1 FROM ${ident(table)} WHERE business_id=$1`,[b])).rowCount,0,table);
   const row=rows.get(table);assert.ok(row,`${table} fixture`);
   await denied(`INSERT INTO ${ident(table)} SELECT (jsonb_populate_record(NULL::${ident(table)},$1::jsonb)).*`,[JSON.stringify(row)]);
   if(APP_TABLE_PRIVILEGES[table].includes('UPDATE'))assert.equal((await client.query(`UPDATE ${ident(table)} SET business_id=business_id WHERE business_id=$1`,[b])).rowCount,0,table);
  }}finally{await client.query("SELECT set_config('app.current_tenant',$1,true)",[b]);}
 });
});
