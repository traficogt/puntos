import assert from 'node:assert/strict';
import {test} from 'node:test';

test('fulfillment distinguishes historical uncertainty and keeps returns in review', async () => {
 const m = await import('../src/fulfillment-model.js').catch(() => null);
 assert.equal(typeof m?.fulfillmentState, 'function');
 assert.equal(m.fulfillmentState(null).status, 'unknown');
 assert.deepEqual(m.fulfillmentActions({fulfillment:null,redemption:{}}), ['review']);
 assert.deepEqual(m.fulfillmentActions({fulfillment:{status:'pending',version:0},redemption:{}}), ['recorded','not_required','review']);
 assert.deepEqual(m.fulfillmentActions({fulfillment:{status:'pending'},redemption:{points_restored:true}}), ['review']);
 assert.deepEqual(m.fulfillmentActions({fulfillment:{status:'pending',returnedQuantity:1},redemption:{}}), ['review']);
 assert.deepEqual(m.fulfillmentActions({fulfillment:{status:'review',returnedQuantity:1},redemption:{points_restored:true}}), ['reviewed','review']);
 assert.match(m.stockDescription({method:'manual',stockStatus:'done'}), /declarado|declaración/);
 assert.doesNotMatch(m.stockDescription({method:'manual',stockStatus:'done'}), /sincronizado/);
});

test('manual drafts require receipt and attestation; retry identity changes only with intent', async () => {
 const m = await import('../src/fulfillment-model.js').catch(() => null);
 assert.equal(typeof m?.manualPayload, 'function');
 const value={version:0,action:'recorded',receiptRef:' REC-100 ',reason:' Entrega registrada ',attested:true};
 assert.deepEqual(m.manualPayload(value),{...value,receiptRef:'REC-100',reason:'Entrega registrada'});
 assert.equal(m.manualPayload({...value,reason:'Registro comprobado.\nRecibo consultado.'}).reason,'Registro comprobado.\nRecibo consultado.');
 for (const patch of [{receiptRef:''},{attested:false},{reason:'a'}]) assert.throws(()=>m.manualPayload({...value,...patch}));
 const first=m.stableRequest({redemptionId:'one',...value},null,()=> 'first');
 assert.equal(m.stableRequest({redemptionId:'one',...value},first,()=> 'second'),first);
 assert.equal(m.stableRequest({redemptionId:'two',...value},first,()=> 'second').requestId,'second');
});

test('mapping drafts use source and reward identity, preserve six-decimal quantities', async () => {
 const m = await import('../src/fulfillment-model.js').catch(() => null);
 assert.equal(typeof m?.mappingPayload, 'function');
 const value={source:'Caja central',branchId:'',productRef:'C-01',itemName:'Café',itemKind:'product',quantity:'0.123456',enabled:true,version:0};
 assert.deepEqual(m.mappingPayload(value),{...value,branchId:null,quantity:0.123456});
 for(const quantity of ['',0,'0.0000001','1000001'])assert.throws(()=>m.mappingPayload({...value,quantity}));
 assert.throws(()=>m.mappingPayload({...value,source:'bad/source'}));
});

test('demo evidence is local, paginated, versioned, and replay-safe without rewriting original evidence', async () => {
 const m=await import('../src/demo-fulfillment.js').catch(()=>null);
 assert.equal(typeof m?.demoFulfillment,'function');
 const call=(path,method='GET',body)=>m.demoFulfillment(new URL(path,'https://demo.invalid'),{method,body:JSON.stringify(body)});
 const base='/api/admin/redemption-pos';
 const first=call(`${base}?status=all&offset=0`),second=call(`${base}?status=all&offset=50`);
 assert.equal(first.records.length,50);assert.equal(first.pagination.has_more,true);assert.ok(second.records.length>0);
 assert.equal(second.records.some(r=>first.records.some(a=>a.id===r.id)),false);
 const historical=call(`${base}?status=unknown`).records[0];assert.ok(historical);assert.equal(call(`${base}/${historical.id}`).fulfillment,null);
 assert.equal(call(`${base}?status=pending`).records.some(row=>row.id===historical.id),false);
 const row=call(`${base}?status=pending`).records[0];
 const body={requestId:'123e4567-e89b-42d3-a456-426614174001',version:row.version,action:'recorded',receiptRef:'TEST-100',reason:'Registro de ejemplo',attested:true};
 assert.equal(call(`${base}/${row.id}`,'POST',body).fulfillment.status,'recorded');
 assert.equal(call(`${base}/${row.id}`,'POST',body).replay,true);
 assert.throws(()=>call(`${base}/${row.id}`,'POST',{...body,receiptRef:'OTHER'}));
 assert.throws(()=>call(`${base}/${row.id}`,'POST',{...body,requestId:'123e4567-e89b-42d3-a456-426614174002'}));
 const detail=call(`${base}/${row.id}`);
 call(`${base}/${row.id}`,'POST',{...body,requestId:'123e4567-e89b-42d3-a456-426614174003',version:detail.fulfillment.version,action:'review',receiptRef:'OTHER'});
 assert.equal(call(`${base}/${row.id}`).fulfillment.receiptRef,'TEST-100');
 assert.equal(call(`${base}/${row.id}`).events.length,2);
 const reviewed=call(`${base}/${row.id}`,'POST',{requestId:'123e4567-e89b-42d3-a456-426614174004',version:2,action:'reviewed',reason:'Recibo revisado',attested:true});
 assert.equal(reviewed.fulfillment.status,'reviewed');assert.equal(reviewed.fulfillment.receiptRef,'TEST-100');
 const mappings=call('/api/admin/reward-pos-mappings'),reward=mappings.rewards[0];
 const mapping={source:'Mi caja de prueba',branchId:null,productRef:'sku-01',itemName:'Café',itemKind:'product',quantity:0.123456,enabled:true,version:0};
 assert.equal(call(`/api/admin/reward-pos-mappings/${reward.id}`,'PUT',mapping).mapping.version,1);
 assert.throws(()=>call(`/api/admin/reward-pos-mappings/${reward.id}`,'PUT',mapping));
 assert.throws(()=>call(`/api/admin/reward-pos-mappings/${reward.id}`,'PUT',{...mapping,source:'Otra caja',branchId:'not-this-business'}));
});
