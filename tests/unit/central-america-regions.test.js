import test from 'node:test';
import assert from 'node:assert/strict';
import {businessRegion,validateRegionalInput,regionalWindow,assertRegionAmount,REGIONAL_COUNTRIES} from '../../src/app/services/regional-settings.js';
import {normalizeEnrollmentPhone} from '../../src/app/services/regional-phone.js';
import {normalizeCustomerMigration} from '../../src/app/services/customer-migration-csv.js';
import {normalizePosSale} from '../../src/app/services/pos/common.js';
import {normalizePosRefund} from '../../src/app/services/pos-refund-service.js';
import {setBrowserRegion,regionalMoney} from '../../public/lib.js';
const cases=[['BZ','BZD','America/Belize','501','+501 622 1234'],['GT','GTQ','America/Guatemala','502','+502 5555 1234'],['SV','USD','America/El_Salvador','503','+503 7012 3456'],['HN','HNL','America/Tegucigalpa','504','+504 9123 4567'],['NI','NIO','America/Managua','505','+505 8123 4567'],['CR','CRC','America/Costa_Rica','506','+506 8123 4567'],['PA','USD','America/Panama','507','+507 6123 4567']];
for(const [country,currency,timezone,dialCode,phone] of cases)test(`regional operations work for ${country}`,()=>{
 const input={country,currency,timezone},business={program_json:{region:input}};
 assert.deepEqual(validateRegionalInput(input),input);assert.equal(REGIONAL_COUNTRIES[country].dialCode,dialCode);
 const region=businessRegion({program_json:{region:{country}}});assert.equal(region.currency,currency);assert.equal(region.timezone,timezone);assert.equal(region.minorUnits,2);
 assert.equal(normalizeEnrollmentPhone(phone,business),phone.replace(/\D/g,''));
 const imported=normalizeCustomerMigration({csv:`phone\n${phone}`,columns:{phone:'phone'},country}).rows[0];assert.deepEqual(imported.issues,[]);assert.equal(imported.phone,phone.replace(/\D/g,''));
 assert.equal(normalizePosSale({saleId:'s',source:'pos',customerPhone:phone,amountQ:25.5,currency},business).currency,currency);
 assert.equal(normalizePosRefund({refundId:'r',originalSaleId:'s',source:'pos',amountQ:25.5,currency,scope:'full'},business).currency,currency);
 assert.equal(regionalWindow(new Date(country==='PA'?'2026-11-11T14:00:00Z':'2026-11-11T15:00:00Z'),business).allowed,true);
 try{setBrowserRegion(region);assert.equal(regionalMoney(25.5),new Intl.NumberFormat(region.locale,{style:'currency',currency,maximumFractionDigits:2}).format(25.5));}finally{setBrowserRegion();}
 assert.throws(()=>assertRegionAmount(1.005,currency,business),/decimales/);
 if(country!=='GT')assert.throws(()=>normalizeEnrollmentPhone('55551234',business),/internacional/);
});
test('Panama keeps USD default and supports explicit PAB without treating the currencies as interchangeable',()=>{
 assert.equal(businessRegion({program_json:{region:{country:'PA'}}}).currency,'USD');
 const region={country:'PA',currency:'PAB',timezone:'America/Panama'},business={program_json:{region}};
 assert.deepEqual(validateRegionalInput(region),region);assert.equal(businessRegion(business).currency,'PAB');
 assert.equal(normalizePosRefund({refundId:'r',originalSaleId:'s',source:'pos',amountQ:10,currency:'PAB',scope:'full'},business).currency,'PAB');
 assert.throws(()=>assertRegionAmount(10,'USD',business),/PAB/);
});
