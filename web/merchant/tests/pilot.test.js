import test from 'node:test';
import assert from 'node:assert/strict';
import { demoApi } from '../src/demo-api.js';
import { pilotReport } from '../src/pilot-model.js';
import { buildPosHandoff } from '../src/pos-handoff-model.js';
const base='/api/admin/pilots';
const send=(url,method,body)=>demoApi(url,{method,body:JSON.stringify(body)});
test('pilot preview completes the full checklist locally with stable create retries and equal comparison windows',async()=>{
 const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Unexpected real request');};
 try{
 const body={request_id:crypto.randomUUID(),name:'Piloto ficticio',duration_days:14,pos_profile:{vendor:'Odoo',pos_version:'18.0',module_version:'18.0.2.0.0',deployment:'self_hosted'}};
 const first=await send(base,'POST',body),id=first.pilot.id;
 assert.equal((await send(base,'POST',body)).pilot.id,id);
 await assert.rejects(send(base,'POST',{...body,name:'Different'}),/otros datos/);
 await assert.rejects(send(base,'POST',{...body,request_id:crypto.randomUUID()}),/activo/);
 await assert.rejects(send(`${base}/${id}/close`,'POST',{outcome:'completed',note:''}),/pruebas/);
 await assert.rejects(send(`${base}/${id}/checks/purchase`,'PUT',{status:'not_applicable',note:'Not used'}),/prueba/);
 for(const c of (await demoApi(`${base}/${id}`)).checks)await send(`${base}/${id}/checks/${c.key}`,'PUT',{status:c.required?'passed':'not_applicable',note:'Comprobación ficticia sin datos personales.'});
 await send(`${base}/${id}/close`,'POST',{outcome:'completed',note:'Conclusión ficticia'});
 const detail=await demoApi(`${base}/${id}`),p=detail.results.period;
 assert.equal(detail.pilot.status,'completed');assert.equal(detail.pilot.checklist_version,2);assert.deepEqual(detail.pilot.pos_profile,body.pos_profile);assert.equal(detail.checks.length,13);assert.equal(Date.parse(p.end)-Date.parse(p.start),Date.parse(p.previous_end)-Date.parse(p.previous_start));
 assert.equal(detail.results.current.purchases,0);
 await assert.rejects(send(`${base}/${id}/checks/purchase`,'PUT',{status:'failed',note:'Change'}),/cerrado/);
 const report=pilotReport({...detail,pilot:{...detail.pilot,business_id:'private-business',created_by_staff_id:'private-staff'},checks:detail.checks.map(c=>({...c,updated_by_staff_id:'private-staff'}))});
 assert.equal(report.pilot.checklist_version,2);assert.deepEqual(report.pilot.pos_profile,body.pos_profile);assert.doesNotMatch(JSON.stringify(report),/private-business|private-staff/);assert.ok(report.checks.every(c=>c.evidence_type==='owner_reported'));assert.match(report.notice,/no certifican/);
 }finally{globalThis.fetch=oldFetch;}
});
test('stopping a failed pilot requires a conclusion and allows a new trial',async()=>{
 const a=await send(base,'POST',{request_id:crypto.randomUUID(),name:'Con problemas',duration_days:30});
 await send(`${base}/${a.pilot.id}/checks/purchase`,'PUT',{status:'failed',note:'Saldo no esperado en la prueba.'});
 await assert.rejects(send(`${base}/${a.pilot.id}/close`,'POST',{outcome:'stopped',note:''}),/conclusión/);
 await send(`${base}/${a.pilot.id}/close`,'POST',{outcome:'stopped',note:'Revisar antes de intentar otra vez.'});
 const b=await send(base,'POST',{request_id:crypto.randomUUID(),name:'Segundo intento',duration_days:60});assert.notEqual(a.pilot.id,b.pilot.id);
 await send(`${base}/${b.pilot.id}/close`,'POST',{outcome:'stopped',note:'Fin de fixture.'});
});
test('POS handoff preserves current connector limits and excludes arbitrary credential fields',()=>{
 const doc=buildPosHandoff({vendor:'Prueba\nProveedor',version:'17',deployment:'Servidor propio',capability:'API',apiKey:'private-key-not-for-export',customerPhone:'private-phone'});
 assert.match(doc,/Sistema: Prueba Proveedor/);assert.match(doc,/POST https:\/\/app.puntosfieles.com\/api\/public\/pos\//);assert.match(doc,/\/refunds/);assert.match(doc,/"scope": "full"/);assert.match(doc,/Las parciales, las no verificadas y las que requieren revisión quedan pendientes/);assert.match(doc,/No es sincronización continua/);assert.doesNotMatch(doc,/private-key-not-for-export|private-phone/);
});

test('the legacy demo pilot keeps its original checklist',async()=>{
 const detail=await demoApi(`${base}/demo-pilot-finished`);
 assert.equal(detail.pilot.checklist_version,1);assert.equal(detail.checks.length,9);assert.equal(detail.pilot.pos_profile,null);
});
