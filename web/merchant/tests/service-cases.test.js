import assert from 'node:assert/strict';
import { it } from 'node:test';
it('demo cases retain evidence and resolve only local versioned state',async()=>{
 const module=await import('../src/demo-service-cases.js').catch(()=>null);assert.equal(typeof module?.demoServiceCases,'function');const api=(path,body)=>module.demoServiceCases(new URL(`https://demo.invalid/api/admin/service-cases${path}`),body?{method:'POST',body:JSON.stringify(body)}:{});
 const list=api('');assert.ok(list.cases.length>0);const original=list.cases.find(row=>row.redemption_id);assert.equal(original.evidence.promise_terms,null);
 const body={requestId:'demo-request',version:original.version,resolution:'points_restored',reason:'No se entregó.',attested:false};const result=api(`/${original.id}/resolve`,body);assert.equal(result.case.status,'resolved');assert.equal(api(`/${original.id}/resolve`,body).replay,true);assert.throws(()=>api(`/${original.id}/resolve`,{...body,requestId:'another'}),/cambió|resuelto/);
 const detail=api(`/${original.id}`);assert.equal(detail.events.length,2);assert.deepEqual(detail.case.evidence,original.evidence);
 const failed=api('').cases.find(row=>!row.redemption_id);assert.throws(()=>api(`/${failed.id}/resolve`,{...body,requestId:'failed',version:1}),/canje/);
});
