import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoCustomerStore} from '../src/demo-customer-store.js';
import {createOwnerDemoApi} from '../src/demo-owner-workspace.ts';
import {TEST_ACCOUNT_EXPLANATION, TEST_ACCOUNT_LABEL, isTestAccount, testAccountActionLabel, testAccountRequest, testAccountSavedMessage} from '../src/customer-test-account-model.ts';

const invoke=(service,path,body)=>service(new URL(path,'https://fixture.invalid'),body?{method:'PATCH',body:JSON.stringify(body)}:{});
const directory=(send)=>invoke(send,'/api/admin/customers?limit=100').customers;

test('the demo directory seeds exactly one test account that keeps points and visits', () => {
  const {customers}=createDemoCustomerStore();
  const marked=customers.filter(isTestAccount);
  assert.equal(marked.length,1);
  assert.equal(marked[0].name,'Teléfono de la dueña (prueba)');
  assert.ok(marked[0].points>0,'a test account keeps its points');
  assert.ok(marked[0].last_visit_at,'a test account keeps its visits');
  assert.ok(customers.every(customer=>typeof customer.is_test==='boolean'),'every seeded row carries the flag');
});

test('marking and unmarking through the demo API flips only the flag and stays isolated per fixture', () => {
  const first=createOwnerDemoApi(),second=createOwnerDemoApi();
  const ana=directory(first).find(customer=>customer.name==='Ana López');
  assert.equal(isTestAccount(ana),false);
  const marked=invoke(first,`/api/admin/customers/${ana.id}/test-account`,testAccountRequest(true));
  assert.equal(marked.ok,true);assert.equal(marked.customer.is_test,true);
  assert.deepEqual(marked.customer,{id:ana.id,is_test:true});
  assert.deepEqual(directory(first).find(row=>row.id===ana.id),{...ana,is_test:true});
  assert.equal(isTestAccount(directory(first).find(customer=>customer.id===ana.id)),true,'the list reflects the badge');
  assert.equal(isTestAccount(directory(second).find(customer=>customer.id===ana.id)),false,'other fixtures are untouched');
  const unmarked=invoke(first,`/api/admin/customers/${ana.id}/test-account`,testAccountRequest(false));
  assert.equal(unmarked.customer.is_test,false);
});

test('the demo API enforces the strict server contract', () => {
  const api=createOwnerDemoApi();const ana=directory(api)[0];
  assert.throws(()=>invoke(api,`/api/admin/customers/${ana.id}/test-account`,{is_test:'yes'}),/is_test/);
  assert.throws(()=>invoke(api,'/api/admin/customers/00000000-0000-4000-8000-000000000000/test-account',testAccountRequest(true)),error=>error.status===404);
  assert.throws(()=>api(new URL(`/api/admin/customers/${ana.id}/test-account`,'https://fixture.invalid'),{method:'POST',body:JSON.stringify(testAccountRequest(true))}),error=>error.status===400);
});

test('owner-facing copy names the badge, the action and what the marker excludes', () => {
  assert.equal(TEST_ACCOUNT_LABEL,'Cuenta de prueba');
  for (const surface of ['Tu progreso','reporte básico','activación','uso del plan']) assert.match(TEST_ACCOUNT_EXPLANATION,new RegExp(surface));
  assert.match(TEST_ACCOUNT_EXPLANATION,/puntos y movimientos se conservan/);
  assert.equal(testAccountActionLabel(false),'Marcar como cuenta de prueba');
  assert.equal(testAccountActionLabel(true),'Quitar marca de cuenta de prueba');
  assert.match(testAccountSavedMessage(true),/Ya no cuenta/);
  assert.match(testAccountSavedMessage(false),/cliente real/);
  assert.deepEqual(testAccountRequest(true),{is_test:true});
});
