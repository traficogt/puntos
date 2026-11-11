import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, describe, it } from 'node:test';
import pg from 'pg';
const url=process.env.MERCHANT_PILOTS_TEST_DB_URL;
const suite=url?describe:describe.skip;
const businessId=randomUUID(),otherBusiness=randomUUID(),staffId=randomUUID(),customerId=randomUUID();
let db,service,deps;
suite('merchant pilots in disposable PostgreSQL',()=>{
 before(async()=>{
  const parsed=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));assert.equal(parsed.pathname,'/merchant_pilots_test');
  db=new pg.Pool({connectionString:url});await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await db.query(await readFile(new URL('../fixtures/customer-recovery.sql',import.meta.url),'utf8'));
  await db.query("ALTER TABLE businesses ADD COLUMN plan text DEFAULT 'NEGOCIO'; ALTER TABLE customers ADD COLUMN created_at timestamptz DEFAULT now(); ALTER TABLE customers ADD COLUMN imported_at timestamptz; CREATE TABLE redemptions(id uuid PRIMARY KEY,business_id uuid,customer_id uuid,status text,created_at timestamptz,redeemed_at timestamptz)");
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await db.query(await readFile(new URL('../../src/app/migrations/2026-11-10-merchant-pilots.sql',import.meta.url),'utf8'));
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await db.query(await readFile(new URL('../../src/app/migrations/2026-11-11-pilot-evidence.sql',import.meta.url),'utf8'));
  service=await import('../../src/app/services/merchant-pilot-service.js');
  deps={query:db.query.bind(db),getPlanFeatureOverrides:async()=>({}),audit:async()=>{},now:()=>new Date('2026-11-10T18:00:00Z'),transaction:async fn=>{const c=await db.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 });
 after(async()=>{await db?.end();});
 beforeEach(async()=>{
  await db.query('TRUNCATE businesses CASCADE');await db.query('TRUNCATE transactions,redemptions');
  await db.query('INSERT INTO businesses(id) VALUES($1),($2)',[businessId,otherBusiness]);await db.query('INSERT INTO staff_users(id,business_id) VALUES($1,$2)',[staffId,businessId]);await db.query("INSERT INTO customers(id,business_id,name,phone,created_at) VALUES($1,$2,'Test','50255550000','2026-11-01')",[customerId,businessId]);
 });
 const start=(requestId=randomUUID(),name='Pilot test')=>service.createPilot({businessId,staffId,requestId,name,durationDays:14},deps);
 it('concurrent creation replays one request and prevents a second active pilot',async()=>{
  const requestId=randomUUID();const [a,b]=await Promise.all([start(requestId),start(requestId)]);assert.equal(a.pilot.id,b.pilot.id);assert.equal(a.pilot.status,'active');
  await assert.rejects(start(requestId,'Changed'),/solicitud/i);await assert.rejects(start(),/activo/i);
  const list=await service.listPilots({businessId,offset:0},deps);assert.equal(list.total,1);
 });
 it('tenant isolation, required evidence, closure and immutable closed checks',async()=>{
  const {pilot}=await start();await assert.rejects(service.getPilot({businessId:otherBusiness,pilotId:pilot.id},deps),/encontr/i);
  await assert.rejects(service.closePilot({businessId,staffId,pilotId:pilot.id,outcome:'completed',note:''},deps),/pruebas/i);
  for(const check of (await service.getPilot({businessId,pilotId:pilot.id},deps)).checks)await service.updatePilotCheck({businessId,staffId,pilotId:pilot.id,key:check.key,status:check.required?'passed':'not_applicable',note:'Revisado por responsable'},deps);
  const detail=await service.getPilot({businessId,pilotId:pilot.id},deps);assert.equal(detail.checks.length,13);assert.equal(detail.checks.filter(c=>c.status==='passed').length,10);
  assert.equal((await service.closePilot({businessId,staffId,pilotId:pilot.id,outcome:'completed',note:'Prueba concluida'},deps)).pilot.status,'completed');
  await assert.rejects(service.updatePilotCheck({businessId,staffId,pilotId:pilot.id,key:'purchase',status:'failed',note:'late'},deps),/cerrado/i);
 });
 it('stopping retains failures and permits a new pilot without claiming success',async()=>{
  const {pilot}=await start();await service.updatePilotCheck({businessId,staffId,pilotId:pilot.id,key:'purchase',status:'failed',note:'No pudimos completar'},deps);
  assert.equal((await service.closePilot({businessId,staffId,pilotId:pilot.id,outcome:'stopped',note:'Revisión necesaria'},deps)).pilot.status,'stopped');assert.notEqual((await start()).pilot.id,pilot.id);
 });
 it('equal elapsed windows exclude adjustments, refunds and other tenants',async()=>{
  const {pilot}=await start();await db.query("UPDATE merchant_pilots SET started_at='2026-11-08T18:00:00Z',planned_end_at='2026-11-22T18:00:00Z' WHERE id=$1",[pilot.id]);
  for(const [amount,date,source,bid,reversed] of [[100,'2026-11-09','online',businessId,null],[40,'2026-11-07','external',businessId,null],[999,'2026-11-09','adjustment',businessId,null],[888,'2026-11-09','online',otherBusiness,null],[777,'2026-11-09','online',businessId,randomUUID()]])await db.query('INSERT INTO transactions(id,business_id,customer_id,amount_q,created_at,source,reversed_transaction_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),bid,customerId,amount,date,source,reversed]);
  const {results}=await service.getPilot({businessId,pilotId:pilot.id},deps);assert.equal(results.current.recorded_sales_q,100);assert.equal(results.previous.recorded_sales_q,40);assert.equal(results.current.purchases,1);assert.equal(Date.parse(results.period.end)-Date.parse(results.period.start),Date.parse(results.period.previous_end)-Date.parse(results.period.previous_start));
 });
 it('required tests cannot be skipped and downgraded plans cannot change evidence',async()=>{
  const {pilot}=await start();await assert.rejects(service.updatePilotCheck({businessId,staffId,pilotId:pilot.id,key:'purchase',status:'not_applicable',note:'skip'},deps),/obligatoria/i);
  await db.query("UPDATE businesses SET plan='EMPRENDEDOR' WHERE id=$1",[businessId]);await assert.rejects(service.updatePilotCheck({businessId,staffId,pilotId:pilot.id,key:'purchase',status:'passed',note:'done'},deps),/plan/i);
 });
 it('new pilots keep immutable POS versions and require all four fulfillment evidence checks',async()=>{
  const requestId=randomUUID(),posProfile={vendor:'Odoo',pos_version:'18.0',module_version:'18.0.2.0.0',deployment:'self_hosted'};
  const options={businessId,staffId,requestId,name:'Odoo acceptance',durationDays:14,posProfile};
  const {pilot}=await service.createPilot(options,deps);
  assert.equal(pilot.checklist_version,2);assert.deepEqual(pilot.pos_profile,posProfile);
  assert.deepEqual((await service.createPilot(options,deps)).pilot.pos_profile,posProfile);
  await assert.rejects(service.createPilot({...options,posProfile:{...posProfile,module_version:'18.0.3.0.0'}},deps),/solicitud/i);
  const detail=await service.getPilot({businessId,pilotId:pilot.id},deps);
  const extra=['fulfillment_recording','manual_recording','fulfillment_retry','fulfillment_cancellation'];
  for(const key of extra)assert.equal(detail.checks.find(c=>c.key===key)?.required,true,key);
  for(const check of detail.checks.filter(c=>!extra.includes(c.key)))await service.updatePilotCheck({businessId,staffId,pilotId:pilot.id,key:check.key,status:check.required?'passed':'not_applicable',note:'Original checks done'},deps);
  await assert.rejects(service.closePilot({businessId,staffId,pilotId:pilot.id,outcome:'completed',note:''},deps),/pruebas/i);
  await assert.rejects(db.query("UPDATE merchant_pilots SET pos_profile='{}'::jsonb WHERE id=$1",[pilot.id]),/inmutable|immutable/i);
  await assert.rejects(db.query('UPDATE merchant_pilots SET checklist_version=1 WHERE id=$1',[pilot.id]),/inmutable|immutable/i);
 });
 it('legacy active and closed pilots retain their original nine checks',async()=>{
  const id=randomUUID();
  await db.query("INSERT INTO merchant_pilots(id,business_id,request_id,name,duration_days,started_at,planned_end_at) VALUES($1,$2,$3,'Legacy',14,'2026-11-01','2026-11-15')",[id,businessId,randomUUID()]);
  const keys=['enrollment','purchase','duplicate_receipt','redemption','refund','offline_reconnect','wallet_installation','message_delivery','pos_installation'];
  for(const key of keys)await db.query('INSERT INTO merchant_pilot_checks(business_id,pilot_id,check_key) VALUES($1,$2,$3)',[businessId,id,key]);
  const detail=await service.getPilot({businessId,pilotId:id},deps);assert.equal(detail.pilot.checklist_version,1);assert.equal(detail.pilot.pos_profile,null);assert.deepEqual(detail.checks.map(c=>c.key),keys);
  await assert.rejects(service.updatePilotCheck({businessId,staffId,pilotId:id,key:'fulfillment_recording',status:'passed',note:'New key'},deps),/prueba|versión/i);
  for(const check of detail.checks)await service.updatePilotCheck({businessId,staffId,pilotId:id,key:check.key,status:check.required?'passed':'not_applicable',note:'Legacy evidence'},deps);
  await service.closePilot({businessId,staffId,pilotId:id,outcome:'completed',note:'Done'},deps);
  assert.equal((await service.getPilot({businessId,pilotId:id},deps)).checks.length,9);
 });
 it('a missing check row cannot claim that evidence was saved',async()=>{
  const {pilot}=await start();
  await db.query("DELETE FROM merchant_pilot_checks WHERE pilot_id=$1 AND check_key='purchase'",[pilot.id]);
  await assert.rejects(service.updatePilotCheck({businessId,staffId,pilotId:pilot.id,key:'purchase',status:'passed',note:'No stored row'},deps),/prueba|registro/i);
 });
 it('list keeps the latest completed pilot available outside the current history page',async()=>{
  const completed=randomUUID();
  await db.query("INSERT INTO merchant_pilots(id,business_id,request_id,name,duration_days,status,started_at,planned_end_at,closed_at) VALUES($1,$2,$3,'Completed',14,'completed','2026-10-01','2026-10-15','2026-10-15')",[completed,businessId,randomUUID()]);
  for(let i=0;i<21;i++)await db.query("INSERT INTO merchant_pilots(id,business_id,request_id,name,duration_days,status,started_at,planned_end_at,closed_at) VALUES($1,$2,$3,'Stopped',14,'stopped','2026-11-01','2026-11-15','2026-11-02')",[randomUUID(),businessId,randomUUID()]);
  const list=await service.listPilots({businessId,offset:0},deps);assert.equal(list.pilots.some(p=>p.id===completed),false);assert.equal(list.latest_completed?.id,completed);
 });
 it('forced RLS hides tenant evidence independently of service predicates',async()=>{
  const {pilot}=await start();await db.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pilot_runtime_test') THEN CREATE ROLE pilot_runtime_test; END IF; END $$; GRANT USAGE ON SCHEMA public,app TO pilot_runtime_test; GRANT SELECT ON merchant_pilots,merchant_pilot_checks TO pilot_runtime_test");
  const c=await db.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE pilot_runtime_test');await c.query("SELECT set_config('app.current_tenant',$1,true)",[otherBusiness]);assert.equal((await c.query('SELECT * FROM merchant_pilots WHERE id=$1',[pilot.id])).rows.length,0);await c.query('ROLLBACK');}finally{c.release();}
 });
});
