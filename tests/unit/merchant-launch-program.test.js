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
test('basic editor accepts a member discount program and validates its percentage',()=>{
 const base={program_type:'DISCOUNT',percent_off:10,version:'a'.repeat(64)};
 assert.equal(LaunchProgramInput.safeParse(base).success,true);
 for(const patch of [{percent_off:0},{percent_off:-5},{percent_off:101},{percent_off:undefined},{percent_off:'10'},{lifecycle:{birthday_enabled:true}}]) assert.equal(LaunchProgramInput.safeParse({...base,...patch}).success,false);
});
test('launch view exposes the member discount percentage and a null rate for a discount program',()=>{
 const b={id:'business',plan:'NEGOCIO',program_type:'DISCOUNT',program_json:{percent_off:15}};
 const v=programBasics(b);
 assert.equal(v.program_type,'DISCOUNT');assert.equal(v.rate,null);assert.equal(v.percent_off,15);assert.match(v.version,/^[a-f0-9]{64}$/);
});
test('a save switches a program to a member discount, persists only the percentage, and preserves other config',async()=>{
 const b=row(),version=programBasics(b).version;let writes=0,audits=0;
 const query=async(sql,params)=>{if(sql.startsWith('SELECT'))return {rows:[b]};if(sql.startsWith('UPDATE')){writes++;Object.assign(b,{program_type:params[1],program_json:{...b.program_json,...JSON.parse(params[2])}});return {rows:[b]};}audits++;assert.ok(sql.includes('audit_logs'));return {rows:[]};};
 const result=await updateLaunchProgram({businessId:b.id,staffId:'owner',input:{program_type:'DISCOUNT',percent_off:12,version}},{transaction:fn=>fn({query}),getPlanFeatureOverrides:async()=>({})});
 assert.equal(writes,1);assert.equal(audits,1);
 assert.equal(result.program.program_type,'DISCOUNT');assert.equal(result.program.percent_off,12);assert.equal(result.program.rate,null);
 assert.equal(b.program_json.percent_off,12);assert.equal(b.program_json.external_awards.api_key,'private');assert.equal(b.program_json.campaign_rules.length,1);
});
test('a save switches a program to a stamp card, gives the default 2-stamp head start, and auto-creates the free-item reward',async()=>{
 const base={program_type:'STAMP',stamps_required:10,reward_label:'Cafe gratis',version:'a'.repeat(64)};
 assert.equal(LaunchProgramInput.safeParse(base).success,true);
 for(const patch of [{stamps_required:undefined},{reward_label:undefined},{reward_label:'  '},{stamps_required:1},{head_start:10},{head_start:12}]) assert.equal(LaunchProgramInput.safeParse({...base,...patch}).success,false);
 const b=row();const rewards=[];
 const query=async(sql,params)=>{
  if(sql.startsWith('SELECT'))return {rows:[b]};
  if(sql.startsWith('INSERT INTO rewards')){rewards.push({id:params[0],name:params[2],points_cost:params[4],active:true});return {rows:[{id:params[0]}]};}
  if(sql.startsWith('UPDATE rewards')){const r=rewards.find(x=>x.id===params[0]);if(r){if(sql.includes('active=false'))r.active=false;else{r.active=true;r.name=params[2];r.points_cost=params[4];}}return {rows:r?[{id:r.id}]:[]};}
  if(sql.startsWith('UPDATE businesses')&&sql.includes('program_type')){Object.assign(b,{program_type:params[1],program_json:{...b.program_json,...JSON.parse(params[2])}});return {rows:[b]};}
  if(sql.startsWith('UPDATE businesses')){b.program_json={...b.program_json,...JSON.parse(params[1])};return {rows:[b]};}
  assert.ok(sql.includes('audit_logs'));return {rows:[]};
 };
 const deps={transaction:fn=>fn({query}),getPlanFeatureOverrides:async()=>({})};
 const result=await updateLaunchProgram({businessId:b.id,staffId:'owner',input:{program_type:'STAMP',stamps_required:10,reward_label:'Cafe gratis',version:programBasics(b).version}},deps);
 assert.equal(result.program.program_type,'STAMP');assert.equal(result.program.stamps_required,10);
 assert.equal(result.program.head_start,2);assert.equal(result.program.reward_label,'Cafe gratis');assert.equal(result.program.rate,null);
 assert.equal(b.program_json.stamps_required,10);assert.equal(b.program_json.head_start,2);
 assert.equal(b.program_json.external_awards.api_key,'private');assert.equal(b.program_json.campaign_rules.length,1);
 // free item auto-created costing the real purchases (10 - 2 = 8), linked for idempotent edits
 assert.equal(rewards.length,1);assert.equal(rewards[0].points_cost,8);assert.equal(rewards[0].name,'Cafe gratis');assert.equal(b.program_json.stamp_reward_id,rewards[0].id);
 // editing the card resizes the SAME reward (members keep their progress); no duplicate
 await updateLaunchProgram({businessId:b.id,staffId:'owner',input:{program_type:'STAMP',stamps_required:12,reward_label:'Cafe gratis',version:programBasics(b).version}},deps);
 assert.equal(rewards.length,1);assert.equal(rewards[0].points_cost,10);
 // switching away retires the auto reward
 await updateLaunchProgram({businessId:b.id,staffId:'owner',input:{program_type:'SPEND',rate:0.1,round:'ceil',version:programBasics(b).version}},deps);
 assert.equal(rewards[0].active,false);
});
