import test from 'node:test';
import assert from 'node:assert/strict';
import { demoApi } from '../src/demo-api.js';
test('growth demo simulates queue without transport and preserves original campaign results', async () => {
 const original=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Unexpected network');};
 try {
  const {campaigns}=await demoApi('/api/admin/growth-campaigns'),id=campaigns[0].id;
  const before=await demoApi(`/api/admin/growth-campaigns/${id}`);
  const body=JSON.stringify({confirm:true,request_id:crypto.randomUUID()});
  const first=await demoApi(`/api/admin/growth-campaigns/${id}/messages/queue`,{method:'POST',body});
  const retry=await demoApi(`/api/admin/growth-campaigns/${id}/messages/queue`,{method:'POST',body});
  assert.equal(first.queued_count,12);assert.equal(retry.queued_count,0);assert.equal(retry.counts.accepted,0);
  const after=(await demoApi(`/api/admin/growth-campaigns/${id}`)).results;
  assert.ok(Date.parse(after.measurement.as_of)>=Date.parse(before.results.measurement.as_of));
  assert.equal(after.measurement.window.observed_until,after.measurement.as_of);
  const stable=result=>({...result,measurement:{...result.measurement,as_of:null,window:{...result.measurement.window,observed_until:null}}});
  assert.deepEqual(stable(after),stable(before.results));
 }finally{globalThis.fetch=original;}
});
