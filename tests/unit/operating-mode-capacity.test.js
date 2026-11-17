import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {OperatingModeInput,setOperatingMode} from '../../src/app/services/merchant-decisions-service.js';
import {operatingMode} from '../../src/app/services/merchant-decisions-model.js';

const now=new Date('2026-11-16T18:00:00Z');
function fixture(stored){
 const business={id:randomUUID(),program_json:{preserved:true,...(stored?{merchant_operating_mode:stored}:{})}};
 const client={query:async(sql,params=[])=>{
  if(sql.startsWith('SELECT id,program_json FROM businesses'))return {rows:[structuredClone(business)]};
  if(sql.startsWith('SELECT * FROM operating_mode_changes'))return {rows:[]};
  if(sql.startsWith('UPDATE businesses SET program_json')){business.program_json={...business.program_json,merchant_operating_mode:JSON.parse(params[1])};return {rows:[structuredClone(business)]};}
  if(sql.startsWith('INSERT INTO'))return {rows:[]};
  throw new Error(`Unexpected SQL: ${sql}`);
 }};
 const save=(input,extra={})=>setOperatingMode({businessId:business.id,staffId:randomUUID(),input:OperatingModeInput.parse(input),...extra},{transaction:fn=>fn(client),now:()=>now});
 return {business,save,version:()=>operatingMode(business,now).version};
}

test('operating mode input accepts an explicit null capacity (sin límite)',()=>{
 const version='a'.repeat(64);
 assert.equal(OperatingModeInput.safeParse({mode:'normal',version,capacity:null}).success,true);
 assert.equal(OperatingModeInput.safeParse({mode:'normal',version,capacity:12}).success,true);
 assert.equal(OperatingModeInput.safeParse({mode:'normal',version,capacity:201}).success,false);
});

test('omitting capacity keeps the stored value and never invents one',async()=>{
 const limited=fixture({mode:'normal',until:null,capacity:12});
 await limited.save({mode:'quiet',minutes:60,version:limited.version()});
 assert.equal(limited.business.program_json.merchant_operating_mode.capacity,12);
 const unlimited=fixture();
 await unlimited.save({mode:'quiet',minutes:60,version:unlimited.version()});
 assert.equal(unlimited.business.program_json.merchant_operating_mode.capacity,null);
 assert.equal(operatingMode(unlimited.business,now).capacity,null);
 assert.equal(unlimited.business.program_json.preserved,true);
});

test('an owner can clear a stored capacity back to sin límite',async()=>{
 const f=fixture({mode:'normal',until:null,capacity:0});
 const out=await f.save({mode:'normal',version:f.version(),capacity:null});
 assert.equal(f.business.program_json.merchant_operating_mode.capacity,null);
 assert.equal(out.operating_mode.capacity,null);
});

test('delegated staff cannot clear the owner capacity either',async()=>{
 const f=fixture({mode:'normal',until:null,capacity:12});
 await assert.rejects(f.save({mode:'normal',version:f.version(),capacity:null},{delegated:true}),{statusCode:403});
 assert.equal(f.business.program_json.merchant_operating_mode.capacity,12);
});
