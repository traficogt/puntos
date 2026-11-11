import assert from 'node:assert/strict';
import { before, it } from 'node:test';
let demo,practice;
before(async()=>{
 const d=await import('../src/demo-staff-delegation.js').catch(()=>null);assert.equal(typeof d?.demoStaffDelegation,'function','isolated delegation demo exists');demo=d.demoStaffDelegation;
 const p=await import('../../../public/staff/service-briefing.js').catch(()=>null);assert.equal(typeof p?.createPracticeSession,'function','local practice exists');practice=p.createPracticeSession;
});
const url=path=>new URL(`/api/admin/${path}`,'https://demo.invalid');
it('demonstrates grants, revocation and versioned notices without network traffic',async()=>{
 const prior=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Demo must not send requests');};
 try{
  const initial=demo(url('staff-authority'));assert.ok(initial.staff.length);const person=initial.staff[0];
  const grant=demo(url('staff-authority'),{method:'POST',body:JSON.stringify({request_id:crypto.randomUUID(),staff_id:person.id,branch_id:null,action:'restore_redemption',per_action_points:25,total_points:100,starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+3600000).toISOString()})}).grant;
  assert.equal(grant.remaining_points,100);demo(url(`staff-authority/${grant.id}/revoke`),{method:'POST',body:'{}'});assert.ok(demo(url('staff-authority')).grants.find(row=>row.id===grant.id).revoked_at);
  const notice=demo(url('shift-notices'),{method:'POST',body:JSON.stringify({title:'Nueva regla',body:'Consulta el código.',branch_id:null,expires_at:new Date(Date.now()+3600000).toISOString()})}).notice;
  const edited=demo(url(`shift-notices/${notice.id}`),{method:'PUT',body:JSON.stringify({title:'Regla actualizada',body:'Confirma la entrega.',branch_id:null,expires_at:new Date(Date.now()+3600000).toISOString(),expected_version:1})});assert.equal(edited.notice.version,2);assert.equal(edited.notice.acknowledgements,0);
 }finally{globalThis.fetch=prior;}
});
it('demo retries preserve one grant and reject changed terms with the same request id',()=>{
 const person=demo(url('staff-authority')).staff[0],before=demo(url('staff-authority')).grants.length;
 const terms={request_id:crypto.randomUUID(),staff_id:person.id,branch_id:null,action:'restore_redemption',per_action_points:25,total_points:100,starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+3600000).toISOString()};
 const first=demo(url('staff-authority'),{method:'POST',body:JSON.stringify(terms)}),retry=demo(url('staff-authority'),{method:'POST',body:JSON.stringify(terms)});
 assert.equal(first.grant.id,retry.grant.id);assert.equal(retry.replay,true);assert.equal(demo(url('staff-authority')).grants.length,before+1);
 assert.throws(()=>demo(url('staff-authority'),{method:'POST',body:JSON.stringify({...terms,total_points:200})}),/referencia/);
 assert.throws(()=>demo(url('staff-authority'),{method:'POST',body:JSON.stringify({...terms,request_id:undefined})}),/referencia/);
});
it('practice uses only safe base program values and keeps fictional earn, redeem and correction local',()=>{
 const prior=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Practice must not send requests');};
 try{
  const session=practice({program_type:'SPEND',program_json:{points_per_q:0.5,round:'floor',secret:'never expose'}},[{id:'coffee',name:'Café',points_cost:50,active:true}]);
  assert.equal(session.earn({amount:25}),12);assert.equal(session.snapshot().points,212);session.redeem('coffee');assert.equal(session.snapshot().points,162);session.correct();assert.equal(session.snapshot().points,212);assert.throws(()=>session.correct(),/canje/);assert.ok(!JSON.stringify(session.snapshot()).includes('secret'));
  assert.throws(()=>session.earn({amount:-1}),/válido/);session.reset();assert.equal(session.snapshot().points,200);
 }finally{globalThis.fetch=prior;}
});
it('practice validates unknown settings and rewards, never fabricating a program rule',()=>{
 assert.throws(()=>practice({program_type:'UNKNOWN',program_json:{}}),/configuración/);
 assert.throws(()=>practice({program_type:'SPEND',program_json:{points_per_q:Infinity}}),/configuración/);
 const visit=practice({program_type:'VISIT',program_json:{points_per_visit:10}});assert.equal(visit.earn({visits:2}),20);assert.throws(()=>visit.earn({visits:0.5}),/entero/);assert.throws(()=>visit.redeem('foreign'),/recompensa/);
 const item=practice({program_type:'ITEM',program_json:{points_per_item:2}});assert.equal(item.earn({items:3}),6);
});
