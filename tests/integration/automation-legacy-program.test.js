import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import {Router} from 'express';
const url=process.env.AUTOMATION_LEGACY_TEST_DATABASE_URL;
test('legacy writes preserve guided automation controls atomically', {skip:!url,timeout:30000},async t=>{
  const parsed=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));assert.equal(parsed.port,'55452');assert.equal(parsed.pathname,'/automation_legacy_test');
  Object.assign(process.env,{NODE_ENV:'test',DB_HOST:parsed.hostname,DB_PORT:parsed.port,DB_NAME:'automation_legacy_test',DB_USER:decodeURIComponent(parsed.username),DB_PASSWORD:decodeURIComponent(parsed.password),DB_PASSWORD_FILE:'',DB_MIGRATIONS_PASSWORD_FILE:'',JWT_SECRET_FILE:'',JWT_SECRET:'legacy-automation-test-123456789'});
  const db=new pg.Client({connectionString:url});await db.connect();
  const database=await import('../../src/app/database.js');
  const {BusinessRepo}=await import('../../src/app/repositories/business-repository.js');
  const {PlanConfigService}=await import('../../src/app/services/plan-config-service.js');
  const {AuditRepo}=await import('../../src/app/repositories/audit-repository.js');
  const {saveAutomationSettings}=await import('../../src/app/services/automation-controls-service.js');
  const {registerProgramConfigRoutes}=await import('../../src/app/routes/admin/program-config-routes.js');
  const {registerProgramCampaignRoutes}=await import('../../src/app/routes/admin/program-campaign-routes.js');
  const {encryptProgramSecrets}=await import('../../src/utils/program-secrets.js');
  const router=Router();registerProgramConfigRoutes(router);registerProgramCampaignRoutes(router);
  t.mock.method(PlanConfigService,'getPlanFeatureOverrides',async()=>({}));
  const bid=crypto.randomUUID(),other=crypto.randomUUID();
  const managed={birthday_monthly_points_cap:200,winback_monthly_points_cap:300,minimum_contact_days:14};
  const settings={...managed,birthday_enabled:true,birthday_points:20,winback_enabled:false,winback_days:30,winback_points:10,scheduler_hour_local:9,scheduler_tz:'America/Guatemala'};
  const initial=encryptProgramSecrets({points_per_q:1,round:'floor',other:{preserve:true},lifecycle:{...settings,suspicious_digest_enabled:true},pos_integration:{revision:7,enabled:true,loyverse:{access_token:'sandbox-legacy-pos-token'}},external_awards:{enabled:true,api_key:'sandbox-legacy-award-key'}});
  const concurrentPatch=encryptProgramSecrets({other:{preserve:true,revision:8},pos_integration:{revision:8,enabled:true,loyverse:{access_token:'sandbox-rotated-pos-token'}},external_awards:{enabled:true,api_key:'sandbox-rotated-award-key'}});
  const ctx=fn=>database.withDbClientContext({tenantId:bid,platformAdmin:false},fn);
  /** @param {Record<string, any>} [program] */
  const reset=(program=initial)=>db.query("UPDATE businesses SET program_type='SPEND',program_json=$2 WHERE id=$1",[bid,program]);
  const read=()=>ctx(()=>BusinessRepo.getById(bid));
  async function handler(path,method,body){
    // Express exposes these runtime route fields without typing its test doubles.
    const layers=/** @type {any[]} */(router.stack);
    const layer=layers.find(item=>item.route?.path===path&&item.route.methods[method]);assert.ok(layer);
    const res={body:null,statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
    await ctx(()=>layer.route.stack.at(-1).handle({tenantId:bid,staff:{id:null,role:'OWNER'},body},res,error=>{throw error;}));assert.equal(res.statusCode,200);return res.body;
  }
  async function guidedFirst(legacyWrite){
    let entered=()=>{},release=()=>{};
    const held=new Promise(resolve=>{entered=()=>resolve(undefined);}),gate=new Promise(resolve=>{release=()=>resolve(undefined);});
    const log=AuditRepo.log;
    const mock=t.mock.method(AuditRepo,'log',async input=>{
      await log(input);
      if(input.action==='automation.settings.updated'){
        await database.dbQuery("UPDATE businesses SET program_type='ITEM',program_json=program_json || $2::jsonb WHERE id=$1",[bid,concurrentPatch]);
        entered();await gate;
      }
    });
    const changed={...settings,birthday_monthly_points_cap:500,winback_monthly_points_cap:600,minimum_contact_days:28};
    const guided=ctx(()=>saveAutomationSettings({businessId:bid,settings:changed}));let legacy;
    try{
      await held;legacy=legacyWrite();let blocked=false;
      for(let i=0;i<200;i++){
        const rows=await db.query("SELECT 1 FROM pg_stat_activity WHERE datname='automation_legacy_test' AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE 'UPDATE businesses%' LIMIT 1");
        if(rows.rowCount){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(blocked,true,'legacy write must wait for the guided row lock');release();await Promise.all([guided,legacy]);
    }finally{release();await guided;await legacy;mock.mock.restore();}
    return changed;
  }
  try{
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS app');
    await db.query("CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_tenant',true),'')::uuid $$; CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.platform_admin',true),'')='true' $$");
    // Fixed repository paths and an asserted disposable database only.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await db.query(await fs.readFile(new URL('../../src/app/schema.sql',import.meta.url),'utf8'));
    await db.query('CREATE UNIQUE INDEX customers_legacy_automation_tenant_id ON customers(business_id,id)');
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await db.query(await fs.readFile(new URL('../../src/app/migrations/2026-11-10-automation-controls.sql',import.meta.url),'utf8'));
    await db.query("INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_json) VALUES($1,'Fixture','legacy-one','legacy-one@example.test','unused','NEGOCIO',$3),($2,'Other','legacy-other','legacy-other@example.test','unused','NEGOCIO','{}')",[bid,other,initial]);
    await t.test('program POST retains omitted controls for object, missing and null lifecycle',async()=>{
      for(const lifecycle of [{birthday_points:5},undefined,null]){
        await reset();await handler('/admin/program','post',{program_type:'VISIT',program_json:{points_per_visit:2,...(lifecycle===undefined?{}:{lifecycle})}});
        const row=await read();for(const [key,value] of Object.entries(managed))assert.equal(row.program_json.lifecycle[key],value);
        assert.equal(row.program_type,'VISIT');assert.equal(row.program_json.points_per_visit,2);assert.equal(row.program_json.round,undefined);assert.equal(row.program_json.pos_integration.revision,7);assert.equal(row.program_json.external_awards.enabled,true);
        assert.equal(row.program_json.lifecycle.birthday_points,20,'basic OWNER save cannot erase lifecycle fields it is not permitted to edit');
        assert.equal(row.program_json.lifecycle.birthday_enabled,true);
      }
    });
    await t.test('repository lifecycle replacement preserves only omitted managed keys',async()=>{
      for(const lifecycle of [{birthday_points:5},null]){
        await reset();await ctx(()=>BusinessRepo.updateProgram(bid,{program_type:'SPEND',program_json:{lifecycle}}));
        const row=await read();for(const [key,value] of Object.entries(managed))assert.equal(row.program_json.lifecycle[key],value);
        assert.equal(row.program_json.lifecycle.birthday_points,lifecycle?5:undefined);
        assert.equal(row.program_json.lifecycle.suspicious_digest_enabled,undefined);
      }
    });
    await t.test('explicit managed values including zero keep the existing contract',async()=>{
      await reset();await ctx(()=>BusinessRepo.updateProgram(bid,{program_type:'SPEND',program_json:{lifecycle:{birthday_monthly_points_cap:0,minimum_contact_days:30}}}));
      const row=await read();assert.equal(row.program_json.lifecycle.birthday_monthly_points_cap,0);assert.equal(row.program_json.lifecycle.minimum_contact_days,30);assert.equal(row.program_json.lifecycle.winback_monthly_points_cap,300);
    });
    await t.test('null stored lifecycle and fresh programs do not invent settings',async()=>{
      await reset({lifecycle:null});await ctx(()=>BusinessRepo.updateProgram(bid,{program_type:'SPEND',program_json:{lifecycle:null}}));assert.equal((await read()).program_json.lifecycle,null);
      await reset({});await ctx(()=>BusinessRepo.updateProgram(bid,{program_type:'SPEND',program_json:{points_per_q:4}}));assert.equal((await read()).program_json.lifecycle,undefined);
    });
    for(const [label,path,method,body] of [
      ['program','/admin/program','post',{program_type:'SPEND',program_json:{points_per_q:9,lifecycle:{birthday_points:7}}}],
      ['template','/admin/automations/template','put',{template:'cafeteria_basico'}],
      ['campaign','/admin/campaign-rules','put',{rules:[{id:'fixture',name:'Fixture',kind:'bonus_points',value:10}]}]
    ])await t.test(`${label} save cannot overwrite concurrent guided controls`,async()=>{
      await reset();const changed=await guidedFirst(()=>handler(path,method,body));const row=await read();
      for(const key of Object.keys(managed))assert.equal(row.program_json.lifecycle[key],changed[key]);
      const stored=(await db.query('SELECT program_json FROM businesses WHERE id=$1',[bid])).rows[0].program_json;
      assert.deepEqual(stored.pos_integration,concurrentPatch.pos_integration,'latest POS state and ciphertext survive the legacy write');
      assert.deepEqual(stored.external_awards,concurrentPatch.external_awards,'latest API credential ciphertext survives the legacy write');
      if(label==='program')assert.equal(row.program_json.points_per_q,9);
      else {assert.equal(row.program_type,'ITEM');assert.deepEqual(row.program_json.other,concurrentPatch.other);}
      if(label==='template'){assert.equal(row.program_json.lifecycle.birthday_points,50);assert.equal(row.program_json.lifecycle.suspicious_digest_enabled,true);}
      if(label==='campaign')assert.equal(row.program_json.campaign_rules[0].value,10);
    });
    await t.test('legacy transaction honors its existing client and rolls back FK insert and update together',async()=>{
      await reset();const peer=new pg.Client({connectionString:url});await peer.connect();
      try{
        await peer.query('BEGIN');await peer.query("INSERT INTO customers(id,business_id,phone) VALUES($1,$2,'50255550001')",[crypto.randomUUID(),bid]);
        await database.runWithDbContext({client:peer,tenantId:bid,platformAdmin:false},()=>BusinessRepo.updateProgram(bid,{program_type:'ITEM',program_json:{points_per_item:8,lifecycle:null}}));
        await peer.query('ROLLBACK');assert.equal((await read()).program_type,'SPEND');assert.equal((await read()).program_json.lifecycle.minimum_contact_days,14);assert.equal((await db.query('SELECT count(*)::int AS n FROM customers')).rows[0].n,0);
      }finally{await peer.query('ROLLBACK');await peer.end();}
      assert.deepEqual((await db.query('SELECT program_json FROM businesses WHERE id=$1',[other])).rows[0].program_json,{});
    });
  }finally{await db.end();await database.closeDatabase();}
});
