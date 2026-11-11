import test from 'node:test';
import assert from 'node:assert/strict';
test('demo acquisition has honest synthetic metrics and creates stable local links without network',async()=>{
  const {demoAcquisition,demoAcquisitionSources}=await import('../src/demo-acquisition.js');
  const get=()=>demoAcquisition(new URL('https://demo.test/api/admin/acquisition'));
  const before=get();assert.equal(before.sources.length,2);assert.ok(before.definitions.visits.includes('personas únicas'));
  const body=JSON.stringify({name:'Mesa demo',branch_id:null,request_id:'11111111-1111-4111-8111-111111111111'});
  const create=()=>demoAcquisition(new URL('https://demo.test/api/admin/acquisition/sources'),{method:'POST',body});
  const first=create();assert.deepEqual(create(),first);assert.equal(get().sources.length,3);
  assert.match(first.source.registration_url,/\/demostracion#marca$/);
  assert.equal(demoAcquisitionSources().at(0).name,'Mesa demo');
  assert.throws(()=>demoAcquisition(new URL('https://demo.test/api/admin/acquisition/sources'),{method:'POST',body:JSON.stringify({name:'No',branch_id:'foreign',request_id:'other'})}));
  assert.throws(()=>demoAcquisition(new URL('https://demo.test/api/admin/acquisition/unsupported')));
});
