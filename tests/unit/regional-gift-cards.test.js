import test from 'node:test';
import assert from 'node:assert/strict';
import {createGiftCardWithDeps,redeemGiftCardWithDeps} from '../../src/app/services/gift-card-service.js';
for(const [name,fn] of Object.entries({issue:createGiftCardWithDeps,redeem:redeemGiftCardWithDeps}))test(`gift card ${name} validates the locked merchant currency before mutation`,async()=>{
 const queries=[];const deps={assertGiftCardAccess:async()=>({id:'staff',business_id:'business'}),withTransaction:fn=>fn({query:async(sql)=>{queries.push(sql);if(sql.includes('FROM businesses'))return {rows:[{program_json:{region:{country:'CL',currency:'CLP',timezone:'America/Santiago'}}}]};throw new Error('Unexpected query before currency validation: '+sql);}})};
 await assert.rejects(fn(deps,{staff:{},amount_q:1.25,code_or_token:'GC-TEST',issued_to_name:null,issued_to_phone:null,expires_at:null,note:null}),error=>error['statusCode']===400&&error['message'].includes('CLP'));
 assert.equal(queries.length,1);assert.match(queries[0],/FOR SHARE/);
});

test('new gift card issue and redemption retain exact CLP amounts and additive currency',async()=>{
 const audits=[],mutations=[];const card={id:'card',business_id:'business',balance_q:1500,initial_amount_q:1500,status:'ACTIVE',code:'GC-TEST'};
 const deps={AuditRepo:{log:async event=>audits.push(event)},assertGiftCardAccess:async()=>({id:'staff',business_id:'business'}),withTransaction:fn=>fn({query:async(sql,params)=>{
  if(sql.includes('FROM businesses'))return {rows:[{program_json:{region:{country:'CL',currency:'CLP',timezone:'America/Santiago'}}}]};
  if(sql.includes('INSERT INTO gift_cards')||sql.includes('FROM gift_cards WHERE'))return {rows:[card]};
  mutations.push({sql,params});return {rows:[]};
 }})};
 const issued=await createGiftCardWithDeps(deps,{staff:{},amount_q:1500,issued_to_name:null,issued_to_phone:null,expires_at:null});assert.equal(issued.currency,'CLP');
 const redeemed=await redeemGiftCardWithDeps(deps,{staff:{},amount_q:500,code_or_token:'GC-TEST',note:null});assert.equal(redeemed.balance_q,1000);assert.equal(redeemed.currency,'CLP');
 assert.deepEqual(mutations.filter(x=>x.sql.includes('INSERT INTO gift_card_transactions')).map(x=>x.params[8].currency),['CLP','CLP']);assert.ok(audits.every(x=>x.meta.currency==='CLP'));
});
