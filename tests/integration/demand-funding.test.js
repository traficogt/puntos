import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {describe,before,beforeEach,after,it} from 'node:test';
import pg from 'pg';
const url=process.env.DEMAND_FUNDING_TEST_DB_URL;
const suite=url?describe:describe.skip;
let pool,s;
const businessId=randomUUID(),otherBusiness=randomUUID(),ownerId=randomUUID(),cashierId=randomUUID(),customerId=randomUUID(),foreignCustomer=randomUUID(),rewardId=randomUUID(),redemptionId=randomUUID(),secondRedemption=randomUUID();
const staff={id:ownerId,business_id:businessId,role:'OWNER',branch_id:null},cashier={id:cashierId,business_id:businessId,role:'CASHIER',branch_id:null};
async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
const deps={transaction},actor={businessId,staff};
const demand=(extra={})=>s.createDemandRequest({...actor,customerId,source:'staff',category:'product',topic:'Café sin azúcar',note:'Solicita una opción.',requestId:randomUUID(),...extra},deps);
const agreement=(extra={})=>s.createSupplierAgreement({...actor,requestId:randomUUID(),supplier_name:'Proveedor local',title:'Cafés de noviembre',reward_ids:[rewardId],starts_at:'2026-11-01T00:00:00Z',ends_at:'2026-12-01T00:00:00Z',currency:'GTQ',unit_amount:5,cap_amount:5,...extra},deps);
const claim=(agreementId,extra={})=>s.createSupplierClaim({...actor,agreementId,redemptionId,requestId:randomUUID(),...extra},deps);
const transition=(row,status,extra={})=>s.transitionSupplierClaim({...actor,claimId:row.id,version:row.version,requestId:randomUUID(),status,reference:'Respuesta del proveedor 123',...extra},deps);
suite('demand and supplier funding durable PostgreSQL',()=>{
 before(async()=>{
  assert.equal(new URL(url).pathname,'/demand_funding_test');assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
  pool=new pg.Pool({connectionString:url,max:10});
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await pool.query(await readFile(new URL('../fixtures/reward-economics.sql',import.meta.url),'utf8'));
  await pool.query(`ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS branch_id uuid; ALTER TABLE customers ADD COLUMN IF NOT EXISTS name text; CREATE TABLE IF NOT EXISTS branches(id uuid PRIMARY KEY,business_id uuid,name text); CREATE TABLE IF NOT EXISTS service_redemption_restorations(id uuid PRIMARY KEY,business_id uuid,redemption_id uuid);
   CREATE TABLE IF NOT EXISTS redemption_pos_records(redemption_id uuid PRIMARY KEY,business_id uuid,reward_name text,status text,method text,recorded_at timestamptz,stock_status text,returned_quantity numeric DEFAULT 0,version int DEFAULT 1,currency text,receipt_ref text,source text,order_id text,line_id text);
   CREATE TABLE IF NOT EXISTS redemption_pos_events(id uuid PRIMARY KEY,business_id uuid,redemption_id uuid,kind text,details jsonb,created_at timestamptz DEFAULT now());`);
  await pool.query('ALTER TABLE redemption_pos_records ADD COLUMN IF NOT EXISTS receipt_ref text,ADD COLUMN IF NOT EXISTS source text,ADD COLUMN IF NOT EXISTS order_id text,ADD COLUMN IF NOT EXISTS line_id text');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const migration=await readFile(new URL('../../src/app/migrations/2026-11-13-demand-funding.sql',import.meta.url),'utf8').catch(()=>null);assert.ok(migration,'demand and funding migration must exist');await pool.query(migration);
  s=await import('../../src/app/services/demand-funding-service.js');
 });
 after(async()=>{await pool?.end();});
 beforeEach(async()=>{
  await pool.query('TRUNCATE businesses,staff_users,customers,rewards,redemptions,transactions,audit_logs,redemption_pos_records,redemption_pos_events,service_redemption_restorations CASCADE');
  await pool.query("INSERT INTO businesses(id,plan) VALUES($1,'NEGOCIO'),($2,'NEGOCIO')",[businessId,otherBusiness]);
  await pool.query("INSERT INTO staff_users(id,business_id,role) VALUES($1,$2,'OWNER'),($3,$2,'CASHIER')",[ownerId,businessId,cashierId]);
  await pool.query("INSERT INTO customers(id,business_id,name) VALUES($1,$2,'Private customer'),($3,$4,'Foreign')",[customerId,businessId,foreignCustomer,otherBusiness]);
  await pool.query("INSERT INTO rewards(id,business_id,name,points_cost) VALUES($1,$2,'Café',50)",[rewardId,businessId]);
  for(const id of [redemptionId,secondRedemption]){
   await pool.query("INSERT INTO redemptions(id,business_id,customer_id,reward_id,points_cost,status,redeemed_at) VALUES($1,$2,$3,$4,50,'REDEEMED','2026-11-12T14:00:00Z')",[id,businessId,customerId,rewardId]);
   await pool.query("INSERT INTO transactions(id,business_id,customer_id,points,source,meta) VALUES($1,$2,$3,-50,'redeem',$4)",[randomUUID(),businessId,customerId,{redemption_id:id}]);
   await pool.query("INSERT INTO redemption_pos_records(redemption_id,business_id,reward_name,status,method,recorded_at,stock_status,currency) VALUES($1,$2,'Café','recorded','manual','2026-11-12T14:03:00Z','unknown','GTQ')",[id,businessId]);
   await pool.query("INSERT INTO redemption_pos_events(id,business_id,redemption_id,kind,details) VALUES($1,$2,$3,'recorded','{\"attested\":true}')",[randomUUID(),businessId,id]);
  }
 });
 it('groups normalized topics and deduplicates same member across staff/customer requests',async()=>{
  const a=await demand();const b=await demand({source:'customer',staff:undefined,customerAuth:{id:customerId,business_id:businessId},topic:'cafe sin azucar'});assert.equal(a.request.id,b.request.id);assert.equal(b.deduplicated,true);
  await demand({customerId:null});const list=await s.listDemandTopics(actor,deps);assert.equal(list.topics.length,1);assert.equal(list.topics[0].member_count,1);assert.equal(list.topics[0].staff_observations,1);
 });
 it('binds a deduplicated member request to its retry identity',async()=>{
  await demand();const requestId=randomUUID();const duplicate=await demand({requestId,note:'Pide la misma opción otra vez.'});assert.equal(duplicate.deduplicated,true);
  assert.equal((await demand({requestId,note:'Pide la misma opción otra vez.'})).replay,true);
  await assert.rejects(demand({requestId,topic:'Una opción distinta'}),{statusCode:409});assert.equal((await pool.query('SELECT * FROM demand_requests')).rowCount,1);
 });
 it('rejects cross-tenant members, stale owners and customer identity spoofing',async()=>{
  await assert.rejects(demand({customerId:foreignCustomer}),{statusCode:404});
  await assert.rejects(demand({source:'customer',customerAuth:{id:foreignCustomer,business_id:otherBusiness}}),{statusCode:403});
  await assert.rejects(s.listDemandTopics({...actor,staff:cashier},deps),{statusCode:403});
 });
 it('records owner triage and follow-up with version checks and unchanged original request',async()=>{
  const a=await demand();const args={...actor,topicId:a.topic.id,version:1,requestId:randomUUID(),status:'planned',note:'Consultar inventario el lunes.',follow_up_at:'2026-11-20T12:00:00Z'};
  const result=await s.triageDemandTopic(args,deps);assert.equal(result.topic.version,2);assert.equal((await s.triageDemandTopic(args,deps)).replay,true);
  await assert.rejects(s.triageDemandTopic({...args,requestId:randomUUID()},deps),{statusCode:409});
  await assert.rejects(pool.query("UPDATE demand_requests SET note='changed'"),{code:'23514'});
  const detail=await s.getDemandTopic({...actor,topicId:a.topic.id},deps);assert.equal(detail.requests[0].note,'Solicita una opción.');assert.equal(detail.events.length,1);
 });
 it('atomically reserves cap across concurrent claims and releases only rejection',async()=>{
  const {agreement:a}=await agreement();const results=await Promise.allSettled([claim(a.id),claim(a.id,{redemptionId:secondRedemption})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.statusCode,409);
  const row=results.find(x=>x.status==='fulfilled').value.claim;const submitted=await transition(row,'submitted');await transition(submitted.claim,'rejected');
  const remaining=await claim(a.id,{redemptionId:row.redemption_id===redemptionId?secondRedemption:redemptionId});assert.equal(remaining.claim.amount_minor,500);
 });
 it('claims only eligible recorded unrefunded redemptions and retains immutable proof',async()=>{
  const {agreement:a}=await agreement({cap_amount:20});await pool.query("UPDATE redemption_pos_records SET receipt_ref='Receipt 123'");await pool.query("UPDATE redemption_pos_records SET status='pending' WHERE redemption_id=$1",[redemptionId]);await assert.rejects(claim(a.id),{statusCode:409});
  await pool.query("UPDATE redemption_pos_records SET status='recorded' WHERE redemption_id=$1",[redemptionId]);const requestId=randomUUID(),out=await claim(a.id,{requestId});assert.equal((await claim(a.id,{requestId})).claim.id,out.claim.id);assert.equal(out.claim.evidence.pos.receipt_ref,'Receipt 123');
  await pool.query("UPDATE rewards SET name='New name'; UPDATE redemption_pos_records SET receipt_ref='Changed later'");assert.equal((await s.getSupplierClaim({...actor,claimId:out.claim.id},deps)).claim.evidence.reward_name,'Café');assert.equal((await s.getSupplierClaim({...actor,claimId:out.claim.id},deps)).claim.evidence.pos.receipt_ref,'Receipt 123');
  await assert.rejects(pool.query("UPDATE supplier_claims SET evidence='{}'"),{code:'23514'});
  await pool.query("UPDATE transactions SET reversed_transaction_id=$1 WHERE meta->>'redemption_id'=$2",[randomUUID(),secondRedemption]);await assert.rejects(claim(a.id,{redemptionId:secondRedemption}),{statusCode:409});
 });
 it('uses agreement currency and forbids incorrect minor units, foreign rewards and wrong dates',async()=>{
  await assert.rejects(agreement({currency:'USD'}),{statusCode:400});await assert.rejects(agreement({unit_amount:1.001}),{statusCode:400});await assert.rejects(agreement({reward_ids:[randomUUID()]}),{statusCode:404});
  const {agreement:a}=await agreement({starts_at:'2026-11-20T00:00:00Z'});await assert.rejects(claim(a.id),{statusCode:409});
 });
 it('interprets owner date-only agreement bounds in the business timezone',async()=>{
  const {agreement:a}=await agreement({starts_at:undefined,ends_at:undefined,starts_on:'2026-11-01',ends_on:'2026-12-01'});
  assert.equal(a.starts_at.toISOString(),'2026-11-01T06:00:00.000Z');assert.equal(a.ends_at.toISOString(),'2026-12-01T06:00:00.000Z');
 });
 it('requires submission and approval before payment, reconciles exact amount and exports no identities',async()=>{
  const {agreement:a}=await agreement();const {claim:c}=await claim(a.id);await assert.rejects(transition(c,'paid',{paid_minor:500,paid_at:'2026-11-12'}),{statusCode:409});
  const sub=await transition(c,'submitted'),approved=await transition(sub.claim,'approved');await assert.rejects(transition(approved.claim,'paid',{paid_minor:400,paid_at:'2026-11-12'}),{statusCode:400});
  const requestId=randomUUID(),paid=await transition(approved.claim,'paid',{requestId,paid_minor:500,paid_at:'2026-11-12'});assert.equal(paid.claim.status,'paid');assert.equal((await transition(approved.claim,'paid',{requestId,paid_minor:500,paid_at:'2026-11-12'})).replay,true);
  const overview=await s.getSupplierFunding(actor,deps);assert.equal(overview.summary[0].paid_minor,500);assert.equal(overview.summary[0].available_minor,0);
  const csv=await s.exportSupplierClaims({...actor,agreementId:a.id},deps);assert.ok(!csv.includes(customerId));assert.ok(!csv.includes('Private customer'));assert.ok(!csv.includes('receipt'));
 });
 it('rolls back claim and reservation when mandatory audit fails',async()=>{
  const {agreement:a}=await agreement();await pool.query("CREATE OR REPLACE FUNCTION fail_funding_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='supplier.claim.create' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_funding_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_funding_audit()");
  try{await assert.rejects(claim(a.id),/audit unavailable/);assert.equal((await pool.query('SELECT * FROM supplier_claims')).rowCount,0);}finally{await pool.query('DROP TRIGGER fail_funding_audit ON audit_logs; DROP FUNCTION fail_funding_audit()');}
 });
 it('revalidates refunds before approval/payment, keeps paid evidence and flags later invalidation',async()=>{
  const {agreement:a}=await agreement({cap_amount:10}),created=await claim(a.id),submitted=await transition(created.claim,'submitted');
  await pool.query('INSERT INTO service_redemption_restorations(id,business_id,redemption_id) VALUES($1,$2,$3)',[randomUUID(),businessId,redemptionId]);
  await assert.rejects(transition(submitted.claim,'approved'),{statusCode:409});const rejected=await transition(submitted.claim,'rejected');assert.equal(rejected.claim.status,'rejected');
  const second=await claim(a.id,{redemptionId:secondRedemption}),sub=await transition(second.claim,'submitted'),approved=await transition(sub.claim,'approved');
  let summary=(await s.getSupplierFunding(actor,deps)).summary[0];assert.equal(summary.reserved_minor,500);assert.equal(summary.approved_minor,500);
  const paid=await transition(approved.claim,'paid',{paid_minor:500,paid_at:'2026-11-12'});await pool.query('UPDATE redemption_pos_records SET returned_quantity=1 WHERE redemption_id=$1',[secondRedemption]);
  const overview=await s.getSupplierFunding(actor,deps);assert.equal(overview.claims.find(c=>c.id===paid.claim.id).requires_review,true);assert.equal(overview.summary[0].paid_minor,500);assert.equal(overview.summary[0].reserved_minor,500);
 });
 it('cannot reclaim the same redemption under another agreement and cannot resubmit beyond released cap',async()=>{
  const {agreement:a}=await agreement(),{agreement:b}=await agreement();const first=await claim(a.id);await assert.rejects(claim(b.id),{statusCode:409});
  const rejected=await transition(first.claim,'rejected');await claim(a.id,{redemptionId:secondRedemption});await assert.rejects(transition(rejected.claim,'submitted'),{statusCode:409});
  assert.equal((await s.getSupplierFunding(actor,deps)).summary[0].reserved_minor,500);
 });
 it('customer history isolates sessions, live membership is checked and note audit failures roll back',async()=>{
  await demand({source:'customer',staff:undefined,customerAuth:{id:customerId,business_id:businessId}});
  const otherCustomer=randomUUID();await pool.query('INSERT INTO customers(id,business_id) VALUES($1,$2)',[otherCustomer,businessId]);
  assert.equal((await s.getDemandEntry({businessId,source:'customer',customerId:otherCustomer,customerAuth:{id:otherCustomer,business_id:businessId}},deps)).requests.length,0);
  await pool.query("UPDATE staff_users SET role='CASHIER' WHERE id=$1",[ownerId]);await assert.rejects(s.getSupplierFunding(actor,deps),{statusCode:403});
  await pool.query("UPDATE staff_users SET role='OWNER' WHERE id=$1",[ownerId]);
  const row=(await s.listDemandTopics(actor,deps)).topics[0];await pool.query("CREATE OR REPLACE FUNCTION fail_demand_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='demand.topic.triage' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_demand_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_demand_audit()");
  try{await assert.rejects(s.triageDemandTopic({...actor,topicId:row.id,version:row.version,requestId:randomUUID(),status:'planned',note:'Seguimiento probado'},deps),/audit unavailable/);assert.equal((await pool.query('SELECT status FROM demand_topics')).rows[0].status,'new');assert.equal((await pool.query('SELECT * FROM demand_events')).rowCount,0);}finally{await pool.query('DROP TRIGGER fail_demand_audit ON audit_logs; DROP FUNCTION fail_demand_audit()');}
 });
 it('enforces tenant RLS and immutable claim events even for direct SQL',async()=>{
  await demand();const {agreement:a}=await agreement();await claim(a.id);
  await pool.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='demand_funding_test_app') THEN CREATE ROLE demand_funding_test_app NOLOGIN; END IF; END $$; GRANT USAGE ON SCHEMA public,app TO demand_funding_test_app; GRANT SELECT,INSERT ON demand_topics,demand_requests,supplier_agreements,supplier_claims,supplier_claim_events TO demand_funding_test_app");
  await transaction(async c=>{await c.query('SET LOCAL ROLE demand_funding_test_app');await c.query("SELECT set_config('app.current_tenant',$1,true)",[otherBusiness]);assert.equal((await c.query('SELECT * FROM supplier_claims')).rowCount,0);assert.equal((await c.query('SELECT * FROM demand_requests')).rowCount,0);const row=(await pool.query('SELECT id FROM supplier_claims')).rows[0];await assert.rejects(c.query("INSERT INTO supplier_claim_events(id,business_id,claim_id,staff_id,request_id,request_fingerprint,version,details) VALUES($1,$2,$3,$4,$5,'forged',2,'{}')",[randomUUID(),businessId,row.id,ownerId,randomUUID()]),{code:'42501'});});
  await assert.rejects(pool.query("UPDATE supplier_claim_events SET details='{}'"),{code:'23514'});
 });
});
