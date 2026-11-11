import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeRewardPosMapping} from '../../src/app/services/redemption-pos-model.js';
import * as mod from '../../src/app/services/merchant-catalog-model.js';
const item={productRef:'widget:1',sku:'SKU1',name:'Widget',itemKind:'product',active:true};
test('catalog normalizers bound data and preserve explicit product/service identities',()=>{
 assert.equal(typeof mod.normalizeCatalogSync,'function');
 const input={source:'shop:1',requestId:randomUUID(),observedAt:new Date().toISOString(),items:[item]};
 assert.deepEqual(mod.normalizeCatalogSync(input),input);
 for(const patch of [{source:'catalog:manual'},{source:'catalog:csv'},{items:[]},{items:Array(201).fill(item)},{items:[item,item]},{items:[{...item,active:'true'}]},{items:[{...item,productRef:'x\n'}]},{businessId:randomUUID()}])assert.throws(()=>mod.normalizeCatalogSync({...input,...patch}));
});
test('inventory explicitly retains unknown and rejects coerced, negative, imprecise and duplicate quantities',()=>{
 assert.equal(typeof mod.normalizeInventorySnapshot,'function');
 const input={source:'shop:1',requestId:randomUUID(),branchId:randomUUID(),observedAt:new Date().toISOString(),items:[{productRef:item.productRef,availableQuantity:null}]};
 assert.equal(mod.normalizeInventorySnapshot(input).items[0].availableQuantity,null);
 for(const quantity of [-1,NaN,Infinity,'3',0.0000001])assert.throws(()=>mod.normalizeInventorySnapshot({...input,items:[{productRef:item.productRef,availableQuantity:quantity}]}));
 assert.equal(mod.normalizeInventorySnapshot({...input,items:[{productRef:item.productRef,availableQuantity:0}]}).items[0].availableQuantity,0);
});
test('catalog CSV accepts quoted cells, enforces exact revisions and bounded allowed columns',()=>{
 assert.equal(typeof mod.normalizeCatalogCsv,'function');
 const rows=mod.normalizeCatalogCsv('productRef,sku,name,itemKind,active,revision\nwidget:1,,"Widget, large",product,true,0');
 assert.equal(rows[0].name,'Widget, large');assert.equal(rows[0].revision,0);assert.equal(rows[0].sku,null);
 for(const csv of ['productRef,name,itemKind\na,N,product\na,N,product','productRef,name,itemKind,availableQuantity\na,N,product,9','productRef,name,itemKind,revision\na,N,product,-1','productRef,name,itemKind\na,N,widget','productRef,name,itemKind\n'+Array(201).fill('a,N,product').join('\n')])assert.throws(()=>mod.normalizeCatalogCsv(csv));
});
test('mapping accepts opt-in inventory checks without changing omitted legacy input',()=>{
 const value={source:'shop:1',branchId:randomUUID(),productRef:'widget:1',itemName:'Widget',itemKind:'product',quantity:1,enabled:true,version:0};
 assert.equal(normalizeRewardPosMapping({...value,inventoryRequired:true}).inventoryRequired,true);
 assert.equal(Object.hasOwn(normalizeRewardPosMapping(value),'inventoryRequired'),false);
});
