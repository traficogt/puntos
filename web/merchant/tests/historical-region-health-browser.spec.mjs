// Synthetic evidence and health responses; no live API calls.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {chromium} from 'playwright';
const root=path.resolve(import.meta.dirname,'..');
const platform=await readFile(path.resolve(root,'../../public/super/operations-health.js'),'utf8');
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
import {MantineProvider,Container,Stack} from '@mantine/core';import '@mantine/core/styles.css';
import TransactionHistory from '/src/TransactionHistory.jsx';import DataHealth from '/src/DataHealth.jsx';
import {setMerchantRegion} from '/src/region.js';import {demoTransactions} from '/src/demo-transactions.js';
import {createPlatformHealth} from '/__platform-health.js';
setMerchantRegion({country:'PA',currency:'USD',timezone:'America/Los_Angeles',locale:'es-GT'});
const sources=[{id:'monitor-a',source:'pos',label:'Caja',branch_id:'branch-a',branch_name:'Centro',state:'blocked',summary:'Pendiente',expected_minutes:60,enabled:true},{id:'monitor-b',source:'other',label:'Caja',branch_id:'branch-b',branch_name:'Norte',state:'ready',summary:'Completa',expected_minutes:60,enabled:true},{id:'monitor-c',source:'old',label:'Caja',branch_id:'removed-branch',branch_name:null,state:'blocked',summary:'Pendiente',expected_minutes:60,enabled:true}];
window.__fixtureApi=async(path,options={})=>{
 if(path==='/api/admin/data-health')return {version:'x',sources,branches:[{id:'branch-a',name:'Centro'},{id:'branch-b',name:'Norte'}],readiness:{state:'blocked',summary:'Pendiente',sources},heartbeat_path:'/fixture'};
 if(path==='/api/admin/transaction-rejections')return {attempts:[],note:'Fixture'};
 const data=structuredClone(await demoTransactions(new URL(path,'http://fixture'),options));
 if(data.explanation?.award){data.explanation.award.currency='GTQ';data.explanation.award.time_zone='America/Guatemala';if(window.__legacyCurrency)delete data.explanation.award.currency;}
 return data;
};
createRoot(document.getElementById('root')).render(React.createElement(MantineProvider,null,React.createElement(Container,{size:'lg'},React.createElement(Stack,null,React.createElement(TransactionHistory),React.createElement(DataHealth)))));
await createPlatformHealth({container:document.getElementById('platform'),currentSession:()=>1,api:async()=>({businesses:[{name:'Fixture',readiness:{summary:'Pendiente',sources},members:0,recorded_redemptions:0,open_cases:0,issues:[],note:'Fixture'}],next_offset:null})}).load();`;
const vite=await createServer({configFile:false,root,cacheDir:'/tmp/pf-historical-region-health-vite',publicDir:false,logLevel:'error',plugins:[react(),{
 name:'historical-region-health',resolveId(id){if(id==='/__fixture.jsx')return '\0fixture';if(id==='/__platform-health.js')return '\0platform';if(id==='/lib.js')return '\0fixture-api';},
 load(id){if(id==='\0fixture')return entry;if(id==='\0platform')return platform;if(id==='\0fixture-api')return 'export const api=(path,options)=>window.__fixtureApi(path,options);';},
 configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url!=='/fixture')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<!doctype html><html lang="es"><head><title>Historical region check</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><section id="platform"></section><script type="module" src="/__fixture.jsx"></script></body></html>'));});}
}],server:{host:'127.0.0.1',port:0}});
await vite.listen();const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome'});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],apiCalls=[],failures=[];page.setDefaultTimeout(12000);
 page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(new URL(req.url()).pathname.startsWith('/api/'))apiCalls.push(req.url());});
 await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/fixture`);
 await page.getByRole('button',{name:/Explicar Compra/}).first().click();await page.getByRole('heading',{name:'Detalle del movimiento'}).waitFor();
 await page.getByRole('button',{name:'Ver reglas evaluadas',exact:true}).click();
 const detail=page.getByRole('region',{name:'Explicación del movimiento'}),text=await detail.innerText();
 if(!text.includes('GTQ')||text.includes('USD'))failures.push('historical amount must keep GTQ after current region changes to USD');
 if(text.includes('puntos por quetzal'))failures.push('rate must name saved currency, not a fixed country currency');
 const expected=await page.evaluate(()=>new Intl.DateTimeFormat('es-GT',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Guatemala'}).format(new Date('2026-11-11T18:00:00Z')));
 if(!text.includes('Evaluado por el servidor: '+expected))failures.push('award dates must use saved timezone');
 const ownerText=await page.locator('[aria-labelledby="data-health-title"]').innerText(),platformText=await page.locator('#platform').innerText();
 for(const [surface,value]of [['owner',ownerText],['platform',platformText]])for(const branch of ['Centro','Norte','removed-branch'])if(!value.includes(branch))failures.push(surface+' health omits '+branch);
 await page.evaluate(()=>{window.__legacyCurrency=true;});await page.getByRole('button',{name:'Actualizar historial',exact:true}).click();
 await page.getByRole('heading',{name:'Detalle del movimiento'}).waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="Explicación del movimiento"]')?.textContent.includes('moneda histórica no registrada'),null,{timeout:1500}).catch(()=>failures.push('legacy currency must be explicitly unknown'));
 for(const width of [1280,390]){await page.setViewportSize({width,height:900});if(!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)))failures.push('horizontal overflow at '+width);}
 assert.deepEqual(errors,[]);assert.deepEqual(apiCalls,[]);assert.deepEqual(failures,[]);
 console.log('Historical currency, saved timezone, legacy unknowns and owner/platform branch labels pass at 390/1280.');
}finally{await browser.close();await vite.close();}
