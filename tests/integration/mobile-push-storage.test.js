/* eslint-disable security/detect-non-literal-fs-filename -- Repository schema files only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
const databaseUrl = process.env.MOBILE_PUSH_TEST_DATABASE_URL;
test('mobile push real SQL consent, ownership, isolation and durable delivery', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl);
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /^\/mobile_push_test(?:_[a-z0-9_]+)?$/);
  const migration = await readFile(new URL('../../src/app/migrations/2026-11-10-mobile-push.sql', import.meta.url), 'utf8').catch(() => '');
  assert.ok(migration, 'mobile push migration exists');
  const { MobilePushRepo: repo } = await import('../../src/app/repositories/mobile-push-repository.js');
  const { runWithDbContext } = await import('../../src/app/database.js');
  const admin = new pg.Client({ connectionString: databaseUrl }), client = new pg.Client({ connectionString: databaseUrl }), peer = new pg.Client({ connectionString: databaseUrl });
  await Promise.all([admin.connect(), client.connect(), peer.connect()]);
  const businessId = randomUUID(), otherBusinessId = randomUUID(), customerId = randomUUID(), otherCustomerId = randomUUID(), sessionId = randomUUID();
  const role = 'mobile_push_test_runtime';
  async function context(tenantId, fn, connection = client, platformAdmin = false) {
    await connection.query("SELECT set_config('app.current_tenant',$1,false),set_config('app.platform_admin',$2,false)", [tenantId || '', platformAdmin ? 'true' : '']);
    return runWithDbContext({ client: connection, tenantId, platformAdmin }, fn);
  }
  async function transaction(fn) { await client.query('BEGIN'); try { const r = await fn(); await client.query('COMMIT'); return r; } catch (e) { await client.query('ROLLBACK'); throw e; } }
  const input = { installationId: randomUUID(), installationSecret: randomBytes(32).toString('base64url'), token: 'ab'.repeat(32), businessId, customerId, sessionId, topic: 'com.puntosfieles.customer' };
  const register = data => context(null, () => repo.register(data, transaction), client, true);
  const global = fn => context(null, fn, client, true);
  try {
    await admin.query('DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public');
    for (const file of ['schema.sql', 'migrations/2026-02-27-tenant-rls_canonical.sql', 'migrations/2026-03-19-auth-sessions.sql','migrations/2026-03-19-auth-session-mutations.sql']) await admin.query(await readFile(new URL(`../../src/app/${file}`, import.meta.url), 'utf8'));
    await admin.query(migration); await admin.query(migration);
    await admin.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await admin.query(`GRANT USAGE ON SCHEMA public, app TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${role}; REVOKE SELECT,DELETE ON auth_sessions FROM ${role}; GRANT EXECUTE ON FUNCTION app.mobile_push_session_valid(uuid,uuid,uuid,boolean),app.auth_session_invalidate_by_id(uuid,text) TO ${role}`);
    await client.query(`SET ROLE ${role}`); await peer.query(`SET ROLE ${role}`);
    for (const id of [businessId, otherBusinessId]) await admin.query("INSERT INTO businesses (id,name,slug,email,password_hash) VALUES ($1::uuid,'Shop',$1::text,$1::text||'@example.invalid','test')", [id]);
    for (const [id, bid] of [[customerId,businessId],[otherCustomerId,otherBusinessId]]) {
      await admin.query("INSERT INTO customers (id,business_id,phone,name) VALUES ($1,$2,'50255554444','Ana')", [id,bid]);
      await admin.query('INSERT INTO customer_balances (customer_id,points,pending_points) VALUES ($1,10,2)', [id]);
    }
    await admin.query("INSERT INTO auth_sessions(id,session_token_hash,actor_type,actor_id,business_id,idle_expires_at,absolute_expires_at) VALUES($1::uuid,$1::text,'CUSTOMER',$2,$3,now()+interval '1 day',now()+interval '2 days')", [sessionId,customerId,businessId]);
    await t.test('registration starts at a locked baseline, encrypts token, hashes credential, and returns no credentials', async () => {
      const first = await register(input); assert.equal(first.enabled,true); assert.ok(first.expiresAt);
      const row = (await admin.query('SELECT * FROM mobile_push_devices WHERE installation_id=$1',[input.installationId])).rows[0];
      assert.match(row.token_ciphertext,/^enc:v2:/); assert.notEqual(row.secret_hash,input.installationSecret);
      assert.equal(row.baseline_points,10); assert.equal(row.baseline_pending,2); assert.equal(row.revision,row.synced_revision);
      assert.deepEqual(await global(() => repo.claimDue()),[]);
      assert.equal(JSON.stringify(first).includes(input.token),false);
    });
    await t.test('wrong installation secret and reused token cannot take ownership; no foreign tenant reads', async () => {
      for (const data of [{...input,installationSecret:randomBytes(32).toString('base64url')},{...input,installationId:randomUUID()},{...input,customerId:otherCustomerId}]) await assert.rejects(register(data));
      assert.equal(await context(otherBusinessId,()=>repo.getDevice(input.installationId)),null);
      assert.equal(await context(null,()=>repo.getDevice(input.installationId)),null);
      await global(()=>repo.revoke(input.installationId,randomBytes(32).toString('base64url')));
      assert.equal((await global(()=>repo.getDevice(input.installationId))).enabled,true);
    });
    await t.test('session predicate denies absent and foreign tenants; raw identity cannot be forged', async () => {
      assert.equal((await context(null,()=>client.query('SELECT app.mobile_push_session_valid($1,$2,$3,false) AS valid',[sessionId,customerId,businessId]))).rows[0].valid,false);
      assert.equal((await context(otherBusinessId,()=>client.query('SELECT app.mobile_push_session_valid($1,$2,$3,false) AS valid',[sessionId,customerId,businessId]))).rows[0].valid,false);
      await assert.rejects(context(businessId,()=>client.query("UPDATE mobile_push_devices SET customer_id=$1 WHERE installation_id=$2",[otherCustomerId,input.installationId])),{code:'23503'});
      await assert.rejects(context(businessId,()=>client.query("UPDATE mobile_push_devices SET secret_hash=repeat('a',64) WHERE installation_id=$1",[input.installationId])),{code:'23514'});
    });
    await t.test('confirmed balance changes enqueue work; claims are bounded and exclude concurrent claims', async () => {
      await context(businessId,()=>client.query('UPDATE customer_balances SET points=25,pending_points=0 WHERE customer_id=$1',[customerId]));
      const claims = await global(()=>repo.claimDue(1)); assert.equal(claims.length,1);
      assert.deepEqual(await context(null,()=>repo.claimDue(1),peer,true),[]);
      const snapshot = await global(()=>repo.getSnapshot(claims[0])); assert.equal(snapshot.points,25); assert.equal(snapshot.baseline_points,10);
      await context(businessId,()=>client.query('UPDATE customer_balances SET points=30 WHERE customer_id=$1',[customerId]));
      await global(()=>repo.acknowledge(claims[0],snapshot));
      const next = await global(()=>repo.claimDue(1)); assert.equal(next.length,1);
      const latest = await global(()=>repo.getSnapshot(next[0])); assert.equal(latest.baseline_points,25); assert.equal(latest.points,30);
      await global(()=>repo.acknowledge(claims[0],snapshot));
      assert.ok(await global(()=>repo.getSnapshot(next[0])),'stale acknowledgement cannot release replacement lease');
      await global(()=>repo.acknowledge(next[0],latest));
    });
    await t.test('renewal preserves pending events; generation invalidates in-flight claim and acknowledgement', async () => {
      await context(businessId,()=>client.query('UPDATE customer_balances SET pending_points=4 WHERE customer_id=$1',[customerId]));
      const [old] = await global(()=>repo.claimDue()); const oldSnapshot = await global(()=>repo.getSnapshot(old));
      await register(input);
      assert.equal(await global(()=>repo.getSnapshot(old)),null);
      assert.equal(await global(()=>repo.acknowledge(old,oldSnapshot)),null);
      const [claim] = await global(()=>repo.claimDue()); assert.ok(claim);
      await global(()=>repo.acknowledge(claim,oldSnapshot));
    });

    await t.test('new registration waits for in-flight balance commit and never alerts historical activity', async () => {
      const fresh={...input,installationId:randomUUID(),token:'cd'.repeat(32)};
      await peer.query('BEGIN');
      let pending;
      try {
        await context(businessId,()=>peer.query('UPDATE customer_balances SET points=37 WHERE customer_id=$1',[customerId]),peer);
        const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        let settled=false;
        pending=register(fresh).then(value=>{settled=true;return value;});
        const deadline=Date.now()+2000;
        let waiting=false;
        while(!settled && Date.now()<deadline){
          const activity=await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
          if(activity.rows[0]?.wait_event_type==='Lock'){waiting=true;break;}
          await new Promise(resolve=>setTimeout(resolve,5));
        }
        assert.equal(waiting,true);
        await peer.query('COMMIT');await pending;
        const device=await global(()=>repo.getDevice(fresh.installationId));
        assert.equal(device.baseline_points,37);assert.equal(device.synced_revision,device.revision);
        const claims=await global(()=>repo.claimDue());
        assert.ok(claims.every(claim=>claim.installation_id!==fresh.installationId));
        for(const claim of claims) await global(async()=>repo.acknowledge(claim,await repo.getSnapshot(claim)));
      }finally{await peer.query('ROLLBACK');await pending;await global(()=>repo.revoke(fresh.installationId,fresh.installationSecret));}
    });
    await t.test('account deletion cannot deadlock registration on the session/customer lock order',async()=>{
      const tempCustomer=randomUUID(),tempSession=randomUUID();
      await admin.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,'50255553333','Test')",[tempCustomer,businessId]);
      await admin.query("INSERT INTO auth_sessions(id,session_token_hash,actor_type,actor_id,business_id,idle_expires_at,absolute_expires_at) VALUES($1::uuid,$1::text,'CUSTOMER',$2,$3,now()+interval '1 day',now()+interval '2 days')",[tempSession,tempCustomer,businessId]);
      await peer.query('BEGIN');
      let pending;
      try{
        await context(businessId,()=>peer.query('UPDATE customers SET deleted_at=now() WHERE id=$1',[tempCustomer]),peer);
        const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        pending=register({...input,installationId:randomUUID(),token:'ef'.repeat(32),customerId:tempCustomer,sessionId:tempSession}).catch(error=>error);
        const deadline=Date.now()+2000;
        while(Date.now()<deadline){
          const activity=await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
          if(activity.rows[0]?.wait_event_type==='Lock') break;
          await new Promise(resolve=>setTimeout(resolve,5));
        }
        await peer.query("SET LOCAL lock_timeout='200ms'");
        await peer.query("SELECT app.auth_session_invalidate_by_id($1,'customer_deleted')",[tempSession]);
        await peer.query('COMMIT');
        const outcome=await pending;
        assert.ok(outcome.statusCode===409 || outcome.enabled===true);
        assert.equal((await admin.query('SELECT deleted_at FROM customers WHERE id=$1',[tempCustomer])).rows[0].deleted_at!==null,true);
        assert.deepEqual(await global(()=>repo.claimDue()),[]);
      }finally{await peer.query('ROLLBACK');await pending;}
    });
    await t.test('rolled-back balance writes never enqueue notification work', async()=>{
      await peer.query('BEGIN');
      await context(businessId,()=>peer.query('UPDATE customer_balances SET points=999 WHERE customer_id=$1',[customerId]),peer);
      await peer.query('ROLLBACK');
      assert.deepEqual(await global(()=>repo.claimDue()),[]);
    });
    for(const phase of ['foreign-key insert','last-visit update']) await t.test(`registration permits balance-first ledger ${phase}`,async()=>{
      await peer.query('BEGIN');let pending;
      try{
        if(phase==='last-visit update') await context(businessId,()=>peer.query("INSERT INTO transactions(id,business_id,customer_id,points,source) VALUES($1,$2,$3,1,'staff')",[randomUUID(),businessId,customerId]),peer);
        await context(businessId,()=>peer.query('UPDATE customer_balances SET points=points+1 WHERE customer_id=$1',[customerId]),peer);
        const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        let settled=false;
        pending=register(input).then(value=>{settled=true;return value;});
        const deadline=Date.now()+2000;let waiting=false;
        while(!settled && Date.now()<deadline){
          const activity=await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
          if(activity.rows[0]?.wait_event_type==='Lock'){waiting=true;break;}
          await new Promise(resolve=>setTimeout(resolve,5));
        }
        assert.equal(waiting,true);
        await peer.query("SET LOCAL lock_timeout='200ms'");
        if(phase==='foreign-key insert') await peer.query("INSERT INTO transactions(id,business_id,customer_id,points,source) VALUES($1,$2,$3,-1,'expire')",[randomUUID(),businessId,customerId]);
        else await peer.query('UPDATE customers SET last_visit_at=now() WHERE id=$1',[customerId]);
        await peer.query('COMMIT');await pending;
        const claims=await global(()=>repo.claimDue());
        for(const claim of claims) await global(async()=>repo.acknowledge(claim,await repo.getSnapshot(claim)));
      }finally{await peer.query('ROLLBACK');await pending;}
    });
    await t.test('customer deletion cannot lock a purchase behind its own balance-trigger device write',async()=>{
      await peer.query('BEGIN');let deletion;
      try{
        await context(businessId,()=>peer.query("INSERT INTO transactions(id,business_id,customer_id,points,source) VALUES($1,$2,$3,1,'staff')",[randomUUID(),businessId,customerId]),peer);
        await context(businessId,()=>peer.query('UPDATE customer_balances SET points=points+1 WHERE customer_id=$1',[customerId]),peer);
        const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        let settled=false;
        deletion=context(businessId,()=>transaction(async()=>{
          await client.query('UPDATE customers SET deleted_at=now() WHERE id=$1',[customerId]);
          await client.query("SELECT app.auth_session_invalidate_by_id($1,'customer_deleted')",[sessionId]);
        })).then(value=>{settled=true;return value;});
        const deadline=Date.now()+2000;
        while(!settled && Date.now()<deadline){
          const activity=await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
          if(activity.rows[0]?.wait_event_type==='Lock') break;
          await new Promise(resolve=>setTimeout(resolve,5));
        }
        await peer.query("SET LOCAL lock_timeout='200ms'");
        await peer.query('UPDATE customers SET last_visit_at=now() WHERE id=$1',[customerId]);
        await peer.query('COMMIT');await deletion;
      }finally{
        await peer.query('ROLLBACK');await deletion;
        await admin.query('UPDATE customers SET deleted_at=NULL WHERE id=$1',[customerId]);
        await admin.query('UPDATE auth_sessions SET invalidated_at=NULL WHERE id=$1',[sessionId]);
        await register(input);
        const claims=await global(()=>repo.claimDue());
        for(const claim of claims) await global(async()=>repo.acknowledge(claim,await repo.getSnapshot(claim)));
      }
    });
    await t.test('idle and absolute expiry leave consent valid; explicit invalidation and consent expiry stop it', async () => {
      await admin.query("UPDATE auth_sessions SET idle_expires_at=now()-interval '2 days',absolute_expires_at=now()-interval '1 day' WHERE id=$1",[sessionId]);
      await context(businessId,()=>client.query('UPDATE customer_balances SET points=points+1 WHERE customer_id=$1',[customerId]));
      const [claim] = await global(()=>repo.claimDue()); assert.ok(await global(()=>repo.getSnapshot(claim)));
      await admin.query('UPDATE auth_sessions SET invalidated_at=now() WHERE id=$1',[sessionId]);
      assert.equal(await global(()=>repo.getSnapshot(claim)),null);
      assert.equal(await global(()=>repo.acknowledge(claim,{revision:claim.revision,points:99,pending_points:0})),null);
      await admin.query("UPDATE auth_sessions SET invalidated_at=NULL,idle_expires_at=now()+interval '1 day',absolute_expires_at=now()+interval '2 days' WHERE id=$1",[sessionId]);
      await register(input);
      await admin.query("UPDATE mobile_push_devices SET consent_expires_at=now()-interval '1 second' WHERE installation_id=$1",[input.installationId]);
      await context(businessId,()=>client.query('UPDATE customer_balances SET points=points+1 WHERE customer_id=$1',[customerId]));
      assert.deepEqual(await global(()=>repo.claimDue()),[]);
    });
    await t.test('explicit test is credential and account bound and limited across processes', async () => {
      await register(input);
      assert.equal(await global(()=>repo.claimTest({...input,installationSecret:randomBytes(32).toString('base64url')})),null);
      assert.equal(await global(()=>repo.claimTest({...input,customerId:otherCustomerId})),null);
      const claim = await global(()=>repo.claimTest(input)); assert.ok(claim);
      assert.equal(await global(()=>repo.claimTest(input)),null);
      await global(()=>repo.releaseTest(claim));
      assert.equal(await global(()=>repo.claimTest(input)),null);
    });
    await t.test('token rotation retains pending changes and account rebinding resets the baseline',async()=>{
      await context(businessId,()=>client.query('UPDATE customer_balances SET points=points+2 WHERE customer_id=$1',[customerId]));
      const before=await global(()=>repo.getDevice(input.installationId));
      const [old]=await global(()=>repo.claimDue());
      await register({...input,token:'de'.repeat(32)});
      const rotated=await global(()=>repo.getDevice(input.installationId));
      assert.equal(rotated.baseline_points,before.baseline_points);
      assert.equal(rotated.synced_revision,before.synced_revision);
      assert.equal(await global(()=>repo.getSnapshot(old)),null);
      const otherSession=randomUUID();
      await admin.query("INSERT INTO auth_sessions(id,session_token_hash,actor_type,actor_id,business_id,idle_expires_at,absolute_expires_at) VALUES($1::uuid,$1::text,'CUSTOMER',$2,$3,now()+interval '1 day',now()+interval '2 days')",[otherSession,otherCustomerId,otherBusinessId]);
      await register({...input,businessId:otherBusinessId,customerId:otherCustomerId,sessionId:otherSession});
      const rebound=await global(()=>repo.getDevice(input.installationId));
      assert.equal(rebound.customer_id,otherCustomerId);assert.equal(rebound.baseline_points,10);assert.equal(rebound.revision,rebound.synced_revision);
      assert.equal(await context(businessId,()=>repo.getDevice(input.installationId)),null);
      await register(input);
    });
    await t.test('expired leases and old workers cannot acknowledge or disable a replacement claim',async()=>{
      await context(businessId,()=>client.query('UPDATE customer_balances SET points=points+1 WHERE customer_id=$1',[customerId]));
      const [old]=await global(()=>repo.claimDue());const snapshot=await global(()=>repo.getSnapshot(old));
      await admin.query("UPDATE mobile_push_devices SET locked_until=now()-interval '1 second' WHERE installation_id=$1",[input.installationId]);
      const [current]=await global(()=>repo.claimDue());assert.notEqual(current.lock_token,old.lock_token);
      assert.equal(await global(()=>repo.acknowledge(old,snapshot)),null);
      assert.equal(await global(()=>repo.fail(old,{invalidToken:true})),null);
      assert.ok(await global(()=>repo.getSnapshot(current)));
      await global(()=>repo.fail(current,{retryable:true}));
      let device=await global(()=>repo.getDevice(input.installationId));assert.equal(device.enabled,true);assert.equal(device.attempts,1);
      assert.deepEqual(await global(()=>repo.claimDue()),[]);
      await admin.query('UPDATE mobile_push_devices SET next_attempt_at=now() WHERE installation_id=$1',[input.installationId]);
      const [badTopic]=await global(()=>repo.claimDue());await global(()=>repo.fail(badTopic,{retryable:false}));
      device=await global(()=>repo.getDevice(input.installationId));assert.equal(device.enabled,true);
      assert.ok(new Date(device.next_attempt_at).getTime()>Date.now()+3500*1000);
      await admin.query('UPDATE mobile_push_devices SET next_attempt_at=now() WHERE installation_id=$1',[input.installationId]);
      const [invalid]=await global(()=>repo.claimDue());await global(()=>repo.fail(invalid,{invalidToken:true,retryable:false}));
      assert.equal((await global(()=>repo.getDevice(input.installationId))).enabled,false);
      await register(input);
    });
    await t.test('new login resets old-session history and cleanup cannot disable an in-flight valid re-registration',async()=>{
      await context(businessId,()=>client.query('UPDATE customer_balances SET points=points+7 WHERE customer_id=$1',[customerId]));
      const [old]=await global(()=>repo.claimDue());const oldSnapshot=await global(()=>repo.getSnapshot(old));
      await admin.query('UPDATE auth_sessions SET invalidated_at=now() WHERE id=$1',[sessionId]);
      assert.equal((await global(()=>repo.getDevice(input.installationId))).enabled,true,'source invalidation does not take device locks');
      assert.equal(await global(()=>repo.getSnapshot(old)),null);
      assert.equal(await global(()=>repo.acknowledge(old,oldSnapshot)),null);
      const freshSession=randomUUID();
      await admin.query("INSERT INTO auth_sessions(id,session_token_hash,actor_type,actor_id,business_id,idle_expires_at,absolute_expires_at) VALUES($1::uuid,$1::text,'CUSTOMER',$2,$3,now()+interval '1 day',now()+interval '2 days')",[freshSession,customerId,businessId]);
      let ready=()=>{},release=()=>{};
      const readyPromise=new Promise(resolve=>{ready=()=>resolve(undefined);});const releasePromise=new Promise(resolve=>{release=()=>resolve(undefined);});
      const pending=context(null,()=>repo.register({...input,sessionId:freshSession},async fn=>{
        await client.query('BEGIN');
        try{const result=await fn();ready();await releasePromise;await client.query('COMMIT');return result;}
        catch(error){ready();await client.query('ROLLBACK');throw error;}
      }),client,true);
      try{
        await readyPromise;
        assert.deepEqual(await context(null,()=>repo.claimDue(),peer,true),[]);
      }finally{release();await pending;}
      const device=await global(()=>repo.getDevice(input.installationId));
      assert.equal(device.enabled,true);assert.equal(device.baseline_points,device.points);assert.equal(device.revision,device.synced_revision);
      assert.deepEqual(await global(()=>repo.claimDue()),[]);
      assert.equal((await global(()=>repo.getDevice(input.installationId))).enabled,true);
      await admin.query('UPDATE auth_sessions SET invalidated_at=NULL WHERE id=$1',[sessionId]);
      await register(input);
    });
    await t.test('invalidated old devices do not consume the registration cap before cleanup',async()=>{
      const staleSession=randomUUID(),added=[];
      await admin.query("INSERT INTO auth_sessions(id,session_token_hash,actor_type,actor_id,business_id,idle_expires_at,absolute_expires_at) VALUES($1::uuid,$1::text,'CUSTOMER',$2,$3,now()+interval '1 day',now()+interval '2 days')",[staleSession,customerId,businessId]);
      try{
        for(let index=0;index<19;index++){
          const data={...input,sessionId:staleSession,installationId:randomUUID(),token:(index+101).toString(16).padStart(64,'0')};
          await register(data);added.push(data);
        }
        await admin.query('UPDATE auth_sessions SET invalidated_at=now() WHERE id=$1',[staleSession]);
        const fresh={...input,installationId:randomUUID(),token:'cc'.repeat(32)};
        assert.equal((await register(fresh)).enabled,true);added.push(fresh);
        assert.deepEqual(await global(()=>repo.claimDue()),[]);
        assert.equal((await global(()=>repo.getDevice(fresh.installationId))).enabled,true);
        assert.equal((await global(()=>repo.getDevice(added[0].installationId))).enabled,false);
      }finally{for(const data of added) await global(()=>repo.revoke(data.installationId,data.installationSecret));}
    });
    await t.test('customer fanout and worker claims are bounded',async()=>{
      const added=[];
      try{
        for(let index=0;index<19;index++){
          const data={...input,installationId:randomUUID(),token:(index+1).toString(16).padStart(64,'0')};
          await register(data);added.push(data);
        }
        await assert.rejects(register({...input,installationId:randomUUID(),token:'ff'.repeat(32)}),{statusCode:409});
        await context(businessId,()=>client.query('UPDATE customer_balances SET points=points+1 WHERE customer_id=$1',[customerId]));
        const claims=await global(()=>repo.claimDue(1000));assert.equal(claims.length,20);
        for(const claim of claims) await global(async()=>repo.acknowledge(claim,await repo.getSnapshot(claim)));
      }finally{for(const data of added) await global(()=>repo.revoke(data.installationId,data.installationSecret));}
    });
    await t.test('concurrent logout and customer deletion do not acquire device locks',async()=>{
      await client.query('BEGIN');let logout;
      try{
        await context(businessId,()=>client.query('UPDATE customers SET deleted_at=now() WHERE id=$1',[customerId]));
        const pid=(await peer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        let settled=false;
        logout=context(businessId,()=>peer.query("SELECT app.auth_session_invalidate_by_id($1,'logout')",[sessionId]),peer).then(value=>{settled=true;return value;});
        const deadline=Date.now()+2000;
        while(!settled && Date.now()<deadline){
          const activity=await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
          if(activity.rows[0]?.wait_event_type==='Lock') break;
          await new Promise(resolve=>setTimeout(resolve,5));
        }
        await client.query("SET LOCAL lock_timeout='200ms'");
        await client.query("SELECT app.auth_session_invalidate_by_id($1,'customer_deleted')",[sessionId]);
        await client.query('COMMIT');await logout;
      }finally{
        await client.query('ROLLBACK');await logout;
        await admin.query('UPDATE customers SET deleted_at=NULL WHERE id=$1',[customerId]);
        await admin.query('UPDATE auth_sessions SET invalidated_at=NULL WHERE id=$1',[sessionId]);
        await register(input);
      }
    });
    await t.test('revoke works without session, is uniform, and deletion disables delivery', async () => {
      assert.deepEqual(await global(()=>repo.revoke(randomUUID(),input.installationSecret)),{ok:true});
      assert.deepEqual(await global(()=>repo.revoke(input.installationId,input.installationSecret)),{ok:true});
      assert.equal((await global(()=>repo.getDevice(input.installationId))).enabled,false);
      await register(input);
      await context(businessId,()=>client.query('UPDATE customers SET deleted_at=now() WHERE id=$1',[customerId]));
      assert.deepEqual(await global(()=>repo.claimDue()),[]);
      assert.equal((await global(()=>repo.getDevice(input.installationId))).enabled,false);
    });
    await t.test('complete historical migrations and explicit runtime grants support registration without auth SELECT',async()=>{
      const {orderMigrations}=await import('../../src/app/db/migration-order.js');
      const {buildGrantPlan}=await import('../../src/scripts/create-app-role.mjs');
      const directory=new URL('../../src/app/migrations/',import.meta.url);
      const files=orderMigrations((await readdir(directory)).filter(file=>file.endsWith('.sql')));
      await admin.query('DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public');
      await admin.query(await readFile(new URL('../../src/app/schema.sql',import.meta.url),'utf8'));
      await admin.query(await readFile(new URL('../../src/app/schema-extensions.sql',import.meta.url),'utf8'));
      for(const file of files){
        await admin.query('BEGIN');
        try{await admin.query(await readFile(new URL(file,directory),'utf8'));await admin.query('COMMIT');}
        catch(error){await admin.query('ROLLBACK');throw new Error(`Migration ${file} failed: ${error.message}`,{cause:error});}
      }
      await admin.query(migration);
      const plan=buildGrantPlan({appDbUser:role,dbName:url.pathname.slice(1)});
      for(const statement of plan.statements) await admin.query(statement);
      await admin.query(plan.grantFunctionsSql);
      assert.equal((await admin.query("SELECT has_table_privilege($1,'auth_sessions','SELECT') AS permitted",[role])).rows[0].permitted,false);
      assert.equal((await admin.query("SELECT has_table_privilege($1,'mobile_push_devices','DELETE') AS permitted",[role])).rows[0].permitted,false);
      await admin.query("INSERT INTO businesses(id,name,slug,email,password_hash) VALUES($1::uuid,'Test',$1::text,$1::text||'@example.invalid','test')",[businessId]);
      await admin.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,'50255554444','Test')",[customerId,businessId]);
      await admin.query("INSERT INTO auth_sessions(id,session_token_hash,actor_type,actor_id,business_id,idle_expires_at,absolute_expires_at) VALUES($1::uuid,$1::text,'CUSTOMER',$2,$3,now()+interval '1 day',now()+interval '2 days')",[sessionId,customerId,businessId]);
      assert.equal((await register(input)).enabled,true);
      await context(businessId,()=>client.query('UPDATE customer_balances SET points=1 WHERE customer_id=$1',[customerId]));
      const [claim]=await global(()=>repo.claimDue());assert.ok(await global(()=>repo.getSnapshot(claim)));
      await context(businessId,()=>client.query("SELECT app.auth_session_invalidate_by_id($1,'logout')",[sessionId]));
      assert.equal(await global(()=>repo.getSnapshot(claim)),null);
      const tables=(await admin.query("SELECT to_regclass('native_wallet_passes') AS native,to_regclass('wallet_passes') AS legacy")).rows[0];
      assert.equal(tables.native,'native_wallet_passes');assert.equal(tables.legacy,'wallet_passes');
    });
  } finally { await Promise.all([admin.end(),client.end(),peer.end()]); }
});
