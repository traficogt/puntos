import assert from 'node:assert/strict';
import {before,after,beforeEach,describe,it} from 'node:test';
import pg from 'pg';
const url=process.env.LAUNCH_TEST_DB_URL;
const suite=url?describe:describe.skip;
let pool,service;
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',staff='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
const deps=()=>({transaction,getPlanFeatureOverrides:async()=>({})});
suite('guided setup with disposable PostgreSQL',()=>{
 before(async()=>{const parsed=new URL(url);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.pathname,'/launch_test');pool=new pg.Pool({connectionString:url,max:6});await pool.query(`CREATE TABLE IF NOT EXISTS businesses(id uuid PRIMARY KEY,plan text,program_type text,program_json jsonb);CREATE TABLE IF NOT EXISTS audit_logs(id uuid,business_id uuid,actor_type text,actor_id uuid,action text,ip text,ua text,meta jsonb);`);service=await import('../../src/app/services/merchant-launch-service.js');});
 after(async()=>{await pool?.end();});
 beforeEach(async()=>{await pool.query('TRUNCATE businesses,audit_logs');await pool.query("INSERT INTO businesses VALUES($1,'NEGOCIO','SPEND',$2)",[id,JSON.stringify({points_per_q:0.1,round:'ceil',lifecycle:{birthday_enabled:false},pos_integration:{enabled:false},custom:{keep:true}})]);});
 async function input(){return {...(await service.getLaunchProgram({businessId:id},pool.query.bind(pool))).program,rate:0.2};}
 const save=input=>service.updateLaunchProgram({businessId:id,staffId:staff,input},deps());
 it('concurrent basic updates accept one version and reject the stale writer',async()=>{const body=await input();const out=await Promise.allSettled([save(body),save({...body,rate:0.3})]);assert.equal(out.filter(v=>v.status==='fulfilled').length,1);const rejected=out.find(v=>v.status==='rejected');assert.equal(rejected.reason.statusCode,409);assert.equal((await pool.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,1);});
 it('updates only selected basic keys and returns no secrets',async()=>{const body=await input();await pool.query(`UPDATE businesses SET program_json=program_json||' {"lifecycle":{"birthday_points":40},"external_awards":{"api_key":"sensitive"}}'::jsonb`);const out=await save(body);const row=(await pool.query('SELECT program_json FROM businesses')).rows[0].program_json;assert.equal(row.lifecycle.birthday_points,40);assert.equal(row.custom.keep,true);assert.equal(row.pos_integration.enabled,false);assert.equal(row.external_awards.api_key,'sensitive');assert.ok(!JSON.stringify(out).includes('sensitive'));});
 it('audit failure rolls back the rule change',async()=>{const body=await input();await pool.query("ALTER TABLE audit_logs ADD CONSTRAINT audit_test_fail CHECK(action<>'program.launch.basics.update')");try{await assert.rejects(save(body));assert.equal((await service.getLaunchProgram({businessId:id},pool.query.bind(pool))).program.rate,0.1);}finally{await pool.query('ALTER TABLE audit_logs DROP CONSTRAINT audit_test_fail');}});
 it('wrong tenant cannot edit another business',async()=>{await assert.rejects(service.updateLaunchProgram({businessId:staff,staffId:staff,input:await input()},deps()),e=>e instanceof Error && 'statusCode' in e && e.statusCode===404);assert.equal((await pool.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,0);});
});
