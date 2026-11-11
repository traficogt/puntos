import test from 'node:test';
import assert from 'node:assert/strict';
import {demoAutomations} from '../src/demo-automations.js';
const call=(suffix,body,method='GET')=>demoAutomations(new URL(`https://fixture.invalid/api/admin/automations${suffix}`),{method,body:JSON.stringify(body)});
test('second-visit demo begins paused and saves independent bounded settings',()=>{
 const first=call('/second-visit');assert.equal(first.settings.enabled,false);
 const settings={enabled:true,bonus_points:50,minimum_purchase_q:10,duration_days:7,monthly_points_cap:1000,monthly_offer_cap:20};
 call('/second-visit',settings,'PUT');assert.deepEqual(call('/second-visit').settings,settings);
 assert.equal(call('').settings.birthday_enabled,false);
});
test('weekly owner demo previews three findings without sending and never accepts another destination',()=>{
 const initial=call('/owner-brief');assert.equal(initial.settings.enabled,false);
 const preview=call('/owner-brief/preview',{},'POST');assert.equal(preview.findings.length,3);assert.ok(preview.findings.every(f=>f.href.includes('#')));
 assert.equal(call('/owner-brief').history.length,0);
 assert.throws(()=>call('/owner-brief',{enabled:true,weekday:1,hour:9,recipient:'elsewhere'},'PUT'));
 assert.throws(()=>call('/owner-brief',{enabled:true,weekday:1,hour:9},'PUT'));
 call('/owner-brief/email-verification/request',{request_id:'preview-verification'},'POST');call('/owner-brief/email-verification/confirm',{request_id:'preview-verification',token:'a'.repeat(43)},'POST');
 call('/owner-brief',{enabled:true,weekday:1,hour:9},'PUT');assert.equal(call('/owner-brief').settings.enabled,true);assert.equal(call('/owner-brief').history.length,0);
});
test('owner email demo requires verification and explicit idempotent test requests',()=>{
 const account=call('/owner-brief');assert.equal(account.channel,'email');
 const request_id='b1f7a794-0d09-487e-8faf-31ba25c61030';
 const verification=call('/owner-brief/email-verification/request',{request_id},'POST');assert.equal(verification.request_id,request_id);
 call('/owner-brief/email-verification/confirm',{request_id,token:'a'.repeat(43)},'POST');
 assert.equal(call('/owner-brief').email_verified,true);
 call('/owner-brief/test',{request_id},'POST');call('/owner-brief/test',{request_id},'POST');
 assert.equal(call('/owner-brief').history.length,1);assert.equal(call('/owner-brief').history[0].kind,'test');
});
