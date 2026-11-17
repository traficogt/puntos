import assert from 'node:assert/strict';
import {test} from 'node:test';
test('demand topics normalize accents and spaces without changing original notes',async()=>{
 const {normalizeDemand}=await import('../../src/app/services/demand-funding-model.js');
 const a=normalizeDemand({category:'product',topic:'  Café   sin azúcar ',note:'Preferiría otra opción.'});
 const b=normalizeDemand({category:'product',topic:'cafe sin azucar',note:'Otra opinión.'});
 assert.equal(a.topicKey,b.topicKey);assert.equal(a.topic,'Café sin azúcar');assert.equal(a.note,'Preferiría otra opción.');
 assert.throws(()=>normalizeDemand({category:'invented',topic:'Café'}),{statusCode:400});
});
test('supplier transitions require recorded supplier response and exact reconciliation',async()=>{
 const {validateClaimTransition}=await import('../../src/app/services/demand-funding-model.js');
 assert.throws(()=>validateClaimTransition({status:'draft',amount_minor:500}, {status:'paid',reference:'Pago real',paid_minor:500}),{statusCode:409});
 assert.throws(()=>validateClaimTransition({status:'approved',amount_minor:500}, {status:'paid',reference:'Pago real',paid_minor:400}),{statusCode:400});
 assert.throws(()=>validateClaimTransition({status:'submitted',amount_minor:500},{status:'approved',reference:''}),{statusCode:400});
 assert.equal(validateClaimTransition({status:'approved',amount_minor:500},{status:'paid',reference:'Transferencia 123',paid_minor:500,paid_at:'2026-11-12'}).reference,'Transferencia 123');
});
test('supplier payment rejects impossible calendar dates as input errors',async()=>{
 const {validateClaimTransition}=await import('../../src/app/services/demand-funding-model.js');
 for(const paid_at of ['2026-00-12','2026-13-12','2026-11-00','2026-11-32','2025-02-29']){
  assert.throws(()=>validateClaimTransition({status:'approved',amount_minor:500},{status:'paid',reference:'Transferencia 123',paid_minor:500,paid_at}),{statusCode:400},paid_at);
 }
 assert.equal(validateClaimTransition({status:'approved',amount_minor:500},{status:'paid',reference:'Transferencia 123',paid_minor:500,paid_at:'2024-02-29'}).paid_at,'2024-02-29');
});
test('supplier export has a fixed privacy allowlist and escapes spreadsheet formulas',async()=>{
 const {supplierExport}=await import('../../src/app/services/demand-funding-model.js');
 const csv=supplierExport([{id:'claim',supplier_name:'=CMD()',agreement_title:'Coffee',reward_name:'Café',amount_minor:500,currency:'GTQ',status:'paid',fulfilled_at:'2026-11-12',customer_id:'secret-id',customer_name:'Secret person',evidence:{customer_id:'secret'}}]);
 assert.ok(csv.includes("'=CMD()"));assert.ok(!csv.includes('secret'));assert.ok(!csv.includes('Secret'));assert.ok(csv.includes('amount_minor'));
});
test('supplier payment dates use the business calendar day, not the UTC date',async()=>{
 const {validateClaimTransition}=await import('../../src/app/services/demand-funding-model.js');
 const row={status:'approved',amount_minor:500},input=paid_at=>({status:'paid',reference:'Transferencia 123',paid_minor:500,paid_at});
 // 2026-11-16 21:00 in Guatemala is already 2026-11-17 in UTC.
 const now=new Date('2026-11-17T03:00:00Z');
 assert.throws(()=>validateClaimTransition(row,input('2026-11-17'),{now,timezone:'America/Guatemala'}),{statusCode:400});
 assert.throws(()=>validateClaimTransition(row,input('2026-11-17'),{now}),{statusCode:400},'Guatemala is the default business timezone');
 assert.equal(validateClaimTransition(row,input('2026-11-16'),{now,timezone:'America/Guatemala'}).paid_at,'2026-11-16');
 assert.equal(validateClaimTransition(row,input('2026-11-17'),{now,timezone:'UTC'}).paid_at,'2026-11-17');
});
