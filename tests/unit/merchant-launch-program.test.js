import assert from 'node:assert/strict';
import { test } from 'node:test';
import { programBasics, updateLaunchProgram, LaunchProgramInput } from '../../src/app/services/merchant-launch-service.js';
const row = () => ({ id:'business',plan:'NEGOCIO',program_type:'SPEND',program_json:{points_per_q:0.1,round:'ceil',lifecycle:{birthday_enabled:false},external_awards:{api_key:'private'},campaign_rules:[{id:'existing'}]} });
test('launch view exposes only basic settings and stable conflict version, never integration secrets',()=>{
 const b=row(),v=programBasics(b);assert.equal(v.rate,0.1);assert.equal(v.round,'ceil');assert.match(v.version,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(v).includes('private'));
 b.program_json.lifecycle.birthday_enabled=true;assert.equal(programBasics(b).version,v.version);
 b.program_json.points_per_q=0.2;assert.notEqual(programBasics(b).version,v.version);
});
test('basic editor accepts positive finite earning rules and rejects unknown keys, fractions for visits and blank values',()=>{
 const b={program_type:'SPEND',rate:0.1,round:'ceil',version:'a'.repeat(64)};
 assert.equal(LaunchProgramInput.safeParse(b).success,true);
 for(const patch of [{rate:0},{rate:-1},{rate:Infinity},{rate:'1'},{rate:0.00001},{program_type:'VISIT',rate:1.5},{lifecycle:{birthday_enabled:true}}]) assert.equal(LaunchProgramInput.safeParse({...b,...patch}).success,false);
});
test('a basic save preserves concurrent unrelated configuration and audits the same transaction',async()=>{
 const b=row(),version=programBasics(b).version;let writes=0,audits=0;
 const query=async(sql,params)=>{if(sql.startsWith('SELECT'))return {rows:[b]};if(sql.startsWith('UPDATE')){writes++;Object.assign(b,{program_type:params[1],program_json:{...b.program_json,...JSON.parse(params[2])}});return {rows:[b]};}audits++;assert.ok(sql.includes('audit_logs'));return {rows:[]};};
 b.program_json.lifecycle.birthday_points=40;
 const result=await updateLaunchProgram({businessId:b.id,staffId:'owner',input:{program_type:'VISIT',rate:8,round:'floor',version}},{transaction:fn=>fn({query}),getPlanFeatureOverrides:async()=>({})});
 assert.equal(writes,1);assert.equal(audits,1);assert.equal(result.program.rate,8);assert.equal(b.program_json.round,'ceil');assert.equal(b.program_json.lifecycle.birthday_points,40);assert.equal(b.program_json.external_awards.api_key,'private');assert.equal(b.program_json.campaign_rules.length,1);
});
test('stale edits and removed plan permission are rejected before writes',async()=>{
 for(const kind of ['stale','plan']){const b=row(),input={program_type:'SPEND',rate:2,round:'round',version:programBasics(b).version};if(kind==='stale')b.program_json.points_per_q=3;
 let writes=0;await assert.rejects(updateLaunchProgram({businessId:b.id,staffId:'owner',input},{transaction:fn=>fn({query:async sql=>{if(!sql.startsWith('SELECT'))writes++;return {rows:[b]};}}),getPlanFeatureOverrides:async()=>kind==='plan'?{NEGOCIO:{program_rules:false}}:{}}),e=>e instanceof Error && "statusCode" in e && e.statusCode===(kind==='stale'?409:403));assert.equal(writes,0);}
});
