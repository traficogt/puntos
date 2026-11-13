import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, describe, it } from 'node:test';
import pg from 'pg';

const databaseUrl=process.env.STAFF_DELEGATION_TEST_DB_URL;
const suite=databaseUrl?describe:describe.skip;
const businessId=randomUUID(), otherBusiness=randomUUID(), ownerId=randomUUID(), staffId=randomUUID(), otherStaff=randomUUID(), branchId=randomUUID(), otherBranch=randomUUID();
const owner={id:ownerId,business_id:businessId,role:'OWNER'}, staff={id:staffId,business_id:businessId,role:'CASHIER',branch_id:branchId};
let pool,service;
async function transaction(fn){const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
const deps={transaction};
const grant=(changes={})=>service.createServiceGrant({requestId:randomUUID(),businessId,staff:owner,staffId,branchId,action:'restore_redemption',perActionPoints:60,totalPoints:100,startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),...changes},deps);
const consume=(changes={})=>transaction(client=>service.consumeServiceAllowance(client,{businessId,staff,action:'restore_redemption',points:40,requestId:randomUUID(),...changes}));
const count=async table=>Number((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count); // fixed test-owned table names only
suite('bounded staff authority against disposable PostgreSQL',()=>{
 before(async()=>{
  const url=new URL(databaseUrl);assert.ok(['127.0.0.1','localhost'].includes(url.hostname));assert.equal(url.pathname,'/staff_delegation_test');
  pool=new pg.Pool({connectionString:databaseUrl,max:10});
  await pool.query(`CREATE SCHEMA IF NOT EXISTS app;
   CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_tenant',true),'')::uuid $$;
   CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('app.platform_admin',true),''),'false')::boolean $$;
   CREATE TABLE IF NOT EXISTS businesses(id uuid PRIMARY KEY);
   CREATE TABLE IF NOT EXISTS branches(id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id),name text);
   CREATE TABLE IF NOT EXISTS staff_users(id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id),branch_id uuid REFERENCES branches(id),name text,role text,active boolean);
   CREATE TABLE IF NOT EXISTS audit_logs(id uuid PRIMARY KEY,business_id uuid,actor_type text,actor_id uuid,action text,ip text,ua text,meta jsonb);
   DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='staff_delegation_test_app') THEN CREATE ROLE staff_delegation_test_app NOLOGIN; END IF; END $$;`);
  // Fixed repository fixture path, never user input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const migration=await readFile(new URL('../../src/app/migrations/2026-11-11-staff-delegation.sql',import.meta.url),'utf8').catch(()=>null);
  assert.ok(migration,'bounded authority migration must exist');await pool.query(migration);
  // Only delegation additions are needed in this deliberately minimal fixture.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
 const completion=await readFile(new URL('../../src/app/migrations/2026-11-13-service-completion.sql',import.meta.url),'utf8');await pool.query(completion.split('CREATE TABLE IF NOT EXISTS staff_auto_briefings')[0]);
  service=await import('../../src/app/services/staff-delegation-service.js');
 });
 after(async()=>pool?.end());
 beforeEach(async()=>{
  await pool.query('TRUNCATE businesses,staff_users,branches,audit_logs CASCADE');
  await pool.query('INSERT INTO businesses VALUES($1),($2)',[businessId,otherBusiness]);
  await pool.query("INSERT INTO branches VALUES($1,$2,'Centro'),($3,$4,'Otra')",[branchId,businessId,otherBranch,otherBusiness]);
  await pool.query("INSERT INTO staff_users VALUES($1,$2,NULL,'Dueña','OWNER',true),($3,$2,$4,'Ana','CASHIER',true),($5,$6,$7,'Otro','CASHIER',true)",[ownerId,businessId,staffId,branchId,otherStaff,otherBusiness,otherBranch]);
 });
 it('requires live owner membership and bounded positive integer budgets',async()=>{
  await assert.rejects(grant({staff}),{statusCode:403});
  for(const changes of [{perActionPoints:0},{totalPoints:59},{totalPoints:1.5},{action:'refund_cash'},{endsAt:new Date(Date.now()+32*86400000).toISOString()},{branchId:otherBranch},{staffId:otherStaff}])await assert.rejects(grant(changes));
  await pool.query("UPDATE staff_users SET role='CASHIER' WHERE id=$1",[ownerId]);await assert.rejects(grant(),{statusCode:403});assert.equal(await count('staff_service_grants'),0);
 });
 it('creates one grant for concurrent identical owner requests and lost-response retries',async()=>{
  const terms={requestId:randomUUID(),startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()};
  const results=await Promise.all(Array.from({length:5},(_,index)=>grant({...terms,requestId:index%2?terms.requestId.toUpperCase():terms.requestId})));
  assert.ok(results.every(result=>result.grant.id===results[0].grant.id));assert.equal(results.filter(result=>!result.replay).length,1);
  assert.equal(await count('staff_service_grants'),1);assert.equal(await count('audit_logs'),1);
  await consume();const replay=await grant(terms);assert.equal(replay.replay,true);assert.equal(replay.grant.remaining_points,60);
  await service.revokeServiceGrant({businessId,staff:owner,grantId:results[0].grant.id},deps);
  const revoked=await grant(terms);assert.ok(revoked.grant.revoked_at);assert.equal(await count('staff_service_grants'),1);
 });
 it('rejects changed creation terms with a reused request id without altering the first grant',async()=>{
  const terms={requestId:randomUUID(),startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()};
  const initial=await grant(terms);
  for(const change of [{perActionPoints:59},{totalPoints:101},{branchId:null},{startsAt:new Date(Date.now()-2000).toISOString()},{endsAt:new Date(Date.now()+7200000).toISOString()}])await assert.rejects(grant({...terms,...change}),{statusCode:409});
  assert.equal(await count('staff_service_grants'),1);const row=(await pool.query('SELECT * FROM staff_service_grants WHERE id=$1',[initial.grant.id])).rows[0];assert.equal(row.per_action_points,60);assert.equal(row.total_points,100);assert.equal(row.creation_request_id,terms.requestId);
  await assert.rejects(pool.query('UPDATE staff_service_grants SET creation_request_id=$2 WHERE id=$1',[row.id,randomUUID()]),/immutable/);
 });
 it('serializes conflicting concurrent creation requests without replacing accepted terms',async()=>{
  const terms={requestId:randomUUID(),startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()};
  const results=await Promise.allSettled([grant({...terms,totalPoints:100}),grant({...terms,totalPoints:200})]);
  const accepted=results.filter(result=>result.status==='fulfilled'),rejected=results.filter(result=>result.status==='rejected');
  assert.equal(accepted.length,1);assert.equal(rejected.length,1);assert.equal(rejected[0].reason.statusCode,409);
  assert.equal(await count('staff_service_grants'),1);assert.equal(await count('audit_logs'),1);
  assert.equal((await pool.query('SELECT total_points FROM staff_service_grants')).rows[0].total_points,accepted[0].value.grant.total_points);
 });
 it('requires a creation request UUID and rolls back its reservation with audit failure',async()=>{
  await assert.rejects(grant({requestId:null}),{statusCode:400});await assert.rejects(grant({requestId:'invalid'}),{statusCode:400});
  const terms={requestId:randomUUID(),startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()};
  await pool.query("CREATE OR REPLACE FUNCTION test_grant_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER test_grant_audit_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_grant_audit_fail()");
  try{await assert.rejects(grant(terms),/audit unavailable/);assert.equal(await count('staff_service_grants'),0);}finally{await pool.query('DROP TRIGGER test_grant_audit_fail ON audit_logs; DROP FUNCTION test_grant_audit_fail()');}
  assert.equal((await grant(terms)).replay,false);assert.equal(await count('staff_service_grants'),1);
 });
 it('consumes once under concurrent retries and rejects changed request payload',async()=>{
  const created=await grant();const requestId=randomUUID();const results=await Promise.all(Array.from({length:5},()=>consume({requestId})));
  assert.ok(results.every(row=>row.grantId===created.grant.id&&row.remainingPoints===60));assert.equal(results.filter(row=>!row.replay).length,1);assert.equal(await count('staff_service_usage'),1);
  await assert.rejects(consume({requestId,points:41}),{statusCode:409});assert.equal(await count('audit_logs'),2);
 });
 it('treats mixed-case UUID retries as the same request under concurrency',async()=>{
  await grant();const requestId=randomUUID();const results=await Promise.all([consume({requestId}),consume({requestId:requestId.toUpperCase()})]);assert.equal(results[0].usageId,results[1].usageId);assert.equal(await count('staff_service_usage'),1);
 });
 it('rechecks expiry after waiting for a grant row lock',async()=>{
  const created=await grant({endsAt:new Date(Date.now()+400).toISOString()});const locker=await pool.connect();try{await locker.query('BEGIN');await locker.query('SELECT id FROM staff_service_grants WHERE id=$1 FOR UPDATE',[created.grant.id]);const attempt=assert.rejects(consume(),{statusCode:403});await locker.query('SELECT pg_sleep(0.55)');await locker.query('COMMIT');await attempt;assert.equal(await count('staff_service_usage'),0);}finally{await locker.query('ROLLBACK');locker.release();}
 });
 it('observes revocation that commits while consumption waits for the grant',async()=>{
  const created=await grant();const locker=await pool.connect();try{await locker.query('BEGIN');await locker.query('UPDATE staff_service_grants SET revoked_at=clock_timestamp(),revoked_by_staff_id=$2 WHERE id=$1',[created.grant.id,ownerId]);const attempt=assert.rejects(consume(),{statusCode:403});await locker.query('SELECT pg_sleep(0.05)');await locker.query('COMMIT');await attempt;assert.equal(await count('staff_service_usage'),0);}finally{await locker.query('ROLLBACK');locker.release();}
 });
 it('serializes simultaneous unique requests without exceeding the total',async()=>{
  await grant();const results=await Promise.allSettled(Array.from({length:4},()=>consume()));assert.equal(results.filter(row=>row.status==='fulfilled').length,2);assert.equal(await count('staff_service_usage'),2);
  assert.equal((await pool.query('SELECT used_points FROM staff_service_grants')).rows[0].used_points,80);
 });
 it('rejects over-per-action, inactive, foreign, stale branch and unsupported roles',async()=>{
  await grant();await assert.rejects(consume({points:61}),{statusCode:403});
  await assert.rejects(consume({businessId:otherBusiness}),{statusCode:403});
  for(const sql of ["UPDATE staff_users SET active=false WHERE id=$1","UPDATE staff_users SET active=true,branch_id=NULL WHERE id=$1","UPDATE staff_users SET branch_id=$2,role='VIEWER' WHERE id=$1"]){await pool.query(sql,sql.includes('$2')?[staffId,branchId]:[staffId]);await assert.rejects(consume(),{statusCode:403});}
  assert.equal(await count('staff_service_usage'),0);
 });
 it('honors revocation, expiry and future windows using live time, not caller time',async()=>{
  const created=await grant();await service.revokeServiceGrant({businessId,staff:owner,grantId:created.grant.id},deps);await assert.rejects(consume(),{statusCode:403});
  await grant({startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+7200000).toISOString()});await assert.rejects(consume({now:new Date(Date.now()+4000000)}),{statusCode:403});
  await pool.query("UPDATE staff_service_grants SET starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour' WHERE revoked_at IS NULL");await assert.rejects(consume({now:new Date(Date.now()-4000000)}),{statusCode:403});
 });
 it('owner bypass still checks live membership and records impersonation',async()=>{
  const result=await consume({staff:{...owner,impersonated_by:'support@example.test'}});assert.equal(result.owner,true);assert.equal(result.grantId,null);
  const audit=(await pool.query("SELECT meta FROM audit_logs WHERE action='staff.authority.consume'")).rows[0].meta;assert.equal(audit.impersonated_by_super_admin_email,'support@example.test');
  await pool.query('UPDATE staff_users SET active=false WHERE id=$1',[ownerId]);await assert.rejects(consume({staff:owner}),{statusCode:403});
 });
 it('lets an owner restore a legitimate high point-cost redemption without delegation caps',async()=>{const result=await consume({staff:owner,points:150000});assert.equal(result.owner,true);assert.equal(await count('staff_service_usage'),1);});
 it('rolls budget, usage and caller work back if audit fails',async()=>{
  await grant();await pool.query("CREATE OR REPLACE FUNCTION test_authority_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$; CREATE TRIGGER test_authority_audit_fail BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_authority_audit_fail()");
  try{await assert.rejects(transaction(async client=>{await client.query("UPDATE staff_users SET name='Must roll back' WHERE id=$1",[staffId]);return service.consumeServiceAllowance(client,{businessId,staff,action:'restore_redemption',points:40,requestId:randomUUID()});}),/audit unavailable/);assert.equal((await pool.query('SELECT name FROM staff_users WHERE id=$1',[staffId])).rows[0].name,'Ana');assert.equal(await count('staff_service_usage'),0);assert.equal((await pool.query('SELECT used_points FROM staff_service_grants')).rows[0].used_points,0);}finally{await pool.query('DROP TRIGGER test_authority_audit_fail ON audit_logs; DROP FUNCTION test_authority_audit_fail()');}
 });
 it('returns only own relevant authority and immutable history',async()=>{
  await grant();await consume();const result=await service.getOwnServiceAuthority({businessId,staff},deps);assert.equal(result.grants.length,1);assert.equal(result.grants[0].remaining_points,60);
  await assert.rejects(pool.query('UPDATE staff_service_usage SET points=1'),/immutable/);await assert.rejects(pool.query('DELETE FROM staff_service_usage'),/immutable/);
 });
 it('supports branch-scoped authority and briefings with SELECT-only branch access',async()=>{
  await pool.query(`GRANT USAGE ON SCHEMA app TO staff_delegation_test_app;
   GRANT SELECT,UPDATE ON businesses,staff_users TO staff_delegation_test_app;
   REVOKE ALL ON branches FROM staff_delegation_test_app;
   GRANT SELECT ON branches TO staff_delegation_test_app;
   GRANT SELECT,INSERT,UPDATE ON staff_service_grants,staff_shift_notices TO staff_delegation_test_app;
   GRANT SELECT,INSERT ON staff_service_usage,staff_shift_acknowledgements TO staff_delegation_test_app;
   GRANT INSERT ON audit_logs TO staff_delegation_test_app;`);
  const restricted={transaction:fn=>transaction(async client=>{
   await client.query('SET LOCAL ROLE staff_delegation_test_app');
   await client.query("SELECT set_config('app.current_tenant',$1,true)",[businessId]);
   const permissions=(await client.query("SELECT has_table_privilege(current_user,'branches','SELECT') AS can_read,has_table_privilege(current_user,'branches','UPDATE') AS can_update")).rows[0];
   assert.equal(permissions.can_read,true);assert.equal(permissions.can_update,false);return fn(client);
  })};
  const created=await service.createServiceGrant({requestId:randomUUID(),businessId,staff:owner,staffId,branchId,action:'restore_redemption',perActionPoints:60,totalPoints:100,startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()},restricted);
  assert.equal(created.grant.branch_id,branchId);
  const notice=await service.publishShiftNotice({businessId,staff:owner,title:'Aviso de sucursal',body:'Confirma la entrega antes de cerrar.',branchId,expiresAt:new Date(Date.now()+86400000).toISOString()},restricted);
  assert.equal(notice.notice.branch_id,branchId);
  assert.equal((await service.getOwnServiceAuthority({businessId,staff},restricted)).grants.length,1);
  assert.equal((await service.getShiftBriefing({businessId,staff},restricted)).notices.length,1);
  await service.acknowledgeShiftNotice({businessId,staff,noticeId:notice.notice.id,version:1},restricted);
  assert.equal((await service.getShiftBriefing({businessId,staff},restricted)).notices.length,0);
  const used=await restricted.transaction(client=>service.consumeServiceAllowance(client,{businessId,staff,action:'restore_redemption',points:40,requestId:randomUUID()}));
  assert.equal(used.grantId,created.grant.id);assert.equal(used.remainingPoints,60);
 });
 it('forces RLS and blocks cross-tenant reads and inserts under application role',async()=>{
  await grant();await pool.query('GRANT USAGE ON SCHEMA app TO staff_delegation_test_app; GRANT SELECT,INSERT ON staff_service_grants,staff_service_usage,staff_shift_notices,staff_shift_acknowledgements TO staff_delegation_test_app');
  const client=await pool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE staff_delegation_test_app');await client.query("SELECT set_config('app.current_tenant',$1,true)",[otherBusiness]);assert.equal((await client.query('SELECT * FROM staff_service_grants')).rowCount,0);await assert.rejects(client.query("INSERT INTO staff_shift_notices(id,business_id,title,body,created_by_staff_id,updated_by_staff_id,expires_at) VALUES($1,$2,'Aviso','Texto',$3,$3,now()+interval '1 day')",[randomUUID(),businessId,ownerId]),/row-level security/);}finally{await client.query('ROLLBACK');client.release();}
  const forced=await pool.query("SELECT relforcerowsecurity FROM pg_class WHERE relname IN ('staff_service_grants','staff_service_usage','staff_shift_notices','staff_shift_acknowledgements')");assert.ok(forced.rows.every(row=>row.relforcerowsecurity));
 });
 it('acknowledges only an exact current seen version and shows later changes again',async()=>{
  const notice=await service.publishShiftNotice({businessId,staff:owner,title:'Turno de hoy',body:'Confirmar el código antes de entregar.',branchId,expiresAt:new Date(Date.now()+86400000).toISOString()},deps);
  let briefing=await service.getShiftBriefing({businessId,staff},deps);assert.equal(briefing.notices.length,1);
  await assert.rejects(service.acknowledgeShiftNotice({businessId,staff,noticeId:notice.notice.id,version:2},deps),{statusCode:409});
  await service.acknowledgeShiftNotice({businessId,staff,noticeId:notice.notice.id,version:1},deps);assert.equal((await service.getShiftBriefing({businessId,staff},deps)).notices.length,0);
  await service.publishShiftNotice({businessId,staff:owner,noticeId:notice.notice.id,expectedVersion:1,title:'Turno de hoy',body:'Consultar al dueño si el código no coincide.',branchId,expiresAt:new Date(Date.now()+86400000).toISOString()},deps);
  briefing=await service.getShiftBriefing({businessId,staff},deps);assert.equal(briefing.notices[0].version,2);assert.equal(await count('staff_shift_acknowledgements'),1);
  await assert.rejects(service.acknowledgeShiftNotice({businessId,staff,noticeId:notice.notice.id,version:1},deps),{statusCode:409});
 });
 it('keeps the active notice bound when an expired notice is republished',async()=>{
  const input={businessId,staff:owner,title:'Aviso',body:'Texto del turno.',expiresAt:new Date(Date.now()+86400000).toISOString()};
  const expired=await service.publishShiftNotice(input,deps);await pool.query("UPDATE staff_shift_notices SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[expired.notice.id]);
  for(let i=0;i<10;i++)await service.publishShiftNotice(input,deps);
  await assert.rejects(service.publishShiftNotice({...input,noticeId:expired.notice.id,expectedVersion:1},deps),{statusCode:400});
 });
 it('does not expose irrelevant, expired or foreign notices or accept their acknowledgements',async()=>{
  const notice=await service.publishShiftNotice({businessId,staff:owner,title:'Aviso',body:'Texto breve',branchId,expiresAt:new Date(Date.now()+86400000).toISOString()},deps);
  await pool.query('UPDATE staff_users SET branch_id=NULL WHERE id=$1',[staffId]);assert.equal((await service.getShiftBriefing({businessId,staff:{...staff,branch_id:null}},deps)).notices.length,0);
  await assert.rejects(service.acknowledgeShiftNotice({businessId,staff:{...staff,branch_id:null},noticeId:notice.notice.id,version:1},deps),{statusCode:404});
  await assert.rejects(service.publishShiftNotice({businessId,staff:owner,title:'Cliente',body:'Llama al 5555-1234',expiresAt:new Date(Date.now()+86400000).toISOString()},deps),{statusCode:400});
 });
});
