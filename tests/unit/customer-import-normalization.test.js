import {it} from 'node:test';import assert from 'node:assert/strict';
import {normalizeCustomerMigration} from '../../src/app/services/customer-migration-csv.js';
it('retains the small atomic limit but explicitly allows bounded large imports',()=>{
 const csv='phone,points\n'+Array.from({length:501},(_,i)=>`+502${55550000+i},2`).join('\n');
 assert.throws(()=>normalizeCustomerMigration({csv,columns:{phone:'phone',points:'points'}}),/100/);
 const rows=normalizeCustomerMigration({csv,columns:{phone:'phone',points:'points'},limits:{rows:5000,bytes:750*1024}}).rows;
 assert.equal(rows.length,501);assert.equal(rows.filter(x=>x.issues.length).length,0);
});
it('requires unambiguous international numbers outside Guatemala',()=>{
 const out=normalizeCustomerMigration({csv:'phone\n55550001\n+5255550001',columns:{phone:'phone'},country:'MX'});
 assert.equal(out.rows[0].issues[0].code,'INVALID_PHONE');assert.equal(out.rows[1].phone,'5255550001');assert.equal(out.rows[1].issues.length,0);
});
