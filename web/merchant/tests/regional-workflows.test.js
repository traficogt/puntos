import test from 'node:test';
import assert from 'node:assert/strict';
import {setMerchantRegion,merchantRegion} from '../src/region.js';
import {REGIONAL_COUNTRIES} from '../../../public/regional-catalog.js';
import {buildPosHandoff} from '../src/pos-handoff-model.js';
import {referralTriggerText} from '../src/referral-model.js';
import {audienceDescription,audiencePresets,audienceFields} from '../src/audience-model.js';

test('POS supplier contracts and merchant explanations use the configured currency',()=>{
 const previous={...merchantRegion()};
 try {
  for(const [country,currency] of [['BZ','BZD'],['NI','NIO'],['PA','USD'],['PA','PAB']]){
   const region={...REGIONAL_COUNTRIES[country],country,currency,minorUnits:2};
   setMerchantRegion(region);
   const handoff=buildPosHandoff({vendor:'Ejemplo',version:'1',deployment:'Local',capability:'API'});
   assert.equal((handoff.match(new RegExp(`"currency": "${currency}"`,'g'))||[]).length,2);
   assert.doesNotMatch(handoff,/GTQ/);
   const amount=new Intl.NumberFormat(region.locale,{style:'currency',currency}).format(500);
   assert.ok(referralTriggerText({min_purchase_to_complete:500}).includes(amount));
   assert.ok(audienceDescription(audiencePresets.value.definition()).includes(amount));
   assert.doesNotMatch(audiencePresets.value.label,/Q500/);
   assert.doesNotMatch(audienceFields.find(f=>f.value==='spend_q').label,/\(Q\)/);
  }
 } finally {setMerchantRegion(previous);}
});
