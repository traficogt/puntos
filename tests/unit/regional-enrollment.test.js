import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEnrollmentPhone} from '../../src/app/services/regional-phone.js';
import {marketingWindow,campaignMessageBody} from '../../src/app/services/campaign-message-service.js';
const mexican={program_json:{region:{country:'MX',currency:'MXN',timezone:'America/Mexico_City'}}},ny={program_json:{region:{country:'US',currency:'USD',timezone:'America/New_York'}}};
test('enrollment interprets national phones only with Guatemala context and requires explicit other-country prefixes',()=>{assert.equal(normalizeEnrollmentPhone('5555 1234',{}),'50255551234');assert.equal(normalizeEnrollmentPhone('+52 55 1234 5678',mexican),'525512345678');for(const phone of ['5512345678','55551234','52 55 1234 5678','+52+55 1234 5678'])assert.throws(()=>normalizeEnrollmentPhone(phone,mexican),{statusCode:400});assert.equal(normalizeEnrollmentPhone('+1 (212) 555-1234',ny),'12125551234');});
test('marketing windows follow the business calendar across DST without fixed UTC offsets',()=>{const result=marketingWindow(new Date('2026-10-31T23:00:00Z'),ny);assert.equal(result.allowed,false);assert.equal(result.nextAt.toISOString(),'2026-11-01T14:00:00.000Z');assert.equal(marketingWindow(new Date('2026-11-01T13:59:59Z'),ny).allowed,false);assert.equal(marketingWindow(new Date('2026-11-01T14:00:00Z'),ny).allowed,true);assert.equal(marketingWindow(new Date('2026-03-07T23:00:00Z'),ny).nextAt.toISOString(),'2026-03-08T13:00:00.000Z');});
test('campaign messages identify the merchant currency and timezone',()=>{const body=campaignMessageBody({...mexican,business_name:'Negocio',bonus_points:20,minimum_purchase_q:250,expires_at:'2026-11-20T18:00:00Z'},'https://example.test/unsubscribe');assert.match(body,/MXN/);assert.match(body,/America\/Mexico_City/);assert.doesNotMatch(body,/Q250|Guatemala/);});

test('legacy browser money formatter follows the active business region',async()=>{
 const {setBrowserRegion,regionalMoney,fmtQ}=await import('../../public/lib.js');
 try{setBrowserRegion({currency:'CLP',locale:'es-CL',timezone:'America/Santiago',minorUnits:0});assert.equal(regionalMoney(1500),new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(1500));setBrowserRegion({currency:'USD',locale:'es-US',timezone:'America/New_York',minorUnits:2});assert.match(fmtQ(12.5),/12[.,]50/);assert.doesNotMatch(fmtQ(12.5),/Q/);}finally{setBrowserRegion();}
});
