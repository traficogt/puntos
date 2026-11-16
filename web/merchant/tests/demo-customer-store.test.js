import test from 'node:test';
import assert from 'node:assert/strict';
import {demoMigration} from '../src/demo-migration.js';
import {demoImportJobs} from '../src/demo-import-jobs.js';
import {demoOwnerWorkspace, createOwnerDemoApi} from '../src/demo-owner-workspace.ts';
const invoke=(service,base,suffix='',body)=>service(new URL(`${base}${suffix}`,'https://fixture.invalid'),body?{method:'POST',body:JSON.stringify(body)}:{});
const small=(suffix,body)=>invoke(demoMigration,'/api/admin/customer-migrations',suffix,body);
const large=(suffix,body)=>invoke(demoImportJobs,'/api/admin/customer-import-jobs',suffix,body);
const directory=(q='',send=demoOwnerWorkspace)=>send(new URL(`/api/admin/customers?limit=100&q=${encodeURIComponent(q)}`,'https://fixture.invalid'));
const payload=(phone,name,points)=>({csv:`Teléfono,Nombre,Saldo\n${phone},${name},${points}`,columns:{phone:'Teléfono',name:'Nombre',points:'Saldo'},existing_policy:'skip',label:'Lote sintético',request_id:crypto.randomUUID(),confirmed:true});
test('regular import appears once in the owner directory with its name and opening points',()=>{
 const input=payload('55550871','Marta importada',137);small('/commit',input);small('/commit',input);
 const rows=directory('55550871').customers;assert.equal(rows.length,1);assert.equal(rows[0].name,'Marta importada');assert.equal(rows[0].points,137);assert.equal(rows[0].lifetime_points,137);assert.equal(rows[0].pending_points,0);
});
test('background import appears once in the owner directory and a later import preserves its data',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const input=payload('55550872','Luis por lote',84);const queued=large('',input);assert.equal(directory('55550872').total,0);t.mock.timers.tick(1200);
 assert.equal(large().jobs.find(job=>job.id===queued.job.id).status,'completed');large('',input);small('/commit',payload('55550872','No reemplazar',999));
 const rows=directory('55550872').customers;assert.equal(rows.length,1);assert.equal(rows[0].name,'Luis por lote');assert.equal(rows[0].points,84);assert.equal(rows[0].lifetime_points,84);
});
test('seeded directory customers are existing in both import flows and balances remain unchanged',t=>{
 t.mock.timers.enable({apis:['setTimeout']});const before=directory('55550001').customers[0],input=payload('55550001','No reemplazar semilla',9999);
 assert.equal(small('/preview',input).summary.existing_customers,1);assert.equal(large('/preview',input).summary.existing_customers,1);assert.equal(small('/commit',input).batch.imported_count,0);
 const queued=large('',{...input,request_id:crypto.randomUUID()});t.mock.timers.tick(1200);assert.equal(large().jobs.find(job=>job.id===queued.job.id).skipped,1);assert.deepEqual(directory('55550001').customers[0],before);
});
test('factory-created owner fixtures remain isolated from shared imports and one another',()=>{
 const first=createOwnerDemoApi(),second=createOwnerDemoApi();assert.equal(directory('55550871',first).total,0);const customer=directory('55550001',first).customers[0];
 first(new URL(`/api/admin/customers/${customer.id}`,'https://fixture.invalid'),{method:'PATCH',body:JSON.stringify({name:'Nombre aislado',previous_name:customer.name})});
 assert.equal(directory('55550001',first).customers[0].name,'Nombre aislado');assert.equal(directory('55550001',second).customers[0].name,'Ana López');assert.equal(directory('55550001').customers[0].name,'Ana López');
});
