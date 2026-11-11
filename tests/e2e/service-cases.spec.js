import { test, expect } from '@playwright/test';
import { startPwaStaticServer } from '../integration/helpers/pwa-static-server.js';
test.use({serviceWorkers:'block'});
let server;
test.beforeAll(async()=>{server=await startPwaStaticServer();});test.afterAll(async()=>{await server.stop();});
const caseId='6e431571-1caf-444a-88ad-8d91430e4734';
async function setup(page){
 const state={cases:[],reports:[],resolutions:[],resolutionPaths:[],loseResolveAck:false};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  /** @type {any} */
  let json={ok:true};
  if(path==='/api/staff/me')json={staff:{id:'staff-a',business_id:'business-a',role:'OWNER'},features:{redemptions:true,gift_cards:false}};
  else if(path==='/api/staff/permissions')json={matrix:{OWNER:['staff.award','staff.sync','staff.redeem']}};
  else if(path==='/api/staff/program')json={program_type:'SPEND',program_json:{points_per_q:1}};
  else if(path==='/api/staff/offline-grant')json={grant:'server-signed-offline-grant',expiresAt:new Date(Date.now()+86400000).toISOString()};
  else if(path==='/api/staff/rewards')json={rewards:[{id:'reward-a',name:'Café',points_cost:20}]};
  else if(path==='/api/staff/customer/lookup')json={customer:{id:'customer-a',name:'Cliente de prueba',points:100}};
  else if(path==='/api/staff/service-redemptions')json={redemptions:[{id:'redemption-a',reward_id:'reward-a',points_cost:20,reward_name:'Café',code:'AB123',created_at:new Date().toISOString()}]};
  else if(path==='/api/staff/service-cases'&&route.request().method()==='POST'){const body=route.request().postDataJSON();state.reports.push(body);const row={...body,id:caseId,status:'open',version:1,redemption_id:body.redemptionId,evidence:{reward_name_at_report:'Café',redemption:{points_cost:20}}};state.cases=[row];json={case:row};}
  else if(path==='/api/staff/service-cases')json={cases:state.cases,pagination:{has_more:false}};
  else if(path.endsWith('/resolve')){const resolvedId=path.split('/').at(-2);state.resolutions.push(route.request().postDataJSON());state.resolutionPaths.push(resolvedId);state.cases=state.cases.filter(row=>row.id!==resolvedId);if(state.loseResolveAck){state.loseResolveAck=false;return route.abort('failed');}json={case:{id:resolvedId,status:'resolved'}};}
  else if(path.startsWith('/api/staff/service-cases/'))json={case:state.cases.find(row=>row.id===path.split('/').at(-1)),events:[]};
  else if(path==='/api/staff/redeem'){state.cases=[{id:caseId,status:'open',version:1,kind:'redemption_failed',reason:'Sin existencias.',evidence:{reward_name_at_report:'Café'}}];return route.fulfill({status:409,json:{error:'Reward out of stock',code:'CONFLICT',recoveryCaseId:caseId}});}
  else if(path==='/api/staff/shift-briefing')json={notices:[]};
  else if(path==='/api/staff/service-authority')json={grants:[],owner:true};
  return route.fulfill({json});
 });return state;
}
async function select(page){await page.goto(`${server.baseUrl}/staff?sw=noreload`);await page.fill('#token','signed-qr-token');await page.click('#btnSelectCustomer');await expect(page.locator('#btnRedeem')).toBeEnabled();}
test('counter reports an unfulfilled redemption and attests an agreed alternative',async({page})=>{const state=await setup(page);await select(page);await page.getByText('Resolver una incidencia',{exact:true}).click();await page.getByLabel('Canje relacionado').selectOption('redemption-a');await page.getByLabel('Qué ocurrió').fill('No se pudo entregar el café.');await page.getByRole('button',{name:'Registrar incidencia',exact:true}).click();await expect.poll(()=>state.reports.length).toBe(1);expect(state.reports[0].redemptionId).toBe('redemption-a');await page.getByRole('button',{name:'Revisar caso',exact:true}).click();await page.getByLabel('Cómo se resolvió').selectOption('alternative_accepted');await page.getByLabel('Motivo de la resolución').fill('El cliente aceptó un té.');await expect(page.getByRole('button',{name:'Guardar resolución',exact:true})).toBeDisabled();await page.getByLabel('Confirmo lo descrito con el cliente.').check();await page.getByRole('button',{name:'Guardar resolución',exact:true}).click();await expect.poll(()=>state.resolutions.length).toBe(1);expect(state.resolutions[0].attested).toBe(true);});
test('rejected redemption opens its durable case without claiming a debit',async({page})=>{await setup(page);await select(page);await page.locator('#btnRedeem').click();await expect(page.locator('#staffServiceCases')).toContainText('El intento rechazado no descontó puntos.');await expect(page.locator('#staffServiceCases')).toContainText('Sin existencias.');});
test('service remedies are unavailable offline and no report is queued',async({page,context})=>{const state=await setup(page);await select(page);await page.getByText('Resolver una incidencia',{exact:true}).click();await context.setOffline(true);await expect(page.locator('#staffServiceCases')).toContainText('conexión');await expect(page.getByRole('button',{name:'Registrar incidencia',exact:true})).toBeDisabled();expect(state.reports).toHaveLength(0);});
test('counter case controls fit mobile and meet contrast in both themes',async({page})=>{
 await setup(page);await select(page);await page.getByText('Resolver una incidencia',{exact:true}).click();await page.getByLabel('Canje relacionado').selectOption('redemption-a');await page.getByLabel('Qué ocurrió').fill('No se pudo entregar el café.');await page.getByRole('button',{name:'Registrar incidencia',exact:true}).click();await page.getByRole('button',{name:'Revisar caso',exact:true}).click();await page.getByLabel('Cómo se resolvió').selectOption('points_restored');
 await page.addScriptTag({path:'web/merchant/node_modules/axe-core/axe.min.js'});
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const width of [1200,390])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
  const violations=await page.evaluate(async()=>{const result=await window['axe'].run({include:['#staffServiceCases']},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return result.violations.map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,html:node.html,summary:node.failureSummary}))}));});expect(violations).toEqual([]);
  expect(await page.locator('#staffServiceCases').evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await page.locator('#staffServiceCases').screenshot({path:`/tmp/pf-counter-service-${width}-${theme}.png`});
 }
});

