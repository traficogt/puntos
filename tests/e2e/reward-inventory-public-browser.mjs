// Isolated browser checks for the public website; no native app artifacts or real APIs.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import express from 'express';
import {chromium} from 'playwright';
const root=path.resolve(import.meta.dirname,'../..'),app=express();
app.get('/lib.js',(_req,res)=>res.type('application/javascript').send('export function setHidden(element,hidden){if(element)element.hidden=hidden;}'));
app.get('/inventory-fixture',(_req,res)=>res.type('html').send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recompensas</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/styles/customer-modern.css"><link rel="stylesheet" href="/styles/customer-wallet-refresh.css"></head><body class="app-shell customer-modern page-customer"><main class="cus-page"><h1>Recompensas</h1><p id="nextReward"></p><div id="rewards"></div></main><script type="module">import {renderRewards} from '/customer/render.js';document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'light';const now=Date.now();const branch=(branchId,branchName,state)=>({branchId,branchName,state,observedAt:new Date(now-1000).toISOString(),freshUntil:new Date(now+1000).toISOString()});window.__rows=[{id:'fresh',name:'Café con comprobación',points_cost:50,inventory:{state:'available',required:true,branches:[branch('a','Centro','available'),branch('b','Norte','stale')]}},{id:'paused',name:'Postre pausado',points_cost:60,available:false},{id:'unknown',name:'Beneficio por confirmar',points_cost:70,inventory:{state:'unknown',required:true,branches:[branch('a','Centro','unknown')]}},{id:'manual',name:'Premio sin comprobación automática',points_cost:80}];window.__render=()=>renderRewards(selector=>document.querySelector(selector),100,window.__rows);window.__render();</script></body></html>`));
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository shell fixture.
const customerShell = (await readFile(new URL('../../public/customer.html', import.meta.url), 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
app.get('/progress-fixture', (_req, res) => res.type('html').send(customerShell.replace('</body>', `<script type="module">
import {renderRewards} from '/customer/render.js';
import {clearWalletView} from '/customer/session.js';
const $ = selector => document.querySelector(selector);
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
$('#needLogin').hidden = true;
$('#main').classList.remove('is-hidden');
for (const id of ['#tierSection','#referralsSection','#achievementsSection']) $(id).hidden = true;
$('#bizName').textContent = 'Café de prueba';
$('#who').textContent = 'Ana · Tarjeta de demostración';
$('#points').textContent = '40'; $('#pendingPoints').textContent = '100'; $('#lifetime').textContent = '140';
$('#lastVisit').textContent = '11 nov 2026'; $('#syncBadge').textContent = 'Actualizado';
const deadline = new Date(Date.now() + 60000).toISOString();
window.__progress = {available_points:40,pending_points:100,as_of:new Date().toISOString(),next_refresh_at:deadline,
 reward:{id:'protected',name:'Café original',points_cost:50,remaining_points:10,status:'progress',protected:true,branch_ids:['center'],valid_until:deadline},
 choices:[{id:'protected',name:'Café original',description:'Tamaño original',points_cost:50,protected:true,active:true,available:true,branch_ids:['center'],branch_labels:['Centro'],valid_until:deadline},{id:'future',name:'Postre',points_cost:100,available:true}],
 conditions:'Condiciones originales protegidas. Canje en: Centro. Vigencia: '+deadline+'. Sujeto a disponibilidad al canjear.',earning:'Condiciones protegidas: 10 puntos por visita.'};
window.__current = true;
window.__renderProgress = (isLive = true) => renderRewards($,40,[{name:'Nombre cambiado',points_cost:200}],{progress:window.__progress,isLive,isCurrent:()=>window.__current});
$('#btnRefreshWallet').addEventListener('click',()=>window.__renderProgress());
window.__clearProgress = () => { window.__current = false; clearWalletView($); };
window.__renderProgress();
</script></body>`)));
app.use(express.static(path.join(root,'public')));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const origin=`http://127.0.0.1:${address.port}`,browser=await chromium.launch();
try{
 for(const theme of ['light','dark'])for(const width of [1200,390]){
  const page=await browser.newPage({viewport:{width,height:900}});await page.clock.install({time:new Date('2026-11-11T12:00:00Z')});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(`${origin}/inventory-fixture?theme=${theme}`);
  const fresh=page.locator('.cus-reward-card').filter({has:page.getByRole('heading',{name:'Café con comprobación'})});await fresh.waitFor();assert.match(await fresh.getAttribute('class'),/cus-reward-ready/);await fresh.getByText(/Centro: existencias comprobadas recientemente/).waitFor();assert.doesNotMatch(await page.locator('.cus-reward-card').filter({has:page.getByRole('heading',{name:'Postre pausado'})}).getAttribute('class'),/cus-reward-ready/);
  await page.clock.runFor(1100);assert.doesNotMatch(await fresh.getAttribute('class'),/cus-reward-ready/);await fresh.getByText('Comprobación de existencias desactualizada',{exact:true}).first().waitFor();assert.match(await page.locator('#nextReward').textContent(),/Premio sin comprobación automática/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.addScriptTag({path:path.join(root,'web/merchant/node_modules/axe-core/axe.min.js')});const violations=await page.evaluate(async()=> (await /** @type {any} */(window).axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));assert.deepEqual(violations,[],`${width} ${theme}`);await page.screenshot({path:`/tmp/pf-public-reward-inventory-${width}-${theme}.png`,fullPage:true});assert.deepEqual(errors,[]);
  // An outstanding freshness timer must not recreate rewards after account data is cleared.
  await page.evaluate(()=>{const now=Date.now();/** @type {any} */(window).__rows[0].inventory.branches[0].freshUntil=new Date(now+500).toISOString();/** @type {any} */(window).__render();document.querySelector('#rewards').replaceChildren();document.querySelector('#nextReward').textContent='';});await page.clock.runFor(600);assert.equal(await page.locator('#rewards').textContent(),'');assert.equal(await page.locator('#nextReward').textContent(),'');await page.close();
 }
 for (const theme of ['light','dark']) for (const width of [1200,390]) {
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.route('https://privatrack.com/**',route=>route.abort());
  await page.clock.install({time:new Date('2026-11-11T12:00:00Z')});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/progress-fixture?theme=${theme}`);
  await page.locator('#nextReward').getByText('Te faltan 10 puntos para “Café original”.',{exact:true}).waitFor();
  assert.equal(await page.locator('#points').textContent(),'40');assert.equal(await page.locator('#pendingPoints').textContent(),'100');
  assert.match(await page.locator('#nextRewardBalance').textContent(),/40 puntos disponibles · 50 puntos de costo/);
  assert.match(await page.locator('#nextRewardConditions').textContent(),/originales protegidas.*Centro.*Vigencia/);
  await page.getByText('Los puntos pendientes aún no cuentan para canjear.',{exact:true}).waitFor();
  assert.doesNotMatch(await page.locator('#rewards').textContent(),/Nombre cambiado|200 puntos/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.addScriptTag({path:path.join(root,'web/merchant/node_modules/axe-core/axe.min.js')});
  const violations=await page.evaluate(async()=>(await /** @type {any} */(window).axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
  assert.deepEqual(violations,[],`progress ${width} ${theme}`);
  await page.screenshot({path:`/tmp/pf-customer-progress-${width}-${theme}.png`,fullPage:true});
  await page.locator('#btnRefreshWallet').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#btnRefreshWallet').evaluate(element=>element===document.activeElement),true);
  await page.evaluate(()=>{const w=/** @type {any} */(window);w.__progress.available_points=60;w.__progress.reward.remaining_points=0;w.__renderProgress();});
  assert.match(await page.locator('#nextReward').textContent(),/Tienes los puntos para/);assert.doesNotMatch(await page.locator('#nextReward').textContent(),/Ya puedes canjear/);
  await page.clock.runFor(60001);assert.match(await page.locator('#nextReward').textContent(),/Actualiza la tarjeta/);assert.equal(await page.locator('#nextRewardBalance').textContent(),'');assert.equal(await page.locator('.cus-reward-ready').count(),0);
  await page.evaluate(()=>{const w=/** @type {any} */(window);w.__progress.next_refresh_at=new Date(Date.now()+500).toISOString();w.__renderProgress(false);});
  assert.match(await page.locator('#nextReward').textContent(),/Datos guardados/);
  await page.evaluate(()=>{const w=/** @type {any} */(window);w.__renderProgress();w.__clearProgress();});
  await page.clock.runFor(600);for(const id of ['#rewards','#nextReward','#nextRewardBalance','#nextRewardConditions','#nextRewardEarning'])assert.equal(await page.locator(id).textContent(),'');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Public reward inventory: manual pauses, branch evidence, automatic freshness expiry, safe session clearing, responsive light/dark, protected progress, pending separation, reward expiry, logout clearing and zero axe violations passed.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
