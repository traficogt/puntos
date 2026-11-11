/* eslint-disable security/detect-non-literal-fs-filename -- Only repository-owned fixture migrations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=process.env.WALLET_ENGAGEMENT_TEST_DATABASE_URL;
test('authoritative Wallet engagement and independent refresh on isolated PostgreSQL',{skip:!url},async t=>{
 const parsed=new URL(url);assert.equal(process.env.NODE_ENV,'test');assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.port,'55451');assert.equal(parsed.pathname,'/activation_wallet_test');
 const db=new pg.Client({connectionString:url});await db.connect();
 const {NativeWalletRepo:repo}=await import('../../src/app/repositories/native-wallet-repository.js');
 const {runWithDbContext}=await import('../../src/app/database.js');
 const b=randomUUID(),other=randomUUID(),c=randomUUID(),owner=randomUUID(),branch=randomUUID(),r=randomUUID();
 const tenant=async(fn,id=b)=>{await db.query("SELECT set_config('app.current_tenant',$1,false)",[id]);return runWithDbContext({client:db,tenantId:id},fn);};
 try{
  await db.query('DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public');
  for(const path of ['schema.sql','migrations/2026-02-27-tenant-rls_canonical.sql','migrations/2026-11-09-native-wallet.sql','migrations/2026-11-11-reward-promises-hospitality.sql'])await db.query(await readFile(new URL(`../../src/app/${path}`,import.meta.url),'utf8'));
  const migration=await readFile(new URL('../../src/app/migrations/2026-11-11-wallet-engagement.sql',import.meta.url),'utf8').catch(()=>null);
  assert.ok(migration,'Wallet engagement migration exists');await db.query(migration);await db.query(migration);
  await db.query("DO $$ BEGIN CREATE ROLE activation_wallet_app NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$; GRANT USAGE ON SCHEMA public,app TO activation_wallet_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO activation_wallet_app; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO activation_wallet_app");
  await db.query("INSERT INTO businesses(id,name,slug,email,password_hash,program_type,program_json) VALUES($1::uuid,'Café',$1::text,$1::text||'@example.invalid','test','VISIT','{\"points_per_visit\":10}'),($2::uuid,'Other',$2::text,$2::text||'@example.invalid','test','VISIT','{}')",[b,other]);
  await db.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$2,'Centro','centro')",[branch,b]);
  await db.query("INSERT INTO staff_users(id,business_id,name,role,password_hash) VALUES($1,$2,'Owner','OWNER','test')",[owner,b]);
  await db.query("INSERT INTO customers(id,business_id,name,phone) VALUES($1,$2,'Ana','+50255550001')",[c,b]);
  await db.query('INSERT INTO customer_balances(customer_id,points,pending_points) VALUES($1,40,100)',[c]);
  await db.query("INSERT INTO rewards(id,business_id,name,points_cost,stock) VALUES($1,$2,'Café original',60,10)",[r,b]);
  await db.query('SET ROLE activation_wallet_app');
  const pass=await tenant(()=>repo.ensurePass({id:randomUUID(),businessId:b,customerId:c,provider:'google',membershipToken:randomBytes(32).toString('base64url'),authenticationToken:randomBytes(32).toString('base64url')}));
  const snapshot=()=>tenant(()=>repo.getSnapshot(pass.id));
  const sync=async()=>{const s=await snapshot();await tenant(()=>repo.markSynced(pass.id,s.revision,null,s.next_refresh_at));return s;};
  await t.test('available balance and RLS remain authoritative',async()=>{const s=await snapshot();assert.equal(s.wallet_engagement.reward.remaining_points,20);assert.equal(await tenant(()=>repo.getSnapshot(pass.id),other),null);});
  await t.test('reward edits preserve original choices, terms and enqueue even with unchanged balance',async()=>{
   const before=await sync();await tenant(()=>db.query('UPDATE rewards SET points_cost=100,name=\'Nuevo\' WHERE id=$1',[r]));
   const s=await snapshot();assert.ok(BigInt(s.revision)>BigInt(before.revision));assert.equal(s.points,40);assert.equal(s.wallet_engagement.reward.name,'Café original');assert.equal(s.wallet_engagement.reward.points_cost,60);assert.equal(s.wallet_engagement.reward.protected,true);
   await tenant(()=>db.query('UPDATE businesses SET program_json=\'{"points_per_visit":1}\' WHERE id=$1',[b]));assert.match((await snapshot()).wallet_engagement.earning,/10 puntos por visita/);
  });
  await t.test('availability, stock and owner location edits each invalidate the pass',async()=>{
   let before=await sync();await tenant(()=>db.query('INSERT INTO reward_availability(business_id,reward_id,available,updated_by_staff_id) VALUES($1,$2,false,$3)',[b,r,owner]));let s=await snapshot();assert.ok(BigInt(s.revision)>BigInt(before.revision));assert.equal(s.wallet_engagement.reward,null);
   await tenant(()=>db.query('UPDATE reward_availability SET available=true WHERE reward_id=$1',[r]));before=await sync();await tenant(()=>db.query('UPDATE rewards SET stock=0 WHERE id=$1',[r]));s=await snapshot();assert.ok(BigInt(s.revision)>BigInt(before.revision));assert.equal(s.wallet_engagement.reward,null);
   before=await sync();await tenant(()=>db.query('UPDATE branches SET wallet_latitude=14.6,wallet_longitude=-90.5,wallet_location_enabled=true WHERE id=$1',[branch]));s=await snapshot();assert.ok(BigInt(s.revision)>BigInt(before.revision));assert.equal(s.wallet_engagement.locations.length,1);
   await assert.rejects(tenant(()=>db.query('UPDATE branches SET wallet_latitude=100 WHERE id=$1',[branch])),{code:'23514'});
  });
  await t.test('expired content queues exactly one durable refresh and honors backoff',async()=>{
   await sync();await tenant(()=>db.query("UPDATE native_wallet_passes SET content_refresh_at=now()-interval '1 second' WHERE id=$1",[pass.id]));
   const jobs=await tenant(()=>repo.claimDue());assert.equal(jobs.length,1);await tenant(()=>repo.markFailed(pass.id,jobs[0].lock_token));assert.equal((await tenant(()=>repo.claimDue())).length,0);
   await tenant(()=>db.query("UPDATE native_wallet_passes SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[pass.id]));const retry=(await tenant(()=>repo.claimDue()))[0];await tenant(()=>repo.markSynced(pass.id,retry.revision,retry.lock_token,null));assert.equal((await tenant(()=>repo.claimDue())).length,0);
  });
  await t.test('original branch scope and live redemption guards stay consistent with redemption',async()=>{
   await tenant(()=>db.query('UPDATE rewards SET stock=10 WHERE id=$1',[r]));
   const restricted=randomUUID();await tenant(()=>db.query("INSERT INTO branches(id,business_id,name,code,wallet_location_enabled,wallet_latitude,wallet_longitude) VALUES($1::uuid,$2,'Norte',$1::text,true,15,-91)",[restricted,b]));
   // A scope edit protects the old unrestricted promise; current terms cannot narrow it.
   await tenant(()=>db.query('INSERT INTO reward_branches(reward_id,branch_id) VALUES($1,$2)',[r,restricted]));assert.equal((await snapshot()).wallet_engagement.locations.length,2);
   await tenant(()=>db.query('UPDATE businesses SET program_json=program_json||\'{"redemption_guard":{"max_reward_redemptions_per_day":1,"reward_cooldown_hours":24}}\' WHERE id=$1',[b]));
   const before=await sync();await tenant(()=>db.query("INSERT INTO redemptions(id,business_id,customer_id,reward_id,code,points_cost) VALUES($1::uuid,$2,$3,$4,$1::text,60)",[randomUUID(),b,c,r]));
   const s=await snapshot();assert.ok(BigInt(s.revision)>BigInt(before.revision));assert.equal(s.wallet_engagement.reward,null);assert.ok(new Date(s.next_refresh_at)>new Date(s.snapshot_at));
  });
  await t.test('owner location service rejects stale roles, foreign branches and an eleventh location',async()=>{
   const {WalletLocationService}=await import('../../src/app/services/native-wallet/locations.js');
   const staff={id:owner,business_id:b},location={enabled:true,latitude:14,longitude:-90};
   const transaction=async fn=>{await db.query('BEGIN');try{const out=await fn(db);await db.query('COMMIT');return out;}catch(error){await db.query('ROLLBACK');throw error;}};
   const save=(branchId,who=staff)=>tenant(()=>WalletLocationService.save({businessId:b,branchId,staff:who,location},{transaction}));
   await assert.rejects(save(randomUUID()),{statusCode:404});await assert.rejects(save(branch,{id:randomUUID(),business_id:b}),{statusCode:403});
   for(let i=0;i<8;i++){const id=randomUUID();await tenant(()=>db.query("INSERT INTO branches(id,business_id,name,code,wallet_location_enabled,wallet_latitude,wallet_longitude) VALUES($1::uuid,$2,'Store',$1::text,true,14,-90)",[id,b]));}
   const extra=randomUUID();await tenant(()=>db.query("INSERT INTO branches(id,business_id,name,code) VALUES($1::uuid,$2,'Extra',$1::text)",[extra,b]));await assert.rejects(save(extra),{statusCode:409});
   assert.equal((await save(branch)).branch.wallet_latitude,14);
   assert.equal((await tenant(()=>db.query("SELECT count(*)::int AS count FROM audit_logs WHERE action='wallet.branch.location.update'"))).rows[0].count,1);
  });
  await t.test('parallel owners cannot activate an eleventh location',async()=>{
   const {WalletLocationService}=await import('../../src/app/services/native-wallet/locations.js');
   await tenant(()=>db.query('UPDATE branches SET wallet_location_enabled=false WHERE id=(SELECT id FROM branches WHERE business_id=$1 AND wallet_location_enabled ORDER BY id LIMIT 1)',[b]));
   const ids=[randomUUID(),randomUUID()];for(const id of ids)await tenant(()=>db.query("INSERT INTO branches(id,business_id,name,code) VALUES($1::uuid,$2,'Concurrent',$1::text)",[id,b]));
   const clients=ids.map(()=>new pg.Client({connectionString:url}));await Promise.all(clients.map(client=>client.connect()));
   try{
    const result=await Promise.allSettled(ids.map((id,index)=>WalletLocationService.save({businessId:b,branchId:id,staff:{id:owner,business_id:b},location:{enabled:true,latitude:14,longitude:-90}},{transaction:async fn=>{const client=clients[index];await client.query('BEGIN');try{await client.query('SET LOCAL ROLE activation_wallet_app');await client.query("SELECT set_config('app.current_tenant',$1,true)",[b]);const value=await fn(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}}})));
    assert.equal(result.filter(row=>row.status==='fulfilled').length,1);assert.equal(result.filter(row=>row.status==='rejected'&&row.reason.statusCode===409).length,1);
    assert.equal((await tenant(()=>db.query('SELECT count(*)::int AS count FROM branches WHERE business_id=$1 AND wallet_location_enabled',[b]))).rows[0].count,10);
   }finally{await Promise.all(clients.map(client=>client.end()));}
  });
  await t.test('revoked snapshots erase all progress and location relevance',async()=>{await tenant(()=>repo.revokeCustomerPasses(b,c));const s=await snapshot();assert.equal(s.wallet_engagement.reward,null);assert.equal(s.wallet_engagement.earning,null);assert.deepEqual(s.wallet_engagement.locations,[]);});
 }finally{await db.end();}
});