test('same-customer cases with identical resolutions use different request identities',async({page})=>{
 const state=await setup(page);await select(page);state.cases=[caseId,'949769b3-0c1a-4a50-a60d-e07f8219d541'].map(id=>({id,status:'open',version:1,reason:'Beneficio pendiente.',evidence:{reward_name_at_report:'Café'}}));
 await page.getByText('Resolver una incidencia',{exact:true}).click();
 for(let index=0;index<2;index++){
  await page.getByRole('button',{name:'Revisar caso',exact:true}).first().click();await page.getByLabel('Motivo de la resolución').fill('El cliente solicita cerrar el caso.');await page.getByRole('button',{name:'Guardar resolución',exact:true}).click();await expect.poll(()=>state.resolutions.length).toBe(index+1);await expect(page.locator('[data-status]')).toHaveText('Resolución guardada en el historial.');
 }
 expect(state.resolutions[0].requestId).not.toBe(state.resolutions[1].requestId);expect(state.resolutionPaths[0]).not.toBe(state.resolutionPaths[1]);
});
test('retrying an unacknowledged case resolution preserves its request identity',async({page})=>{
 const state=await setup(page);await select(page);state.cases=[{id:caseId,status:'open',version:1,reason:'Beneficio pendiente.',evidence:{reward_name_at_report:'Café'}}];state.loseResolveAck=true;
 await page.getByText('Resolver una incidencia',{exact:true}).click();await page.getByRole('button',{name:'Revisar caso',exact:true}).click();await page.getByLabel('Motivo de la resolución').fill('El cliente solicita cerrar el caso.');await page.getByRole('button',{name:'Guardar resolución',exact:true}).click();await expect.poll(()=>state.resolutions.length).toBe(1);await expect(page.getByRole('button',{name:'Guardar resolución',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Guardar resolución',exact:true}).click();await expect.poll(()=>state.resolutions.length).toBe(2);expect(state.resolutions[0].requestId).toBe(state.resolutions[1].requestId);await expect(page.locator('[data-status]')).toHaveText('Resolución guardada en el historial.');
});
