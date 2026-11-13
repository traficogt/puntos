import assert from 'node:assert/strict';import {it} from 'node:test';
import {buildDecisions,operatingMode} from '../../src/app/services/merchant-decisions-model.js';
const now=new Date('2026-11-11T18:00:00Z');
const operations={sections:[{id:'messaging',state:'needs_attention',title:'Mensajes',summary:'Hay un envío incierto.',metrics:[{key:'uncertain',value:1}],reasons:[{code:'uncertain',count:1}],action:{href:'#ofertas',label:'Revisar envíos'}}]};
it('uses stable evidence fingerprints, and new counts resurface reviewed issues',()=>{
 const a=buildDecisions({operations,now}),b=buildDecisions({operations,now:new Date('2026-11-12T18:00:00Z')});assert.equal(a[0].fingerprint,b[0].fingerprint);
 const changed=structuredClone(operations);changed.sections[0].metrics[0].value=2;assert.notEqual(a[0].fingerprint,buildDecisions({operations:changed,now})[0].fingerprint);
 const reviewed=buildDecisions({operations,now,reviews:[{decision_key:a[0].key,evidence_fingerprint:a[0].fingerprint,status:'reviewed',version:1}]});assert.equal(reviewed[0].review_state,'reviewed');
 const resurfaced=buildDecisions({operations:changed,now,reviews:[{decision_key:a[0].key,evidence_fingerprint:a[0].fingerprint,status:'reviewed',version:1}]});assert.equal(resurfaced[0].review_state,'open');
});
it('prioritizes data and unresolved service cases, and snooze never says repaired',()=>{
 const inputs={operations,now,readiness:{state:'blocked',reason:'sync_stale',summary:'Datos atrasados',last_completed_at:'2026-11-09T18:00:00Z',action:{href:'#conectar-caja',label:'Revisar caja'}},cases:{open:2,oldest_at:'2026-11-09T12:00:00Z'}};
 const all=buildDecisions(inputs);assert.equal(all[0].key,'data-freshness');assert.equal(all[1].key,'service-cases');
 const snoozed=buildDecisions({...inputs,reviews:[{decision_key:all[0].key,evidence_fingerprint:all[0].fingerprint,status:'snoozed',snoozed_until:'2026-11-11T19:00:00Z',version:1}]});assert.equal(snoozed[0].review_state,'snoozed');assert.equal(snoozed[0].resolved,undefined);
});
it('a snooze expires and changing evidence overrides a snooze',()=>{
 const all=buildDecisions({operations,now});const review={decision_key:all[0].key,evidence_fingerprint:all[0].fingerprint,status:'snoozed',snoozed_until:now.toISOString(),version:2};assert.equal(buildDecisions({operations,now,reviews:[review]})[0].review_state,'open');
});
it('operating mode has a version and expires without extending itself on reads',()=>{
 const b={program_json:{merchant_operating_mode:{mode:'busy',until:'2026-11-11T19:00:00Z'}}};const busy=operatingMode(b,now);assert.equal(busy.mode,'busy');assert.match(busy.version,/^[a-f0-9]{64}$/);assert.equal(operatingMode(b,new Date('2026-11-11T19:00:00Z')).mode,'normal');assert.equal(operatingMode(b,new Date('2026-11-11T19:00:00Z')).version,busy.version);
});

it('quiet mode expires and exposes a versioned capacity without changing earned benefits',()=>{
 const business={program_json:{merchant_operating_mode:{mode:'quiet',until:'2026-11-11T19:00:00Z',capacity:12}}};
 assert.equal(operatingMode(business,now).mode,'quiet');assert.equal(operatingMode(business,now).capacity,12);
 assert.equal(operatingMode(business,new Date('2026-11-11T19:00:00Z')).mode,'normal');
 assert.notEqual(operatingMode(business,now).version,operatingMode({program_json:{merchant_operating_mode:{...business.program_json.merchant_operating_mode,capacity:13}}},now).version);
});
it('dismissal is evidence-bound, assignment survives changed evidence and cost stays explicitly unknown',()=>{
 const first=buildDecisions({operations,now})[0];
 const review={decision_key:first.key,evidence_fingerprint:first.fingerprint,status:'dismissed',version:2,dismiss_reason:'Contact confirmed',assigned_staff_id:'staff-1',assigned_staff_name:'Ana'};
 const item=buildDecisions({operations,now,reviews:[review]})[0];
 assert.equal(item.review_state,'dismissed');assert.equal(item.dismiss_reason,'Contact confirmed');assert.equal(item.assigned_staff_id,'staff-1');assert.equal(item.impact.cost_state,'unknown');
 const changed=structuredClone(operations);changed.sections[0].metrics[0].value=2;
 const reopened=buildDecisions({operations:changed,now,reviews:[review]})[0];assert.equal(reopened.review_state,'open');assert.equal(reopened.assigned_staff_id,'staff-1');assert.equal(reopened.evidence_changed,true);
});

it('accepts review identities for every operational section including Wallet',async()=>{
 const {ReviewDecisionInput}=await import('../../src/app/services/merchant-decisions-service.js');
 for(const id of ['pos','messaging','apple_wallet','google_wallet','economics']){
  const [decision]=buildDecisions({operations:{sections:[{...operations.sections[0],id}]},now});
  assert.equal(ReviewDecisionInput.safeParse({decision_key:decision.key,fingerprint:decision.fingerprint,version:0,status:'reviewed'}).success,true,id);
 }
});

it('merges outcome actions without duplicating costs and preserves review state across refreshes',()=>{
 const outcomes=[{key:'operation-economics',priority:20,title:'Costs',explanation:'Missing',evidence:{missing:2},action:{href:'#costos',label:'Costs'}},
  {key:'hospitality-unused',priority:30,title:'Unused',explanation:'Two unused',evidence:{unused:2},action:{href:'#cortesias',label:'Review'},observed_at:now.toISOString(),period:{days:30}}];
 const ops={sections:[{id:'economics',state:'needs_attention',title:'Costs',summary:'Current and historical coverage',metrics:[],action:{href:'#costos',label:'Costs'}}]};
 const a=buildDecisions({operations:ops,outcomes,now});
 assert.equal(a.filter(x=>x.key==='operation-economics').length,1);assert.equal(a.length,2);
 const item=a.find(x=>x.key==='hospitality-unused');assert.equal(item.observed_at,now.toISOString());
 const b=buildDecisions({operations:ops,outcomes:outcomes.map(x=>({...x,observed_at:'2026-11-11T18:05:00Z'})),now,reviews:[{decision_key:item.key,evidence_fingerprint:item.fingerprint,status:'reviewed',version:1}]});
 assert.equal(b.find(x=>x.key===item.key).review_state,'reviewed');
});
