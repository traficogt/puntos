import test from 'node:test';
import assert from 'node:assert/strict';
import { demoGrowth } from '../src/demo-growth.js';
import { demoAudiences } from '../src/demo-audiences.js';
const invoke=(suffix='',body,method='POST')=>demoGrowth(new URL(`https://fixture.invalid/api/admin/growth-campaigns${suffix}`),{method,body:JSON.stringify(body)});
const segment=()=>demoAudiences(new URL('https://fixture.invalid/api/admin/audiences'),{method:'POST',body:JSON.stringify({name:'All members',request_id:crypto.randomUUID(),definition:{window_days:90,include:{match:'all',rules:[{field:'joined_days',operator:'gte',value:0}]},exclude:{match:'any',rules:[]}}})}).segment;
const input=()=>{const a=segment();return {request_id:crypto.randomUUID(),name:'Afternoon',audience_segment_id:a.id,audience_segment_version:a.version,audience_limit:20,bonus_points:50,points_budget:100,minimum_purchase_q:10,duration_minutes:60};};
test('demo quiet offer requires preview and creates an hour-long offer with no control',()=>{
 const {campaign}=invoke('/quiet',input()); assert.equal(campaign.offer_kind,'quiet'); assert.equal(campaign.status,'draft');
 assert.throws(()=>invoke(`/${campaign.id}/activate`,{}),/comprobación/);
 const {preflight}=invoke(`/${campaign.id}/preflight`,{}); assert.equal(preflight.maximum_commitment_points,100); assert.equal(preflight.stacking.targeted_offers_per_purchase,1);
 const out=invoke(`/${campaign.id}/activate`,{preflight_id:preflight.id}); assert.equal(out.campaign.control_count,0);
 assert.equal(Date.parse(out.campaign.expires_at)-Date.parse(out.campaign.starts_at),3600000);
 assert.equal(invoke(`/${campaign.id}`,undefined,'GET').results.estimated_incremental_sales_q,null);
});
test('demo preparation has explicit queued progress and cancellation retains the saved snapshot',()=>{
 const {duration_minutes,...rest}=input(); const {campaign}=invoke('/prepare',{...rest,duration_days:14,holdout_percent:20,audience_limit:5000});
 assert.equal(campaign.preparation_status,'queued'); assert.equal(campaign.member_count,0);
 assert.throws(()=>invoke(`/${campaign.id}/activate`,{}),/preparación/);
 const cancelled=invoke(`/${campaign.id}/preparation/cancel`,{}); assert.equal(cancelled.campaign.preparation_status,'cancelled');
 assert.throws(()=>invoke(`/${campaign.id}/preparation/retry`,{}),/terminó/);
 assert.equal(invoke(`/${campaign.id}`,undefined,'GET').campaign.preparation_status,'cancelled');
});
