import {test} from 'node:test';import assert from 'node:assert/strict';
import {approvalCapacity,capacityField,operatingModeBody} from '../src/operating-controls-model.js';
import {dataHealthBody,expectedMinutes,saveErrorMessage} from '../src/data-health-model.js';
import {regionalToday} from '../src/region.js';
const version='a'.repeat(64);
test('a null operating capacity stays sin límite and is not sent unless changed',()=>{
 assert.equal(capacityField(null),'');assert.equal(capacityField(undefined),'');assert.equal(capacityField(12),12);
 assert.deepEqual(operatingModeBody({mode:'quiet',minutes:'60',capacity:'',current:{capacity:null,version}}),{ok:true,body:{mode:'quiet',version,minutes:60}});
 assert.deepEqual(operatingModeBody({mode:'normal',minutes:'60',capacity:12,current:{capacity:12,version}}),{ok:true,body:{mode:'normal',version}});
 assert.deepEqual(operatingModeBody({mode:'normal',minutes:'60',capacity:15,current:{capacity:12,version}}).body,{mode:'normal',version,capacity:15});
});
test('clearing the field sends an explicit null and an empty field is never coerced to zero',()=>{
 assert.deepEqual(operatingModeBody({mode:'normal',minutes:'60',capacity:'',current:{capacity:12,version}}).body,{mode:'normal',version,capacity:null});
 assert.deepEqual(operatingModeBody({mode:'normal',minutes:'60',capacity:'',current:{capacity:0,version}}).body,{mode:'normal',version,capacity:null});
 assert.deepEqual(operatingModeBody({mode:'normal',minutes:'60',capacity:0,current:{capacity:0,version}}).body,{mode:'normal',version},'an unchanged older value is not re-validated');
 for(const capacity of [0,201,2.5,'abc'])assert.equal(operatingModeBody({mode:'normal',minutes:'60',capacity,current:{capacity:null,version}}).ok,false,String(capacity));
});
test('template approval needs an explicit capacity instead of inventing one',()=>{
 for(const value of ['',null,undefined,0,201])assert.equal(approvalCapacity(value),null,String(value));
 assert.equal(approvalCapacity(20),20);assert.equal(approvalCapacity('20'),20);
});
test('data-health deadlines are validated locally and never sent as empty strings',()=>{
 const row={id:'a',source:'mi-pos',label:'Caja',branch_id:null,enabled:true};
 assert.equal(expectedMinutes(''),null);assert.equal(expectedMinutes(4),null);assert.equal(expectedMinutes(10081),null);assert.equal(expectedMinutes('60'),60);
 const blocked=dataHealthBody(version,[{...row,expected_minutes:''}]);assert.equal(blocked.ok,false);assert.match(blocked.message,/Caja/);
 assert.deepEqual(dataHealthBody(version,[{...row,expected_minutes:'90'}]),{ok:true,body:{version,sources:[{...row,expected_minutes:90}]}});
});
test('save errors show the server message and conflicts keep local edits',()=>{
 assert.equal(saveErrorMessage({status:400,message:'Revisa las conexiones, sucursales y plazos.'}),'Revisa las conexiones, sucursales y plazos.');
 assert.match(saveErrorMessage({status:409,message:'La configuración cambió.'},{refreshed:true}),/Conservamos tus cambios/);
 assert.match(saveErrorMessage({status:409,message:'La configuración cambió.'}),/^La configuración cambió\./);
 assert.match(saveErrorMessage(new TypeError('Failed to fetch')),/conexión/);
});
test('today is the business calendar day, not the UTC date',()=>{
 const evening=new Date('2026-11-17T03:00:00Z');
 assert.equal(regionalToday(evening,'America/Guatemala'),'2026-11-16');
 assert.equal(regionalToday(evening,'UTC'),'2026-11-17');
 assert.equal(regionalToday(evening),'2026-11-16','defaults to the Guatemala business region');
});
test('owner screens use the null-safe capacity, version and local-date helpers',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=name=>readFile(new URL(`../src/${name}`,import.meta.url),'utf8');
 const controls=await source('OperatingControls.jsx'),health=await source('DataHealth.jsx'),funding=await source('SupplierFunding.jsx');
 assert.doesNotMatch(controls,/capacity:Number\(capacity\)|capacity\?\?10|useState\(\/\*\* @type \{number \| string\} \*\/ \(10\)\)/);
 assert.match(controls,/operatingModeBody\(/);assert.match(controls,/capacity:approvalCapacity\(capacity\)/);
 assert.match(health,/dataHealthBody\(version,sources\)/);assert.doesNotMatch(health,/version:resource\.data\.version/);
 assert.doesNotMatch(funding,/new Date\(\)\.toISOString\(\)\.slice\(0,10\)/);assert.match(funding,/max=\{regionalToday\(\)\}/);
});
