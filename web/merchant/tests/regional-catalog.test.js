import test from 'node:test';import assert from 'node:assert/strict';
import {demoRegion} from '../src/demo-region.js';
import {REGIONAL_COUNTRIES,REGIONAL_CURRENCIES} from '../../../public/regional-catalog.js';
test('demo exposes the same complete country and currency catalog as the application',()=>{
 const data=demoRegion(new URL('https://example.test/api/admin/region'));
 assert.deepEqual(data.countries,REGIONAL_COUNTRIES);assert.deepEqual(data.currencies,REGIONAL_CURRENCIES);
 for(const code of ['BZ','GT','SV','HN','NI','CR','PA'])assert.ok(data.countries[code]?.name);
});
test('demo changes country defaults and preserves the currency already locked by recorded activity',()=>{
 let data=demoRegion(new URL('https://example.test/api/admin/region'));
 for(const country of ['BZ','NI','PA','GT']){
  data=demoRegion(new URL('https://example.test/api/admin/region'),{method:'PUT',body:JSON.stringify({country,currency:'GTQ',timezone:REGIONAL_COUNTRIES[country].timezone,version:data.version,confirmed_currency:'GTQ'})});
  assert.equal(data.region.country,country);assert.equal(data.region.locale,REGIONAL_COUNTRIES[country].locale);assert.equal(data.region.currency,'GTQ');
 }
 assert.throws(()=>demoRegion(new URL('https://example.test/api/admin/region'),{method:'PUT',body:JSON.stringify({country:'NI',currency:'NIO',timezone:'America/Managua',version:data.version})}),/protegida/);
});
