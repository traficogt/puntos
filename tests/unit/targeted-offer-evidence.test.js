import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimTargetedOffer } from '../../src/app/services/targeted-offer-service.js';
import { completeAwardEvidence, evaluatePointRules } from '../../src/app/services/transaction-rule-evidence.js';

const business = { id:'11111111-1111-4111-8111-111111111111', plan:'EMPRESA', program_json:{ targeted_offers_enabled:true, private:'PRIVATE_CONFIG' } };
const committed = { id:'22222222-2222-4222-8222-222222222222', bonus_points:7, minimum_purchase_q:'15.00', starts_at:'2026-11-11T16:00:00.000001Z', expires_at:'2026-11-12T16:00:00.000002Z', points_budget:21, points_committed:14, evaluated_at:'2026-11-11T18:00:00.000003Z', private:'PRIVATE_CAMPAIGN' };
test('targeted claim returns only the locked and evaluated terms used to reserve its bonus', async()=>{
  const client = { query:async sql=>{
    if(sql.includes('FROM businesses'))return{rows:[business]};
    if(sql.includes('SELECT g.id'))return{rows:[{id:committed.id,bonus_points:7}]};
    if(sql.includes('SELECT m.id'))return{rows:[{id:'member'}]};
    if(sql.includes('UPDATE growth_campaigns'))return{rows:[committed],rowCount:1};
    return{rows:[],rowCount:1};
  } };
  const bonus = await claimTargetedOffer({client,business,customerId:'customer',transactionId:'transaction',source:'offline',amountQ:20,visits:1,items:0,basePoints:10,planFeatureOverrides:{}});
  assert.equal(bonus.bonusPoints,7);
  assert.deepEqual(bonus.criteria,{
    schema_version:1,clock:'database',evaluated_at:committed.evaluated_at,
    minimum_purchase_q:15,starts_at:committed.starts_at,expires_at:committed.expires_at,
    points_budget:21,points_committed_before:7,points_committed_after:14,
    eligibility:{campaign_active:true,saved_membership:'treatment',unclaimed_before_award:true,customer_not_deleted:true,program_enabled_at_request:true,plan_features_allowed:true},
    purchase:{amount_q:20,visits:1,items:0,source:'offline'}
  });
  const evaluated=evaluatePointRules({program_json:{points_per_q:0.5}},{amount_q:20},{now:new Date('2026-11-11T18:00:00Z'),timeZone:'America/Guatemala'});
  const evidence=completeAwardEvidence(evaluated.evidence,{bonus,holdDays:0,status:'POSTED',availableAt:null});
  assert.deepEqual(evidence.targeted_offer.criteria,bonus.criteria);
  assert.equal(evidence.awarded_points,17);
  bonus.criteria.minimum_purchase_q=999;
  assert.equal(evidence.targeted_offer.criteria.minimum_purchase_q,15,'evidence must own a detached snapshot');
  assert.equal(JSON.stringify(evidence).includes('PRIVATE'),false);
});
test('historical or injected bonus without evaluated terms stays explicitly unknown',()=>{
  const evaluated=evaluatePointRules({}, {amount_q:20}, {now:new Date('2026-11-11T18:00:00Z'),timeZone:'UTC'});
  const evidence=completeAwardEvidence(evaluated.evidence,{bonus:{bonusPoints:7,campaignId:committed.id},holdDays:0,status:'POSTED',availableAt:null});
  assert.equal(evidence.targeted_offer.criteria,'not_snapshotted');
});
