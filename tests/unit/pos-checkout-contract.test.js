import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeRewardWorkspace} from '../../src/app/services/reward-workspace-service.js';
import * as m from '../../src/app/services/pos-checkout-model.js';
const id='11111111-1111-4111-8111-111111111111';
const common={source:'vendor:shop:1',branchId:null,requestId:id};
test('checkout authorization requires exact cart, mapping and QR proof, no phone substitute',()=>{assert.equal(typeof m.normalizeCheckoutAuthorize,'function');const value={...common,cartId:'cart:1',cartLineId:'line:1',customerId:id,customerQrToken:'card-token',rewardId:id,mappingId:id,mappingVersion:1,operatorRef:'cashier:1'};assert.equal(m.normalizeCheckoutAuthorize(value).source,common.source);assert.throws(()=>m.normalizeCheckoutAuthorize({...value,customerQrToken:undefined,customerPhone:'55554444'}));assert.throws(()=>m.normalizeCheckoutAuthorize({...value,mappingVersion:0}));});
test('cancellation requires draft cart and explicit removed reward line',()=>{assert.equal(typeof m.normalizeCheckoutCancel,'function');const value={...common,cartId:'cart:1',cartLineId:'line:1',cancelRequestId:id,reason:'Cliente canceló antes del pago.',orderState:'draft',rewardLineRemoved:true};assert.equal(m.normalizeCheckoutCancel(value).rewardLineRemoved,true);for(const change of [{orderState:'paid'},{rewardLineRemoved:false},{reason:''}])assert.throws(()=>m.normalizeCheckoutCancel({...value,...change}));});
test('workspace distinguishes reward limits and unknown costs and preserves omitted mapping',()=>{assert.equal(typeof normalizeRewardWorkspace,'function');const input={requestId:id,reward:{name:'Lavado',description:null,points_cost:100,active:true,stock:null,valid_until:null,branch_ids:[]},available:true,unitCostQ:null};const value=normalizeRewardWorkspace(input);assert.equal(value.reward.stock,null);assert.equal(value.unitCostQ,null);assert.equal(value.mapping,undefined);assert.throws(()=>normalizeRewardWorkspace({...input,reward:{...input.reward,stock:-1}}));});

test('disabled connection permits explicit recovery with the same valid signature',async()=>{
 const {verifyPosCredentials}=await import('../../src/app/services/pos/common.js');
 const {createHmac}=await import('node:crypto');
 const business={program_json:{external_awards:{enabled:false,api_key:'fixture-key'},pos_integration:{enabled:false}}};
 const rawBody='{}',signature=createHmac('sha256','fixture-key').update(rawBody).digest('hex');
 assert.throws(()=>verifyPosCredentials(business,{rawBody,signature}),{statusCode:403});
 assert.doesNotThrow(()=>verifyPosCredentials(business,{rawBody,signature,allowDisabled:true}));
 assert.throws(()=>verifyPosCredentials(business,{rawBody,signature:'a'.repeat(64),allowDisabled:true}),{statusCode:401});
});
