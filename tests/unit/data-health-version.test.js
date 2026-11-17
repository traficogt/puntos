import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {getDataHealth,recordDataHeartbeat,saveDataHealth} from '../../src/app/services/data-health-service.js';

function fixture(){
 const monitor=randomUUID(),business={id:randomUUID(),slug:'cafe',program_json:{data_health:{sources:[{id:monitor,source:'mi-pos',label:'Caja',branch_id:null,expected_minutes:60,enabled:true,last_heartbeat:null}]}}};
 const client={query:async(sql,params=[])=>{
  if(sql.startsWith('SELECT id,slug,program_json FROM businesses')||sql.startsWith('SELECT id,program_json FROM businesses'))return {rows:[structuredClone(business)]};
  if(sql.startsWith('UPDATE businesses SET program_json=jsonb_set')){business.program_json={...business.program_json,data_health:JSON.parse(params[1])};return {rows:[]};}
  if(sql.startsWith('SELECT id FROM branches')||sql.startsWith('SELECT id,name FROM branches'))return {rows:[]};
  if(sql.includes('FROM ingestion_health_events')||sql.startsWith('INSERT INTO'))return {rows:[]};
  throw new Error(`Unexpected SQL: ${sql}`);
 }};
 const now=new Date('2026-11-16T18:00:00Z');
 const deps={query:client.query,transaction:fn=>fn(client),now:()=>now};
 return {business,monitor,deps,now};
}

test('integration heartbeats do not change the owner settings version',async()=>{
 const {business,monitor,deps}=fixture();
 const before=await getDataHealth({businessId:business.id},deps);
 await recordDataHeartbeat(business,{request_id:randomUUID(),monitor_id:monitor,coverage_through:'2026-11-16T17:30:00Z',status:'complete',pending:0,errors:0},deps);
 assert.ok(business.program_json.data_health.sources[0].last_heartbeat,'fixture stored the heartbeat');
 const after=await getDataHealth({businessId:business.id},deps);
 assert.equal(after.version,before.version);
});

test('an owner can save with the version read before a heartbeat arrived and the heartbeat is kept',async()=>{
 const {business,monitor,deps}=fixture();
 const read=await getDataHealth({businessId:business.id},deps);
 await recordDataHeartbeat(business,{request_id:randomUUID(),monitor_id:monitor,coverage_through:'2026-11-16T17:45:00Z',status:'complete',pending:0,errors:0},deps);
 const sources=read.sources.map(({id,source,label,branch_id,enabled})=>({id,source,label,branch_id,expected_minutes:120,enabled}));
 const saved=await saveDataHealth({businessId:business.id,staffId:randomUUID(),input:{version:read.version,sources}},deps);
 assert.equal(saved.ok,true);
 assert.equal(business.program_json.data_health.sources[0].expected_minutes,120);
 assert.equal(business.program_json.data_health.sources[0].last_heartbeat.coverage_through,'2026-11-16T17:45:00.000Z');
 assert.equal((await getDataHealth({businessId:business.id},deps)).version,saved.version);
});

test('an owner settings change still invalidates an older version',async()=>{
 const {business,deps}=fixture();
 const read=await getDataHealth({businessId:business.id},deps);
 const sources=read.sources.map(({id,source,branch_id,expected_minutes,enabled})=>({id,source,label:'Caja central',branch_id,expected_minutes,enabled}));
 await saveDataHealth({businessId:business.id,input:{version:read.version,sources}},deps);
 await assert.rejects(saveDataHealth({businessId:business.id,input:{version:read.version,sources}},deps),{statusCode:409});
});
