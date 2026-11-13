import assert from 'node:assert/strict';
import {it} from 'node:test';
import * as completion from '../../src/app/services/service-completion-service.js';
import {normalizeCustomerMigration} from '../../src/app/services/customer-migration-csv.js';
it('rehearsal starts with signup and demonstrates insufficient points before earning from real rules',()=>{
 assert.equal(typeof completion.initialRehearsal,'function','persistent rehearsal engine exists');
 const config={program_type:'VISIT',program_json:{points_per_visit:10},rewards:[{id:'coffee',name:'Café',points_cost:20,active:true,stock:2,available:true,description:'Un café'}]};
 let state=completion.initialRehearsal(config);
 assert.equal(state.points,0);assert.equal(state.signed_up,false);
 assert.throws(()=>completion.applyRehearsalAction(state,{action:'earn',quantity:2}),/inscrip/);
 state=completion.applyRehearsalAction(state,{action:'signup'});
 state=completion.applyRehearsalAction(state,{action:'ineligibility',rewardId:'coffee'});
 assert.equal(state.history.at(-1).outcome,'insufficient_points');
 state=completion.applyRehearsalAction(state,{action:'earn',quantity:2});assert.equal(state.points,20);
 state=completion.applyRehearsalAction(state,{action:'unlock',rewardId:'coffee'});
 state=completion.applyRehearsalAction(state,{action:'redeem',rewardId:'coffee'});assert.equal(state.points,0);
 state=completion.applyRehearsalAction(state,{action:'refund'});assert.equal(state.points,20);assert.equal(state.complete,true);
 assert.equal(config.rewards[0].stock,2);assert.equal(state.config.rewards[0].stock,2);
});
it('practice enforces stock, availability, branch and requires all six steps',()=>{
 assert.equal(typeof completion.applyRehearsalAction,'function','practice validates each step');
 const base={program_type:'SPEND',program_json:{points_per_q:1,round:'floor'},branch_id:'a',rewards:[{id:'r',name:'R',points_cost:5,stock:0,available:false,branch_ids:['b']}]};
 let s=completion.applyRehearsalAction(completion.initialRehearsal(base),{action:'signup'});s=completion.applyRehearsalAction(s,{action:'earn',quantity:10});
 assert.throws(()=>completion.applyRehearsalAction(s,{action:'redeem',rewardId:'r'}),/disponible|sucursal|existencias/);
 assert.equal(s.complete,false);
});
it('paper progress requires approved conversion and evidence, never accepts a photo as proof',()=>{
 const args={csv:'Teléfono,Nombre,Progreso\n55550001,Ana,6',columns:{phone:'Teléfono',name:'Nombre',points:'Progreso'},source:{type:'paper_card',label:'Tarjetas de tienda',evidence:'Registro firmado del encargado',conversion:{points_per_unit:10,approved:true}}};
 const result=normalizeCustomerMigration(args);assert.equal(result.rows[0].points,60);assert.equal(result.rows[0].source_units,6);
 assert.throws(()=>normalizeCustomerMigration({...args,source:{...args.source,conversion:{points_per_unit:10,approved:false}}}),/aproba/);
 assert.throws(()=>normalizeCustomerMigration({...args,source:{...args.source,evidence_type:'photo'}}),/foto/);
});
