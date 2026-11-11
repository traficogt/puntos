import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
const connectionString = process.env.ACQUISITION_TEST_DATABASE_URL;
test('acquisition DB: bounded sources, scoped visits, atomic immutable signup attribution and honest purchase totals', { skip: !connectionString }, async t => {
  const db = new pg.Client({ connectionString }); await db.connect();
  const peers=[];
  const schema = `acquisition_${crypto.randomBytes(6).toString('hex')}`;
  try {
    await db.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema},public; CREATE SCHEMA IF NOT EXISTS app;
      CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.current_tenant',true),'')::uuid $$;
      CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.platform_admin',true),'')='true' $$;`);
    // Fixed repository fixture paths; no request input is used.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await db.query(await fs.readFile(new URL('../../src/app/schema.sql',import.meta.url),'utf8'));
    // Fixed repository fixture paths; no request input is used.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await db.query(await fs.readFile(new URL('../../src/app/migrations/2026-11-10-acquisition.sql',import.meta.url),'utf8'));
    const { createAcquisitionService } = await import('../../src/app/services/acquisition-service.js');
    const bid=crypto.randomUUID(), other=crypto.randomUUID(), branch=crypto.randomUUID(), customer=crypto.randomUUID(), second=crypto.randomUUID();
    await db.query("INSERT INTO businesses(id,name,slug,email,password_hash) VALUES ($1,'One','one','one@example.test','x'),($2,'Two','two','two@example.test','x')",[bid,other]);
    await db.query("INSERT INTO branches(id,business_id,name,code) VALUES ($1,$2,'Other','other')",[branch,other]);
    const tx=async fn=>{await db.query('BEGIN');try {const out=await fn(db);await db.query('COMMIT');return out;}catch(e){await db.query('ROLLBACK');throw e;}};
    const service=createAcquisitionService({query:(sql,args)=>db.query(sql,args), transaction:tx, context:(_ctx,fn)=>fn()});
    const peersServices=[];
    for(let i=0;i<2;i++){
      const peer=new pg.Client({connectionString});await peer.connect();peers.push(peer);await peer.query(`SET search_path TO ${schema},public`);
      const transaction=async fn=>{await peer.query('BEGIN');try{const out=await fn(peer);await peer.query('COMMIT');return out;}catch(e){await peer.query('ROLLBACK');throw e;}};
      peersServices.push({transaction,service:createAcquisitionService({query:(sql,args)=>peer.query(sql,args),transaction,context:(_ctx,fn)=>fn()})});
    }
    const one={id:bid,slug:'one'}, two={id:other,slug:'two'};
    await assert.rejects(service.createSource(one,{name:'Bad',branch_id:branch,request_id:crypto.randomUUID()}),/sucursal/i);
    const req=crypto.randomUUID();
    const source=await service.createSource(one,{name:'Mostrador',request_id:req});
    assert.deepEqual(await service.createSource(one,{name:'Mostrador',request_id:req}),source);
    await assert.rejects(service.createSource(one,{name:'Changed',request_id:req}),/solicitud/i);
    assert.equal(await service.getSource(other,source.id),null);
    assert.equal((await service.visit(two,source.code)).visit_token,null);
    assert.equal((await service.visit(one,'old-code')).visit_token,null);
    const visit=await service.visit(one,source.code);
    assert.match(visit.visit_token,/^[A-Za-z0-9_-]{43}$/);
    const row=(await db.query('SELECT * FROM acquisition_visits')).rows[0];
    assert.equal(JSON.stringify(row).includes(visit.visit_token),false);
    assert.equal(Object.keys(row).some(k=>/phone|email|ip_address|user_agent|fingerprint/.test(k)),false);
    await db.query("INSERT INTO customers(id,business_id,phone) VALUES ($1,$3,'50255551111'),($2,$3,'50255552222')",[customer,second,bid]);
    assert.equal(await tx(c=>service.attributeVerified(c,{businessId:other,customerId:customer,visitToken:visit.visit_token,isNewCustomer:true})),false);
    const concurrent=await Promise.all(peersServices.map(p=>p.transaction(c=>p.service.attributeVerified(c,{businessId:bid,customerId:customer,visitToken:visit.visit_token,isNewCustomer:true}))));
    assert.deepEqual(concurrent.sort(),[false,true]);
    assert.equal(await tx(c=>service.attributeVerified(c,{businessId:bid,customerId:second,visitToken:visit.visit_token,isNewCustomer:true})),false);
    const source2=await service.createSource(one,{name:'Mesa',request_id:crypto.randomUUID()});
    const {verifyJoinCodeWithDeps}=await import('../../src/app/services/customer-service.js');
    const {CustomerRepo}=await import('../../src/app/repositories/customer-repository.js');
    const {VerifyCodeRepo}=await import('../../src/app/repositories/verify-code-repository.js');
    const {runWithDbContext,withDbClientContext}=await import('../../src/app/database.js');
    const {TierService}=await import('../../src/app/services/tier-service.js');
    const {GamificationService}=await import('../../src/app/services/gamification-service.js');
    // Only unrelated post-signup rewards and token signing are replaced; enrollment,
    // phone verification repositories, transactions and attribution use real PG.
    t.mock.method(TierService,'getCustomerTierInfo',async()=>null);
    t.mock.method(GamificationService,'checkAndAwardAchievements',async()=>null);
    const verifyDeps={CustomerRepo,VerifyCodeRepo,withDbClientContext,withTransaction:tx,recordAcquisition:service.attributeVerified,signCustomerToken:async()=> 'isolated-session'};
    const realVisit=await service.visit(one,source2.code);
    await runWithDbContext({client:db,tenantId:bid,platformAdmin:false},async()=>{
      const phone='50255553333';
      await VerifyCodeRepo.create({id:crypto.randomUUID(),business_id:bid,phone,code_hash:await bcrypt.hash('123456',4),expires_at:new Date(Date.now()+600000)});
      const input={business:one,phone,code:'123456',name:'Fixture',referralCode:null,visitToken:realVisit.visit_token};
      await assert.rejects(verifyJoinCodeWithDeps(verifyDeps,{...input,code:'999999'}),/inválido/);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM acquisition_attributions WHERE source_id=$1',[source2.id])).rows[0].n,0);
      await assert.rejects(verifyJoinCodeWithDeps({...verifyDeps,withTransaction:fn=>tx(async client=>{await fn(client);throw new Error('enrollment-rollback');})},input),/enrollment-rollback/);
      assert.equal(await CustomerRepo.getByBusinessAndPhone(bid,phone),null);
      assert.ok(await VerifyCodeRepo.latestValid(bid,phone));
      const verified=await verifyJoinCodeWithDeps(verifyDeps,input);
      assert.equal(verified.token,'isolated-session');
      assert.equal((await db.query('SELECT source_id FROM acquisition_attributions WHERE customer_id=$1',[verified.customer.id])).rows[0].source_id,source2.id);
      await assert.rejects(verifyJoinCodeWithDeps(verifyDeps,input),/código válido/);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM acquisition_attributions WHERE customer_id=$1',[verified.customer.id])).rows[0].n,1);
    });

    const another=await service.visit(one,source2.code);
    assert.equal(await tx(c=>service.attributeVerified(c,{businessId:bid,customerId:customer,visitToken:another.visit_token,isNewCustomer:true})),false);
    const expired=await service.visit(one,source.code);
    await db.query("UPDATE acquisition_visits SET expires_at=now()-interval '1 second'");
    assert.equal(await tx(c=>service.attributeVerified(c,{businessId:bid,customerId:second,visitToken:expired.visit_token,isNewCustomer:true})),false);
    const existing=await service.visit(one,source.code);
    assert.equal(await tx(c=>service.attributeVerified(c,{businessId:bid,customerId:second,visitToken:existing.visit_token,isNewCustomer:false})),false);
    assert.equal(await tx(c=>service.attributeVerified(c,{businessId:bid,customerId:second,visitToken:existing.visit_token,isNewCustomer:true})),false);
    const rollback=await service.visit(one,source.code);
    await assert.rejects(tx(async c=>{await service.attributeVerified(c,{businessId:bid,customerId:second,visitToken:rollback.visit_token,isNewCustomer:true});throw new Error('rollback');}),/rollback/);
    assert.equal(await tx(c=>service.attributeVerified(c,{businessId:bid,customerId:second,visitToken:rollback.visit_token,isNewCustomer:true})),true);
    await db.query("INSERT INTO transactions(business_id,customer_id,type,amount_q,status) VALUES ($1,$2,'PURCHASE',25,'POSTED'),($1,$2,'PURCHASE',50,'PENDING'),($1,$2,'PURCHASE',100,'REVERSED'),($1,$2,'BONUS',500,'POSTED')",[bid,customer]);
    // Older non-sale ledger writers leave type at its PURCHASE default.
    await db.query("INSERT INTO transactions(business_id,customer_id,source,amount_q) VALUES ($1,$2,'redeem',20),($1,$2,'expire',0),($1,$2,'lifecycle',100),($1,$2,'online',0)",[bid,second]);
    await db.query("INSERT INTO transactions(business_id,customer_id,type,source,amount_q) VALUES ($1,$2,NULL,'offline',5)",[bid,second]);
    await db.query("INSERT INTO transactions(business_id,customer_id,source,amount_q,original_transaction_id) VALUES ($1,$2,'online',10,$3)",[bid,second,crypto.randomUUID()]);
    await db.query("INSERT INTO transactions(business_id,customer_id,source,amount_q,reversed_transaction_id) VALUES ($1,$2,'online',30,$3)",[bid,second,crypto.randomUUID()]);
    let report=await service.report(one,'https://puntos.example');
    let metric=report.sources.find(s=>s.id===source.id);
    assert.equal(metric.registrations,2);assert.equal(metric.first_purchasers,2);assert.equal(metric.repeat_purchasers,1);assert.equal(metric.recorded_sales_q,80);assert.equal(metric.visits,4);
    await db.query('UPDATE customers SET deleted_at=now() WHERE id=$1',[customer]);
    report=await service.report(one,'https://puntos.example'); metric=report.sources.find(s=>s.id===source.id);
    assert.equal(metric.registrations,2); assert.equal(metric.first_purchasers,1); assert.equal(metric.recorded_sales_q,5); assert.equal(metric.active_customers,1);
    await db.query('DELETE FROM customers WHERE id=$1',[customer]);
    assert.equal((await service.report(one,'https://puntos.example')).sources.find(s=>s.id===source.id).registrations,2);
    // Tenant RLS is exercised using an unprivileged role, not the schema owner.
    await db.query(`CREATE ROLE ${schema} NOLOGIN; GRANT USAGE ON SCHEMA ${schema},app TO ${schema}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${schema}; SET ROLE ${schema}`);
    await db.query("SELECT set_config('app.current_tenant',$1,false)",[other]);
    assert.equal((await db.query('SELECT * FROM acquisition_sources')).rowCount,0);
    await db.query('RESET ROLE');
    for(let i=2;i<99;i++) await service.createSource(one,{name:`Source ${i}`,request_id:crypto.randomUUID()});
    const limited=await Promise.allSettled(peersServices.map(p=>p.service.createSource(one,{name:'Concurrent limit',request_id:crypto.randomUUID()})));
    assert.equal(limited.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(limited.filter(r=>r.status==='rejected').length,1);
    await assert.rejects(service.createSource(one,{name:'Too many',request_id:crypto.randomUUID()}),/100/);
    assert.equal((await service.listSources(one,'https://puntos.example')).sources.length,100);
  } finally {
    for(const peer of peers)await peer.end();
    await db.query('RESET ROLE');
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
    if((await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[schema])).rowCount)await db.query(`DROP OWNED BY ${schema}; DROP ROLE ${schema}`);
    await db.end();
  }
});
