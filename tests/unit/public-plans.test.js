import test from 'node:test';import assert from 'node:assert/strict';
import {renderPlanComparison,publicPlanCatalog} from '../../src/app/services/public-plan-service.js';
import {listPlans} from '../../src/utils/plan.js';
test('public catalog withholds provisional rates and provider message quotas while respecting live features',()=>{
 const data=publicPlanCatalog(listPlans({NEGOCIO:{analytics:false}}));
 assert.equal(data.pricing_status,'quotation');assert.equal(data.comparison_currency,'USD');
 assert.equal(data.plans[0].limits.activeCustomers,100);assert.equal(data.plans[1].features.analytics,false);
 assert.doesNotMatch(JSON.stringify(data),/pricing_gtq|1490|3990|9990|included_messages|overage/);
 const html=renderPlanComparison(data);assert.match(html,/Solicitar cotización/);assert.doesNotMatch(html,/Q149|Q399|Q999|gratis|ilimitad/i);
});
test('plan rendering escapes unexpected catalog text and does not claim excluded capabilities',()=>{
 const data=publicPlanCatalog(listPlans({NEGOCIO:{analytics:false}}));data.plans[0].name='<script>bad</script>';
 const html=renderPlanComparison(data);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
 assert.match(html,/Moneda y condiciones/);assert.match(html,/Confirmar alcance/);
});

test('plans page serves live catalog without redirect loops and canonicalizes aliases',async t=>{
 const {default:express}=await import('express');const {createPublicPlans}=await import('../../src/middleware/public-plans.js');const {fileURLToPath}=await import('node:url');
 const app=express();app.use(createPublicPlans({publicDir:fileURLToPath(new URL('../../public',import.meta.url)),marketingOrigin:'https://pf.example',appOrigin:'https://app.pf.example',listPlans:async()=>listPlans()}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const address=server.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`;
 const page=await fetch(origin+'/precios',{redirect:'manual'});assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');const body=await page.text();assert.match(body,/Solicitar cotización/);assert.doesNotMatch(body,/<!--PLAN_COMPARISON-->|Q149|Q399|Q999/);
 const {get}=await import('node:http');const appPage=await new Promise((resolve,reject)=>get({hostname:'127.0.0.1',port:address.port,path:'/precios?from=setup',headers:{Host:'app.pf.example'}},res=>{res.resume();resolve(res);}).on('error',reject));assert.equal(appPage.statusCode,301);assert.equal(appPage.headers.location,'https://pf.example/precios?from=setup');
 for(const path of ['/precios/','/precios.html']){const response=await fetch(origin+path,{redirect:'manual'});assert.equal(response.status,301);assert.equal(response.headers.get('location'),'/precios');}
});
