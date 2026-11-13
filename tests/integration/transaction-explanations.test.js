import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, describe, it } from 'node:test';
import pg from 'pg';

const url = process.env.TRANSACTION_EXPLANATION_TEST_DB_URL;
const suite = url ? describe : describe.skip;
const businessId = randomUUID(), otherBusiness = randomUUID(), customerId = randomUUID(), otherCustomer = randomUUID();
const at = new Date('2026-11-11T18:00:00Z');
let admin, database, service;
async function context(tenantId, fn, runtime = true) {
  const client = await admin.connect();
  try {
    await client.query('BEGIN READ ONLY');
    if (runtime) await client.query('SET LOCAL ROLE transaction_explanation_rls');
    await client.query("SELECT set_config('app.current_tenant',$1,true),set_config('app.platform_admin','',true)", [tenantId]);
    return await database.runWithDbContext({ client, tenantId, platformAdmin: false }, fn);
  } finally { await client.query('ROLLBACK'); client.release(); }
}
const list = (options = {}) => context(businessId, () => service.listTransactionHistory({ businessId, ...options }));
const explain = id => context(businessId, () => service.getTransactionExplanation({ businessId, id }));
async function transaction({ tenant = businessId, id = randomUUID(), source = 'online', type = 'PURCHASE', points = 10, meta = {}, original = null, created = /** @type {Date|string} */ (at) } = {}) {
  await admin.query('INSERT INTO transactions(id,business_id,customer_id,type,source,points,amount_q,meta,original_transaction_id,created_at) VALUES($1,$2,$3,$4,$5,$6,20,$7,$8,$9)', [id,tenant,tenant === businessId ? customerId : otherCustomer,type,source,points,meta,original,created]);
  return id;
}
async function redemption({ linked = true } = {}) {
  const id = randomUUID(), rewardId = randomUUID();
  await admin.query("INSERT INTO rewards(id,business_id,name,points_cost) VALUES($1,$2,'Café',25)", [rewardId,businessId]);
  await admin.query("INSERT INTO redemptions(id,business_id,reward_id,customer_id,points_cost,code,status,redeemed_at) VALUES($1,$2,$3,$4,25,'PRIVATE_CODE_'||$1::uuid::text,'REDEEMED',$5)", [id,businessId,rewardId,customerId,at]);
  const txId = linked ? await transaction({ source: 'redeem', points: -25, meta: { redemption_id: id, reward_id: rewardId, code: 'PRIVATE_CODE' } }) : null;
  return { id, txId };
}
suite('transaction explanations on disposable PostgreSQL', () => {
  before(async () => {
    const parsed = new URL(url);
    assert.equal(process.env.NODE_ENV, 'test');
    assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
    assert.equal(parsed.pathname, '/transaction_explanation_test'); assert.ok(['55451','55470'].includes(parsed.port));
    Object.assign(process.env, { DB_HOST: parsed.hostname, DB_PORT: parsed.port, DB_NAME: parsed.pathname.slice(1), DB_USER: decodeURIComponent(parsed.username), DB_PASSWORD: decodeURIComponent(parsed.password), DB_PASSWORD_FILE: '', DB_MIGRATIONS_PASSWORD_FILE: '', JWT_SECRET_FILE: '', JWT_SECRET: 'fixture-transaction-explanations-12345678' });
    admin = new pg.Pool({ connectionString: url });
    await admin.query('DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public');
    for (const path of ['../../src/app/schema.sql','../../src/app/migrations/2026-03-08-ledger-reconciliation.sql','../../src/app/migrations/2026-03-08-ledger-corrections.sql','../../src/app/migrations/2026-03-08-ledger-balance-adjustments.sql','../../src/app/migrations/2026-02-27-tenant-rls_canonical.sql','../../src/app/migrations/2026-11-10-customer-recovery.sql','../../src/app/migrations/2026-11-10-growth-campaigns.sql','../../src/app/migrations/2026-11-10-growth-limits.sql','../../src/app/migrations/2026-11-11-reward-promises-hospitality.sql','../../src/app/migrations/2026-11-11-service-recovery.sql','../../src/app/migrations/2026-11-13-evidence-health.sql']) {
      // Repository-owned fixture paths only.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await admin.query(await readFile(new URL(path, import.meta.url),'utf8'));
    }
    await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='transaction_explanation_rls') THEN CREATE ROLE transaction_explanation_rls NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;
      GRANT USAGE ON SCHEMA public,app TO transaction_explanation_rls;
      GRANT INSERT ON transaction_evidence_events,redemption_evidence_events TO transaction_explanation_rls;
      GRANT SELECT ON businesses,customers,transactions,redemptions,rewards,branches,staff_users,ledger_balance_adjustments,transaction_evidence_events,redemption_evidence_events,reward_entitlement_fulfillments,customer_reward_promises,reward_promise_cycles,service_cases TO transaction_explanation_rls;`);
    database = await import('../../src/app/database.js');
    service = await import('../../src/app/services/transaction-explanation-service.js');
  });
  after(async () => { await database?.closeDatabase(); await admin?.end(); });
  beforeEach(async () => {
    await admin.query('TRUNCATE businesses CASCADE');
    await admin.query("INSERT INTO businesses(id,name,slug,email,password_hash) VALUES($1,'Uno','uno','one@example.invalid','unused'),($2,'Dos','dos','two@example.invalid','unused')", [businessId,otherBusiness]);
    await admin.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,'PRIVATE_PHONE_1','Ana'),($3,$4,'PRIVATE_PHONE_2','Other tenant')", [customerId,businessId,otherCustomer,otherBusiness]);
    assert.equal(typeof service.listTransactionHistory, 'function', 'owner history service must exist');
  });
  it('paginates every ledger category without duplicate redemptions or metadata leakage', async () => {
    await transaction(); await transaction({ type: 'OPENING_BALANCE', source: 'migration', points: 80 });
    const original = await transaction(); await transaction({ type: 'REFUND', source: 'reversal', points: -10, original, meta: { private: 'PRIVATE_TOKEN' } });
    const linked = await redemption(); await redemption({ linked: false });
    const adjustmentId = randomUUID();
    await admin.query("INSERT INTO ledger_balance_adjustments(id,business_id,customer_id,reason,delta_points,delta_pending_points,delta_lifetime_points,created_at) VALUES($1,$2,$3,'PRIVATE_REASON',4,-2,3,$4)", [adjustmentId,businessId,customerId,at]);
    await transaction({ tenant: otherBusiness, points: 999 });
    const rows = []; let cursor;
    do { const result = await list({ limit: 2, cursor }); rows.push(...result.movements); cursor = result.next_cursor; } while (cursor);
    assert.equal(rows.length, 7); assert.equal(new Set(rows.map(row => row.id)).size, 7);
    assert.deepEqual(new Set(rows.map(row => row.kind)), new Set(['purchase','opening_balance','refund','redemption','adjustment']));
    assert.equal(JSON.stringify(rows).includes('PRIVATE'), false); assert.equal(JSON.stringify(rows).includes('Other tenant'), false);
    assert.equal((await explain(linked.id)).movement.id, linked.txId);
    const adjustment = await explain(adjustmentId);
    assert.deepEqual(adjustment.movement.adjustment, { points: 4, pending_points: -2, lifetime_points: 3 });
    assert.equal(adjustment.movement.customer_name, 'Ana');
    assert.equal((await list({ kind: 'refund' })).movements.length, 1);
  });
  it('never reconstructs old rules and preserves an immutable exact award snapshot when settings change', async () => {
    const legacy = await transaction({ meta: { api_key: 'PRIVATE' } });
    const old = await explain(legacy);
    assert.equal(old.explanation.coverage, 'partial'); assert.equal(old.explanation.award, null);
    assert.match(old.explanation.limitations.join(' '), /no se guardaron|sin.*reglas/i);
    const { computePointsWithEvidence } = await import('../../src/app/services/points-service.js');
    const { completeAwardEvidence } = await import('../../src/app/services/transaction-rule-evidence.js');
    const evaluated = computePointsWithEvidence({ program_json: { points_per_q: 0.5 } }, { amount_q: 20 }, { now: at, timeZone: 'America/Guatemala' });
    const evidence = completeAwardEvidence(evaluated.evidence, { bonus: { bonusPoints: 0 }, holdDays: 0, status: 'POSTED', availableAt: null });
    const recorded = await transaction({ meta: { award_evidence: { ...evidence, private: 'PRIVATE' }, arbitrary: 'PRIVATE' } });
    const first = await explain(recorded);
    assert.equal(first.explanation.coverage, 'recorded'); assert.equal(first.explanation.award.program_points, 10);
    assert.equal(JSON.stringify(first).includes('PRIVATE'), false);
    await admin.query('UPDATE businesses SET program_json=$2 WHERE id=$1', [businessId,{ points_per_q: 99 }]);
    assert.deepEqual((await explain(recorded)).explanation, first.explanation);
    assert.equal((await explain(legacy)).explanation.award, null);
    await admin.query("UPDATE transactions SET meta=jsonb_set(meta,'{award_evidence,inputs,amount_q}','999'::jsonb) WHERE id=$1", [recorded]);
    assert.equal((await explain(recorded)).explanation.coverage,'partial','inconsistent sale inputs cannot be called an exact calculation');
    const unsafeZone = await transaction({ meta: { award_evidence: { ...evidence, time_zone: 'PRIVATE_INTERNAL_SETTING' } } });
    const sanitized = await explain(unsafeZone);
    assert.equal(sanitized.explanation.award,null); assert.equal(JSON.stringify(sanitized).includes('PRIVATE'),false);

  });
  it('keeps keyset pages stable when another purchase arrives and supports older exact IDs', async () => {
    const older = await transaction({ created: new Date('2020-01-01') });
    await transaction(); await transaction();
    const first = await list({ limit: 1 });
    await transaction({ created: new Date('2026-11-12') });
    const rest = await list({ limit: 50, cursor: first.next_cursor });
    assert.equal(rest.movements.length, 2); assert.ok(rest.movements.some(row => row.id === older));
    assert.equal((await explain(older)).movement.id, older);
  });
  it('enforces explicit tenant predicates and RLS even when an identifier or service tenant crosses boundaries', async () => {
    const foreign = await transaction({ tenant: otherBusiness }); await transaction();
    for (const runtime of [true,false]) {
      await assert.rejects(context(businessId, () => service.getTransactionExplanation({ businessId, id: foreign }),runtime), { statusCode: 404 });
      assert.equal((await context(businessId, () => service.listTransactionHistory({ businessId }),runtime)).movements.length, 1);
    }
    await assert.rejects(context(businessId, () => service.listTransactionHistory({ businessId: otherBusiness })), { statusCode: 404 });
    await assert.rejects(explain(randomUUID()), { statusCode: 404 });
  });
  it('discards inconsistent award evidence and fails visibly when ledger access is unavailable', async () => {
    const malformed = await transaction({ meta: { award_evidence: { schema_version: 1, awarded_points: 999, secret: 'PRIVATE' } } });
    assert.equal((await explain(malformed)).explanation.coverage, 'partial');
    await admin.query('REVOKE SELECT ON ledger_balance_adjustments FROM transaction_explanation_rls');
    try { await assert.rejects(list(), { code: '42501' }); }
    finally { await admin.query('GRANT SELECT ON ledger_balance_adjustments,transaction_evidence_events,redemption_evidence_events,reward_entitlement_fulfillments,customer_reward_promises,reward_promise_cycles,service_cases TO transaction_explanation_rls'); }
  });
  it('preserves sub-millisecond cursor order without losing rows', async () => {
    const firstId = await transaction({ created: '2026-11-11T18:00:00.000001Z' });
    const secondId = await transaction({ created: '2026-11-11T18:00:00.000002Z' });
    const page = await list({ limit: 1 });
    assert.equal(page.movements[0].id, secondId);
    assert.equal((await list({ limit: 1, cursor: page.next_cursor })).movements[0].id, firstId);
    await assert.rejects(list({ cursor: 'malformed' }), { statusCode: 400 });
  });
  it('isolates legacy cross-tenant names and related IDs even with a privileged SQL reader', async () => {
    const staff = randomUUID(), branch = randomUUID(), other = await transaction({ tenant: otherBusiness });
    await admin.query("INSERT INTO branches(id,business_id,name,code) VALUES($1,$2,'PRIVATE_BRANCH',$1::uuid::text)",[branch,otherBusiness]);
    await admin.query("INSERT INTO staff_users(id,business_id,name,password_hash) VALUES($1,$2,'PRIVATE_STAFF','unused')",[staff,otherBusiness]);
    const id = await transaction({ original: other });
    await admin.query('UPDATE transactions SET staff_user_id=$2,branch_id=$3 WHERE id=$1',[id,staff,branch]);
    const result = await context(businessId, () => service.getTransactionExplanation({ businessId,id }), false);
    assert.equal(result.movement.staff_name,null); assert.equal(result.movement.branch_name,null);
    assert.equal(result.movement.links.original_id,null); assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
  });
  it('commits one exact evidence snapshot for concurrent external retries and never rewrites it after rule changes', async t => {
    const { awardFromExternalEventWithDeps } = await import('../../src/app/services/external-award-service.js');
    const { computePoints,computePointsWithEvidence } = await import('../../src/app/services/points-service.js');
    const { AuditRepo } = await import('../../src/app/repositories/audit-repository.js');
    t.mock.method(AuditRepo,'log',async()=>{});
    await admin.query('INSERT INTO customer_balances(customer_id,points,pending_points) VALUES($1,0,0)',[customerId]);
    await admin.query('GRANT INSERT ON transactions TO transaction_explanation_rls; GRANT SELECT,UPDATE ON customer_balances TO transaction_explanation_rls');
    const business = { id: businessId,program_json: { points_per_q:0.5,external_awards:{enabled:true,api_key:'fixture-only'} } };
    const deps = {
      computePoints,computePointsWithEvidence, setCurrentTenant:async()=>{},
      BusinessRepo:{getPublicBySlug:async()=>business,getById:async()=>business},
      CustomerRepo:{getById:async()=>({id:customerId,business_id:businessId}),getByBusinessAndPhone:async()=>null},
      timingSafeEqualString:(a,b)=>a===b,
      withTransaction:async fn=>{
        const client=await admin.connect();
        try{
          await client.query('BEGIN');await client.query('SET LOCAL ROLE transaction_explanation_rls');
          await client.query("SELECT set_config('app.current_tenant',$1,true)",[businessId]);
          const result=await fn(client);await client.query('COMMIT');return result;
        }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
      }
    };
    const args={businessSlug:'uno',apiKey:'fixture-only',externalEventId:'concurrent-fixture',customerId,amount_q:20};
    const results=await Promise.all(Array.from({length:4},()=>awardFromExternalEventWithDeps(deps,args)));
    assert.equal(new Set(results.map(result=>result.transactionId)).size,1);
    assert.equal(results.filter(result=>result.replay).length,3);
    assert.equal((await admin.query('SELECT points FROM customer_balances WHERE customer_id=$1',[customerId])).rows[0].points,10);
    const id=results[0].transactionId,first=await explain(id);
    assert.equal(first.explanation.coverage,'recorded'); assert.equal(first.explanation.award.program.rate,0.5);
    business.program_json.points_per_q=99;
    assert.equal((await awardFromExternalEventWithDeps(deps,args)).pointsAwarded,10);
    assert.deepEqual((await explain(id)).explanation,first.explanation);
  });

  async function targetedWriter(t, memberIds, { budget = 7 } = {}) {
    const { awardFromExternalEventWithDeps } = await import('../../src/app/services/external-award-service.js');
    const { computePoints,computePointsWithEvidence } = await import('../../src/app/services/points-service.js');
    const { claimTargetedOffer } = await import('../../src/app/services/targeted-offer-service.js');
    const { AuditRepo } = await import('../../src/app/repositories/audit-repository.js');
    t.mock.method(AuditRepo,'log',async()=>{});
    await admin.query('GRANT INSERT ON transactions TO transaction_explanation_rls; GRANT SELECT,UPDATE ON customer_balances,growth_campaigns,growth_campaign_members TO transaction_explanation_rls; GRANT UPDATE ON businesses,customers TO transaction_explanation_rls');
    const program={points_per_q:0.5,targeted_offers_enabled:true,external_awards:{enabled:true,api_key:'fixture-only'}};
    await admin.query("UPDATE businesses SET plan='EMPRESA',program_json=$2 WHERE id=$1",[businessId,program]);
    const campaignId=randomUUID();
    await admin.query(`INSERT INTO growth_campaigns(id,business_id,request_id,name,status,bonus_points,minimum_purchase_q,duration_days,holdout_percent,member_count,treatment_count,points_budget,starts_at,expires_at)
      VALUES($1,$2,$3,'Fixture terms','active',7,15,7,20,$4,$4,$5,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day')`,[campaignId,businessId,randomUUID(),memberIds.length,budget]);
    for(const id of memberIds){
      if(id!==customerId)await admin.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,$1::uuid::text,'Additional fixture')",[id,businessId]);
      await admin.query('INSERT INTO customer_balances(customer_id,points,pending_points) VALUES($1,0,0)',[id]);
      await admin.query("INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation) VALUES($1,$2,$3,$4,'treatment')",[randomUUID(),businessId,campaignId,id]);
    }
    const deps={computePoints,computePointsWithEvidence,claimTargetedOffer,getPlanFeatureOverrides:async()=>({}),setCurrentTenant:async()=>{},
      BusinessRepo:{getPublicBySlug:async()=>({id:businessId}),getById:async()=>({id:businessId,plan:'EMPRESA',program_json:program})},
      CustomerRepo:{getById:async id=>({id,business_id:businessId}),getByBusinessAndPhone:async()=>null},timingSafeEqualString:(a,b)=>a===b,
      withTransaction:async fn=>{const client=await admin.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE transaction_explanation_rls');await client.query("SELECT set_config('app.current_tenant',$1,true)",[businessId]);const result=await fn(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
    };
    return {campaignId,award:id=>awardFromExternalEventWithDeps(deps,{businessSlug:'uno',apiKey:'fixture-only',externalEventId:`terms-${id}`,customerId:id,amount_q:20})};
  }
  it('records real targeted eligibility, validity and the last budget reservation under concurrent awards',async t=>{
    const secondCustomer=randomUUID(),writer=await targetedWriter(t,[customerId,secondCustomer]);
    const results=await Promise.all([writer.award(customerId),writer.award(secondCustomer)]);
    assert.deepEqual(results.map(row=>row.pointsAwarded).sort((a,b)=>a-b),[10,17]);
    const winner=results.find(row=>row.pointsAwarded===17),first=await explain(winner.transactionId);
    assert.equal(first.explanation.coverage,'recorded');
    const criteria=first.explanation.award.targeted_offer.criteria;
    assert.equal(typeof criteria,'object','future targeted awards must explain the terms actually checked');
    assert.equal(criteria.minimum_purchase_q,15);assert.equal(criteria.points_budget,7);
    assert.equal(criteria.points_committed_before,0);assert.equal(criteria.points_committed_after,7);
    assert.equal(criteria.eligibility.saved_membership,'treatment');assert.equal(criteria.purchase.amount_q,20);
    assert.equal(criteria.clock,'database');assert.ok(Date.parse(criteria.starts_at)<=Date.parse(criteria.evaluated_at));assert.ok(Date.parse(criteria.evaluated_at)<Date.parse(criteria.expires_at));
    assert.equal(first.explanation.limitations.some(line=>line.includes('condiciones y disponibilidad no se guardaron')),false);
    await admin.query("UPDATE growth_campaigns SET minimum_purchase_q=999,bonus_points=6,status='paused',paused_at=clock_timestamp() WHERE id=$1",[writer.campaignId]);
    assert.deepEqual((await explain(winner.transactionId)).explanation,first.explanation);
    assert.equal((await writer.award(winner.customerId)).pointsAwarded,17);
    assert.deepEqual((await explain(winner.transactionId)).explanation,first.explanation);
    // Pre-existing awards retain the known bonus, without importing today's terms.
    await admin.query("UPDATE transactions SET meta=jsonb_set(meta,'{award_evidence,targeted_offer,criteria}','\"not_snapshotted\"'::jsonb) WHERE id=$1",[winner.transactionId]);
    const legacy=await explain(winner.transactionId);
    assert.equal(legacy.explanation.coverage,'partial');assert.equal(legacy.explanation.award.targeted_offer.criteria,'not_snapshotted');
    assert.ok(legacy.explanation.limitations.some(line=>line.includes('condiciones y disponibilidad no se guardaron')));
  });
  it('snapshots the locked terms selected after a concurrent campaign edit instead of stale settings',async t=>{
    const writer=await targetedWriter(t,[customerId],{budget:21}),blocker=await admin.connect();
    let pending;
    try{
      await blocker.query('BEGIN');
      await blocker.query("UPDATE growth_campaigns SET minimum_purchase_q=18,bonus_points=9,expires_at=clock_timestamp()+interval '2 days' WHERE id=$1",[writer.campaignId]);
      pending=writer.award(customerId);
      let waiting=false;
      for(let attempt=0;attempt<100;attempt++){
        const locks=await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT g.id%'");
        if(locks.rowCount){waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(waiting,true,'award must actually wait for the competing edit');
      await blocker.query('COMMIT');
      const result=await pending,detail=await explain(result.transactionId);
      assert.equal(result.pointsAwarded,19);
      assert.equal(detail.explanation.award.targeted_offer.bonus_points,9);
      assert.equal(detail.explanation.award.targeted_offer.criteria.minimum_purchase_q,18);
      assert.equal(detail.explanation.award.targeted_offer.criteria.points_committed_after,9);
    }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending.catch(()=>{});}
  });

  it('does not preserve stale eligibility when the offer expires while waiting for its member lock',async t=>{
    const writer=await targetedWriter(t,[customerId]),blocker=await admin.connect();
    let pending;
    try{
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM growth_campaign_members WHERE campaign_id=$1 FOR UPDATE',[writer.campaignId]);
      await admin.query("UPDATE growth_campaigns SET expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",[writer.campaignId]);
      pending=writer.award(customerId);
      let waiting=false;
      for(let attempt=0;attempt<100;attempt++){
        if((await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT m.id%'")).rowCount){waiting=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(waiting,true,'award must wait for the membership lock before expiry');
      for(let attempt=0;attempt<200;attempt++){
        if((await admin.query('SELECT clock_timestamp()>expires_at AS expired FROM growth_campaigns WHERE id=$1',[writer.campaignId])).rows[0].expired)break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      await blocker.query('COMMIT');
      const result=await pending,detail=await explain(result.transactionId);
      assert.equal(result.pointsAwarded,10);
      assert.equal(detail.explanation.award.targeted_offer.bonus_points,0);
      assert.equal(detail.explanation.award.targeted_offer.criteria,'not_snapshotted');
      assert.equal((await admin.query('SELECT points_committed FROM growth_campaigns WHERE id=$1',[writer.campaignId])).rows[0].points_committed,0);
    }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending.catch(()=>{});}
  });

});
