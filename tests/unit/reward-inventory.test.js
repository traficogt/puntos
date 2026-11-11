import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogInventory} from '../../src/app/services/reward-inventory-service.js';
const now=Date.parse('2026-11-11T12:00:00.000Z');
const evidence={itemKind:'product',origin:'connector',quantity:3,observedAt:'2026-11-11T11:55:00.000Z',now,requiredQuantity:2};
test('freshness includes five minutes exactly and positive stock must cover the mapped quantity',()=>{
 assert.equal(catalogInventory(evidence).state,'available');
 assert.equal(catalogInventory({...evidence,now:now+1}).state,'stale');
 assert.equal(catalogInventory({...evidence,quantity:1}).state,'unavailable');
 assert.equal(catalogInventory({...evidence,quantity:0}).state,'unavailable');
 assert.equal(catalogInventory({...evidence,observedAt:'2026-11-11T12:00:01.000Z'}).state,'unknown');
});
test('null stays unknown regardless of observation age; local catalog never supplies connector evidence',()=>{
 assert.equal(catalogInventory({...evidence,quantity:null,now:now+1}).state,'unknown');
 assert.deepEqual(catalogInventory({...evidence,origin:'manual'}),{state:'unknown',quantity:null,observedAt:null});
 assert.deepEqual(catalogInventory({...evidence,itemKind:'service'}),{state:'not_applicable',quantity:null,observedAt:null});
});
