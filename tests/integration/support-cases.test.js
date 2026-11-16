import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {before,after,describe,it} from 'node:test';
import pg from 'pg';
import express from 'express';
import cookieParser from 'cookie-parser';
import sharp from 'sharp';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const url=process.env.SUPPORT_CASES_TEST_DB_URL;
const suite=url?describe:describe.skip;
let admin,pool,server,origin,service,routes,auth,config,db,csrf,maintenance,challengeCalls=0,challengeOK=true;
const business=randomUUID(),other=randomUUID(),staff=randomUUID(),customer=randomUUID();
const fixture=()=>({requestId:randomUUID(),trackingToken:randomBytes(32).toString('base64url'),name:'Prueba soporte',email:'persona@example.test',category:'access',description:'No puedo ingresar a mi tarjeta desde el navegador.'});
let first,record,superCookie;
const transaction=async task=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE support_test_runtime');await c.query("SELECT set_config('app.platform_admin',$1,true)",[db.getDbPlatformAdmin()?'true':'']);const out=await task(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
const deps={transaction};
const asAdmin=task=>db.runWithDbContext({platformAdmin:true},task);
async function request(path,{body=null,cookie='',method='POST',csrfToken='support-test-csrf'}={}){return fetch(origin+path,{method,headers:{'Content-Type':'application/json',Origin:origin,Cookie:`pf_csrf=support-test-csrf; ${cookie}`,...(csrfToken?{'x-csrf-token':csrfToken}:{})},body:body?JSON.stringify(body):undefined});}
suite('support cases on disposable PostgreSQL with restricted runtime role',()=>{
 before(async()=>{
  const parsed=new URL(url);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.pathname,'/support_cases_test');assert.ok(parsed.port&&parsed.port!=='5432');
  Object.assign(process.env,{NODE_ENV:'test',DB_HOST:'127.0.0.1',DB_PORT:parsed.port,DB_NAME:'support_cases_test',DB_USER:decodeURIComponent(parsed.username),DB_PASSWORD:decodeURIComponent(parsed.password),RATE_LIMIT_DRIVER:'memory',CONTACT_TURNSTILE_SECRET:''});
  admin=new pg.Client({connectionString:url});await admin.connect();pool=new pg.Pool({connectionString:url,max:10});
  await admin.query('DROP TABLE IF EXISTS support_case_events,support_case_attachments,support_cases,staff_users,customers,businesses CASCADE');
  await admin.query("CREATE TABLE businesses(id uuid PRIMARY KEY); CREATE TABLE staff_users(id uuid PRIMARY KEY,business_id uuid,name text,active boolean,role text); CREATE TABLE customers(id uuid PRIMARY KEY,business_id uuid,deleted_at timestamptz); DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='support_test_runtime') THEN CREATE ROLE support_test_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT; END IF; END $$");
  // Static repository migration; no request-controlled filesystem paths.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const migration=await readFile(new URL('../../src/app/migrations/2026-11-16-support-cases.sql',import.meta.url),'utf8');
  await admin.query(migration.replaceAll("'puntos_app'","'support_test_runtime'"));await admin.query(migration.replaceAll("'puntos_app'","'support_test_runtime'"));
  await admin.query('GRANT SELECT ON businesses,staff_users,customers TO support_test_runtime');
  await admin.query('INSERT INTO businesses(id) VALUES($1),($2)',[business,other]);await admin.query("INSERT INTO staff_users VALUES($1,$2,'Owner',true,'OWNER')",[staff,business]);await admin.query('INSERT INTO customers VALUES($1,$2,NULL)',[customer,business]);
  [service,routes,auth,{config},db,csrf,maintenance]=await Promise.all([import('../../src/app/services/support-case-service.js'),import('../../src/app/routes/support-case-routes.js'),import('../../src/app/services/auth-session-service.js'),import('../../src/config/index.js'),import('../../src/app/database.js'),import('../../src/middleware/csrf.js'),import('../../src/app/services/support-case-maintenance.js')]);
  const session=await auth.createBrowserSession({actorType:'SUPER',actorEmail:'operator@example.test'});superCookie=`${config.SUPER_COOKIE_NAME}=${session.token}`;
  const app=express();app.use(cookieParser(),express.json({limit:'1mb'}),csrf.csrfInit);app.use((_req,_res,next)=>db.runWithDbContext({client:null,platformAdmin:false,tenantId:null},next));app.get('/soporte',(_req,res)=>res.sendFile(path.resolve('public/soporte.html'),{dotfiles:'allow'}));app.get('/super/soporte',(_req,res)=>res.sendFile(path.resolve('public/super-support.html'),{dotfiles:'allow'}));app.use(express.static(path.resolve('public')));app.use('/api',routes.createSupportCaseRoutes({serviceDeps:deps,verifyChallenge:async()=>{challengeCalls++;return challengeOK;}}));app.use((e,_req,res,_next)=>res.status(e.statusCode||500).json({error:e.message}));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 });
 after(async()=>{await new Promise(resolve=>server?.close(resolve));await pool?.end();await admin?.end();await db?.closeDatabase();});
 it('saves a real receipt once during concurrent retry and hashes its tracking secret',async()=>{
  first=fixture();let verified=0;const verifier=async()=>{verified++;return true;};const out=await Promise.all([service.createSupportCase(first,{...deps,verify:verifier}),service.createSupportCase(first,{...deps,verify:verifier})]);assert.equal(verified,1);assert.equal(out[0].reference,out[1].reference);assert.equal(out.filter(v=>v.replayed).length,1);record=(await admin.query('SELECT * FROM support_cases WHERE reference=$1',[out[0].reference])).rows[0];assert.equal(record.tracking_hash,service.hashSupportSecret(first.trackingToken));assert.equal(JSON.stringify(record).includes(first.trackingToken),false);assert.equal((await admin.query('SELECT count(*)::int n FROM support_cases')).rows[0].n,1);
  await assert.rejects(service.createSupportCase({...first,description:'Different content already attempted'},{...deps,verify:async()=>true}),{statusCode:409});
 });
 it('does not expose cases, notes or screenshots to another capability or a tenant context',async()=>{
  await assert.rejects(service.trackSupportCase({trackingToken:fixture().trackingToken},deps),{statusCode:404});
  await transaction(async c=>{assert.equal((await c.query('SELECT * FROM support_cases')).rowCount,0);await c.query("SELECT set_config('app.current_tenant',$1,true)",[business]);assert.equal((await c.query('SELECT * FROM support_cases')).rowCount,0);await assert.rejects(c.query("UPDATE support_cases SET email='steal@example.test' WHERE id=$1",[record.id]),{code:'42501'});});
 });
 it('separates internal notes from public responses and rejects stale/invalid transitions',async()=>{
  const update={requestId:randomUUID(),version:1,status:'open',assignedTo:'agent@example.test',visibility:'internal',message:'Private investigation note'};
  const result=await asAdmin(()=>service.updateSupportCase(record.id,update,'operator@example.test',deps));assert.equal(result.case.version,2);assert.equal(result.events.at(-1).actor_email,'operator@example.test');
  const replay=await asAdmin(()=>service.updateSupportCase(record.id,update,'operator@example.test',deps));assert.equal(replay.case.version,2);
  await assert.rejects(asAdmin(()=>service.updateSupportCase(record.id,{...update,requestId:randomUUID()},'operator@example.test',deps)),{statusCode:409});
  const publicView=await service.trackSupportCase({trackingToken:first.trackingToken},deps);assert.equal(JSON.stringify(publicView).includes('Private investigation'),false);assert.equal(JSON.stringify(publicView).includes('@example'),false);
  await asAdmin(()=>service.updateSupportCase(record.id,{...update,requestId:randomUUID(),version:2,status:'waiting',visibility:'public',message:'Indica la hora del error.'},'operator@example.test',deps));
  assert.equal((await service.trackSupportCase({trackingToken:first.trackingToken},deps)).events.at(-1).message,'Indica la hora del error.');
 });
 it('records customer replies idempotently and reopens waiting cases',async()=>{
  const input={trackingToken:first.trackingToken,requestId:randomUUID(),message:'El error ocurrió a las diez.'};const results=await Promise.all([service.replySupportCase(input,deps),service.replySupportCase(input,deps)]);assert.equal(results[0].status,'open');assert.equal(results[0].events.length,results[1].events.length);assert.equal(results[0].events.at(-1).kind,'customer');await assert.rejects(service.replySupportCase({...input,message:'Different message.'},deps),{statusCode:409});
 });
 it('audits atomically: failed event insert rolls back status and assignment',async()=>{
  await admin.query("CREATE OR REPLACE FUNCTION fail_support_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.message='force audit failure' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER support_fail BEFORE INSERT ON support_case_events FOR EACH ROW EXECUTE FUNCTION fail_support_audit()");
  const before=await asAdmin(()=>service.getSupportCase(record.id,deps));try{await assert.rejects(asAdmin(()=>service.updateSupportCase(record.id,{requestId:randomUUID(),version:before.case.version,status:'closed',assignedTo:null,visibility:'internal',message:'force audit failure'},'operator@example.test',deps)),/audit unavailable/);}finally{await admin.query('DROP TRIGGER support_fail ON support_case_events; DROP FUNCTION fail_support_audit()');}
  assert.equal((await asAdmin(()=>service.getSupportCase(record.id,deps))).case.version,before.case.version);
 });
 it('validates decoded screenshot types, strips metadata, protects access and physically purges expired bytes',async()=>{
  const bytes=await sharp({create:{width:20,height:20,channels:3,background:'#ff8800'}}).jpeg().withMetadata({exif:{IFD0:{Artist:'private metadata'}}}).toBuffer();const input={...fixture(),attachment:{data:bytes.toString('base64')}};const created=await service.createSupportCase(input,{...deps,verify:async()=>true});assert.equal(created.attachment.available,true);
  const row=await service.getSupportAttachment({trackingToken:input.trackingToken},deps),meta=await sharp(row.data).metadata();assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);assert.equal(meta.icc,undefined);assert.equal(row.data.includes(Buffer.from('private metadata')),false);
  await assert.rejects(service.getSupportAttachment({trackingToken:first.trackingToken},deps),{statusCode:404});
  for(const data of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),Buffer.from('not an image'),bytes.subarray(0,30),await sharp({create:{width:5000,height:1,channels:3,background:'red'}}).png().toBuffer()])await assert.rejects(service.createSupportCase({...fixture(),attachment:{data:data.toString('base64')}},{...deps,verify:async()=>true}),{statusCode:400});
  await assert.rejects(service.createSupportCase({...fixture(),attachment:{data:Buffer.alloc(614401).toString('base64')}},{...deps,verify:async()=>true}),{statusCode:400});
  await admin.query("UPDATE support_case_attachments SET expires_at=clock_timestamp()-interval '1 second'");await assert.rejects(service.getSupportAttachment({trackingToken:input.trackingToken},deps),{statusCode:404});const removed=await asAdmin(()=>maintenance.purgeExpiredSupportAttachments(deps));assert.equal(removed.deleted,1);assert.equal((await admin.query('SELECT count(*)::int n FROM support_case_attachments')).rows[0].n,0);
 });
 it('validates active account context and ignores caller-supplied membership',async()=>{
  const session=await auth.createBrowserSession({actorType:'STAFF',actorId:staff,businessId:business});const req={body:{includeAccount:true,businessId:other},cookies:{[config.STAFF_COOKIE_NAME]:session.token}};
  assert.deepEqual(await routes.verifiedSupportContext(req),{businessId:business,actorType:'STAFF',actorId:staff});await admin.query('UPDATE staff_users SET active=false WHERE id=$1',[staff]);assert.equal(await routes.verifiedSupportContext(req),null);await admin.query('UPDATE staff_users SET active=true WHERE id=$1',[staff]);await auth.invalidateBrowserSessionById(session.session.id,'test');assert.equal(await routes.verifiedSupportContext(req),null);
  assert.equal(await routes.verifiedSupportContext({...req,body:{includeAccount:false}}),null);
 });
 it('enforces API auth, CSRF, challenge validation and does not reverify a durable retry',async()=>{
  assert.equal((await request('/api/super/support/cases',{method:'GET'})).status,401);
  const payload=fixture();assert.equal((await request('/api/public/support/cases',{body:payload,csrfToken:''})).status,403);challengeOK=false;assert.equal((await request('/api/public/support/cases',{body:payload})).status,400);challengeOK=true;
  assert.equal((await request('/api/public/support/cases',{body:payload})).status,201);const before=challengeCalls;assert.equal((await request('/api/public/support/cases',{body:payload})).status,200);assert.equal(challengeCalls,before);
  const response=await request('/api/public/support/track',{body:{trackingToken:payload.trackingToken}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.equal((await request('/api/super/support/cases',{method:'GET',cookie:superCookie})).status,200);assert.equal((await request('/api/super/support/cases?search=private',{method:'GET',cookie:superCookie})).status,400);assert.equal((await request('/api/super/support/search',{body:{search:'persona@example.test'},cookie:superCookie})).status,200);
  assert.equal((await request('/api/public/support/cases',{body:{...fixture(),businessId:other}})).status,400);
 });
 it('browser saves, recovers a lost response, tracks, replies and shows staff-only notes at mobile and desktop sizes',async()=>{
  const browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();const errors=[];page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  try{
   const pageResponse=await page.goto(origin+'/soporte');assert.equal(pageResponse.status(),200,await page.locator('body').innerText());await page.getByLabel('Tu nombre',{exact:true}).fill('Persona del navegador');await page.getByLabel('Correo de contacto',{exact:true}).fill('browser@example.test');await page.getByLabel('Categoría',{exact:true}).selectOption('access');await page.getByLabel('Descripción',{exact:true}).fill('No puedo entrar desde mi navegador de prueba.');
   const image=await sharp({create:{width:32,height:24,channels:3,background:'#f0dda5'}}).png().toBuffer();await page.locator('#support-file').setInputFiles({name:'captura.png',mimeType:'image/png',buffer:image});
   await page.getByText('Revisar los datos de diagnóstico',{exact:true}).click();assert.match(await page.locator('#diagnostics-preview').innerText(),/Navegador/);await page.getByLabel('Incluir datos básicos del navegador y conexión.').check();
   // Lose the response after the server commits: retry must recover the same receipt.
   await page.route('**/api/public/support/cases',async route=>{await route.fetch();await route.abort('failed');},{times:1});await page.getByRole('button',{name:'Enviar reporte',exact:true}).click();await page.locator('#support-feedback').filter({hasText:'sin duplicarlo'}).waitFor();assert.equal(await page.getByLabel('Tu nombre',{exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Enviar reporte',exact:true}).click();await page.locator('#case-heading').filter({hasText:'Caso PF-'}).waitFor();const link=await page.locator('#case-link').getAttribute('href');const reference=(await page.locator('#case-heading').innerText()).replace('Caso ','');const stored=(await admin.query('SELECT * FROM support_cases WHERE reference=$1',[reference])).rows[0];assert.equal((await admin.query("SELECT count(*)::int n FROM support_cases WHERE email='browser@example.test'")).rows[0].n,1);assert.equal(stored.diagnostics.screen,'support');
   await page.getByLabel('Añadir información',{exact:true}).fill('Me pasó durante la mañana.');await page.getByRole('button',{name:'Enviar al caso',exact:true}).click();await page.locator('#case-events').filter({hasText:'Me pasó durante la mañana.'}).waitFor();await page.getByRole('button',{name:'Ver captura adjunta',exact:true}).click();await page.locator('#case-attachment').waitFor({state:'visible'});
   await context.addCookies([{name:config.SUPER_COOKIE_NAME,value:superCookie.split('=')[1],url:origin}]);const adminPage=await context.newPage();await adminPage.goto(origin+'/super/soporte');await adminPage.getByRole('button').filter({hasText:reference}).click();await adminPage.locator('#case-update [name=message]').fill('Browser private note');await adminPage.getByRole('button',{name:'Guardar seguimiento'}).click();await adminPage.locator('#admin-events').filter({hasText:'Browser private note'}).waitFor();await adminPage.locator('#case-update [name=visibility]').selectOption('public');await adminPage.locator('#case-update [name=status]').selectOption('waiting');await adminPage.locator('#case-update [name=message]').fill('Gracias. ¿Puedes indicar la hora exacta?');await adminPage.getByRole('button',{name:'Guardar seguimiento'}).click();await adminPage.locator('#admin-events').filter({hasText:'Gracias. ¿Puedes indicar la hora exacta?'}).waitFor();
   await page.goto(link);await page.locator('#case-events').filter({hasText:'Gracias. ¿Puedes indicar la hora exacta?'}).waitFor();assert.equal(page.url().includes('#'),false);assert.equal((await page.locator('#case-events').innerText()).includes('Browser private note'),false);
   const artifact='/tmp/pf-support-screenshots';await mkdir('/tmp/pf-support-screenshots',{recursive:true});for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(artifact,`support-tracking-${width}.png`),fullPage:true});await page.goto(origin+'/soporte');await page.screenshot({path:path.join(artifact,`support-form-${width}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.goto(link);await page.locator('#case-receipt').waitFor({state:'visible'});}
   await adminPage.setViewportSize({width:1440,height:1000});await adminPage.evaluate(()=>window.scrollTo(0,0));await adminPage.screenshot({path:path.join(artifact,'support-admin-1440.png'),fullPage:true});assert.deepEqual(errors,[]);assert.equal(await page.locator('#track-form').getAttribute('method'),'post');assert.equal(await adminPage.locator('#queue-filters').getAttribute('method'),'post');
  }catch(error){await page.screenshot({path:'/tmp/support-browser-failure.png',fullPage:true});error.message+=` Page: ${page.url()} Errors: ${JSON.stringify(errors)} Feedback: ${await page.locator('#support-feedback').textContent().catch(()=>'-')}`;throw error;}finally{await browser.close();}
 });
 it('blocks closed case replies, invalid transitions and excessive submissions',async()=>{
  const detail=await asAdmin(()=>service.getSupportCase(record.id,deps));await asAdmin(()=>service.updateSupportCase(record.id,{requestId:randomUUID(),version:detail.case.version,status:'closed',assignedTo:null,visibility:'internal',message:'Close test case'},'operator@example.test',deps));
  await assert.rejects(service.replySupportCase({trackingToken:first.trackingToken,requestId:randomUUID(),message:'Another reply'},deps),{statusCode:409});
  await assert.rejects(asAdmin(()=>service.updateSupportCase(record.id,{requestId:randomUUID(),version:detail.case.version+1,status:'waiting',assignedTo:null,visibility:'internal',message:''},'operator@example.test',deps)),{statusCode:409});
  let limited=false;for(let i=0;i<10;i++){const r=await request('/api/public/support/cases',{body:fixture()});if(r.status===429){limited=true;break;}}assert.equal(limited,true);
 });
});
