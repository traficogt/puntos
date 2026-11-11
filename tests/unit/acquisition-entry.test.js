import test from 'node:test';
import assert from 'node:assert/strict';
test('enrollment source capability stays in memory and only follows registration verification',async()=>{
  const {enrollmentAcquisition}=await import('../../public/acquisition-entry.js');
  const calls=[];
  const api=async(path,options)=>{calls.push([path,JSON.parse(options.body)]);return {visit_token:'A'.repeat(43)};};
  for(const params of [{mode:'login',search:'?origen=abcdefghijklmnop'},{mode:'register',search:''},{mode:'register',search:'?origen=invalid'},{mode:'register',search:'?origen=abcdefghijklmnop&origen=other'}]) assert.deepEqual(await enrollmentAcquisition({...params,slug:'one',api}),{});
  assert.deepEqual(calls,[]);
  assert.deepEqual(await enrollmentAcquisition({mode:'register',slug:'one',search:'?origen=abcdefghijklmnop',api}),{visitToken:'A'.repeat(43)});
  assert.deepEqual(calls,[['/api/public/business/one/acquisition/visit',{source_code:'abcdefghijklmnop'}]]);
  assert.deepEqual(await enrollmentAcquisition({mode:'register',slug:'one',search:'?origen=abcdefghijklmnop',api:async()=>{throw new Error('offline');}}),{});
  assert.deepEqual(await enrollmentAcquisition({mode:'register',slug:'one',search:'?origen=abcdefghijklmnop',api:async()=>({visit_token:'invalid'})}),{});
});
