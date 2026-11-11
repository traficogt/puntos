import assert from 'node:assert/strict';
import {it} from 'node:test';
import * as weekly from '../../src/app/services/weekly-owner-brief-service.js';
import * as second from '../../src/app/services/second-visit-service.js';
it('defaults new owner briefing accounts to email while preserving legacy phone opt-ins',()=>{
 assert.equal(weekly.weeklyBriefChannel({program_json:{}}),'email');
 assert.equal(weekly.weeklyBriefChannel({program_json:{weekly_owner_brief:{owner_id:'old',settings:{enabled:true}}}}),'phone');
});
it('derives a reviewed second-visit proposal from actual rewards and earning settings',()=>{
 const proposal=second.recommendSecondVisit({program_type:'SPEND',program_json:{points_per_q:0.1}},[{id:'r',name:'Café',points_cost:100}],0.2);
 assert.equal(proposal.settings.enabled,false);assert.equal(proposal.settings.bonus_points,10);
 assert.equal(proposal.maximum_points_commitment,200);assert.equal(proposal.estimated_cost,40);
 assert.equal(proposal.settings.minimum_purchase_q,null,'purchase minimum needs an owner decision, not an invented basket');
 assert.equal(proposal.source.reward_points,100);assert.equal(proposal.source.earning_rate,0.1);
});
it('makes missing reward, earning and cost assumptions explicit and respects configured purchase guard',()=>{
 assert.equal(second.recommendSecondVisit({program_type:'SPEND',program_json:{}},[],null).settings,null);
 const p=second.recommendSecondVisit({program_type:'VISIT',program_json:{points_per_visit:8,award_guard:{max_points_per_tx:12}}},[{id:'r',points_cost:500}],null);
 assert.equal(p.settings.bonus_points,4);assert.equal(p.estimated_cost,null);assert.equal(p.cost_state,'unknown');
 assert.equal(second.recommendSecondVisit({program_type:'VISIT',program_json:{points_per_visit:8,award_guard:{max_points_per_tx:8}}},[{points_cost:100}],0).settings,null);
});

it('sends email only through explicit SMTP acceptance and preserves uncertain outcomes',async()=>{
 const {sendOwnerBriefEmail}=await import('../../src/app/services/owner-brief-email-service.js');
 const {MessageProviderError}=await import('../../src/app/services/messaging/providers/http-provider.js');
 let input={strictAcceptance:false,destinations:{phone:'unset'}};const accepted=await sendOwnerBriefEmail({to:'owner@example.invalid',body:'sample'},{provider:{canSend:()=>true,send:async v=>{input=v;return{ok:true,providerId:'receipt'};}}});
 assert.ok(input);assert.equal(input.strictAcceptance,true);assert.equal(accepted.accepted,true);assert.equal(input.destinations.phone,null);
 const rejected=await sendOwnerBriefEmail({to:'owner@example.invalid',body:'sample'},{provider:{canSend:()=>true,send:async()=>{throw new MessageProviderError('REJECTED',false);}}});assert.equal(rejected.definiteFailure,true);
 const uncertain=await sendOwnerBriefEmail({to:'owner@example.invalid',body:'sample'},{provider:{canSend:()=>true,send:async()=>{throw Error('timeout');}}});assert.equal(uncertain.definiteFailure,false);
});

it('reserves one configured item before proposing a bonus and leaves spend semantics unchanged',()=>{
 const item={program_type:'ITEM',program_json:{points_per_item:10,award_guard:{max_points_per_tx:12}}};
 const proposal=second.recommendSecondVisit(item,[{id:'reward',points_cost:100}],null);
 assert.equal(proposal.settings.bonus_points,2);
 assert.equal(second.recommendSecondVisit({...item,program_json:{...item.program_json,award_guard:{max_points_per_tx:10}}},[{points_cost:100}],null).settings,null);
 const spend={program_type:'SPEND',program_json:{points_per_q:10,award_guard:{max_points_per_tx:12}}};
 assert.equal(second.recommendSecondVisit(spend,[{points_cost:100}],null).settings.bonus_points,10);
});
