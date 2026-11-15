import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../../../public/pilot-checklists.js';
import {pilotReport} from '../src/pilot-model.js';

const none={wallet:false,promotional_messaging:false,pos:false};
const all={wallet:true,promotional_messaging:true,pos:true};
const channels={wallet:'wallet_installation',promotional_messaging:'message_delivery',pos:'pos_installation'};

test('version 3 requires phone ownership separately from promotional messages and selected capabilities',()=>{
 assert.equal(model.currentPilotChecklistVersion,3);
 const core=model.pilotChecksForVersion(3,none);
 assert.equal(core.length,11);
 assert.ok(core.every(c=>c.required));
 assert.ok(core.some(c=>c.key==='enrollment'));
 assert.ok(core.some(c=>c.key==='phone_ownership'));
 assert.ok(core.every(c=>!Object.values(channels).includes(c.key)));
 for(const [capability,key] of Object.entries(channels)){
  const checks=model.pilotChecksForVersion(3,{...none,[capability]:true});
  assert.equal(checks.length,12);
  assert.equal(checks.find(c=>c.key===key)?.required,true);
 }
 assert.equal(model.pilotChecksForVersion(3,all).length,14);
 assert.throws(()=>model.pilotChecksForVersion(3),/configuración/i);
});

test('versions 1 and 2 preserve historical optional channels and original requirements',()=>{
 for(const [version,total,required] of [[1,9,6],[2,13,10]]){
  const checks=model.pilotChecksForVersion(version,all);
  assert.equal(checks.length,total);
  assert.equal(checks.filter(c=>c.required).length,required);
  assert.equal(checks.some(c=>c.key==='phone_ownership'),false);
  for(const key of Object.values(channels))assert.equal(checks.find(c=>c.key===key)?.required,false);
 }
});

test('completeness counts persisted owner attestations without treating missing, failed or skipped selected checks as passed',()=>{
 assert.equal(typeof model.pilotChecklistCompleteness,'function');
 const checks=model.pilotChecksForVersion(3,all).map(c=>({...c,status:'passed'}));
 assert.deepEqual(model.pilotChecklistCompleteness(3,all,checks),{
  required_total:14,required_passed:14,unresolved_checks:[],complete:true
 });
 for(const status of ['pending','failed','not_applicable',undefined]){
  const rows=checks.filter(c=>c.key!=='wallet_installation');
  if(status)rows.push({key:'wallet_installation',status,required:false});
  const result=model.pilotChecklistCompleteness(3,all,rows);
  assert.equal(result.complete,false);
  assert.equal(result.required_passed,13);
  assert.deepEqual(result.unresolved_checks,['wallet_installation']);
 }
 const legacy=model.pilotChecksForVersion(2).map(c=>({...c,status:c.required?'passed':'not_applicable'}));
 assert.equal(model.pilotChecklistCompleteness(2,null,legacy).complete,true);
});

test('version 3 report separates the frozen scope and computed completeness from owner attestations',()=>{
 const detail={pilot:{checklist_version:3,capabilities:all,pos_profile:null,name:'Fixture',status:'active'},
  checks:[{key:'purchase',label:'Compra',required:true,status:'passed',note:'Declaración',evidence_type:'owner_reported',updated_by_staff_id:'private-staff'}],
  checklist_evidence:{evidence_type:'server_computed',scope:'recorded_checklist_completeness',required_total:14,required_passed:1,unresolved_checks:['enrollment'],complete:false},
  results:{provenance:{evidence_type:'server_computed',source:'pf_recorded_activity'}}};
 const report=pilotReport(detail);
 assert.equal(report.format,'puntosfieles-pilot-report-v3');
 assert.deepEqual(report.pilot.capabilities,all);
 assert.deepEqual(report.checklist_evidence,detail.checklist_evidence);
 assert.equal(report.checks[0].evidence_type,'owner_reported');
 assert.doesNotMatch(JSON.stringify(report),/private-staff/);
 assert.match(report.notice,/dispositivos|proveedores/);
 const legacy=pilotReport({...detail,pilot:{...detail.pilot,checklist_version:2}});
 assert.equal(legacy.format,'puntosfieles-pilot-report-v2');
 assert.equal('capabilities' in legacy.pilot,false);
 assert.doesNotMatch(legacy.notice,/canales no seleccionados/i);
});
