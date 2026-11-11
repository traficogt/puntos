import { applyCampaignExpansionFixture } from "../helpers/campaign-expansion-schema.js";
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, describe, it } from 'node:test';
import pg from 'pg';

const url = process.env.CAMPAIGN_LIMITS_TEST_DB_URL;
const suite = url ? describe : describe.skip;
const businessId = randomUUID(), otherBusiness = randomUUID(), staffId = randomUUID();
let db, database, campaigns, offers, messages, config, plans, originalPlans, deps;
let recoveryRunId, customers, historical;
const context = fn => database.withDbClientContext({tenantId:businessId,platformAdmin:false}, fn);
const daytime = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1,16));
};
async function migration(path) {
  // Fixed repository fixture/migration paths only.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFile(new URL(path,import.meta.url),'utf8');
}
const create = (extra={}) => campaigns.createGrowthCampaign({businessId,staffId,requestId:randomUUID(),recoveryRunId,name:'Budget fixture',bonusPoints:50,pointsBudget:100,minimumPurchaseQ:10,durationDays:14,...extra},deps);
async function activate(extra={}) {
  const {campaign} = await create(extra);
  return (await campaigns.activateGrowthCampaign({businessId,staffId,campaignId:campaign.id},deps)).campaign;
}
const detail = async id => (await campaigns.getGrowthCampaign({businessId,campaignId:id},deps)).campaign;
const members = async id => (await db.query("SELECT customer_id FROM growth_campaign_members WHERE campaign_id=$1 AND allocation='treatment' ORDER BY customer_id",[id])).rows.map(row=>row.customer_id);
async function purchase(customerId, extra={}) {
  return deps.transaction(async client=>{
    const transactionId=extra.transactionId??randomUUID();
    // Real purchase writers serialize and replay receipt IDs before invoking the shared hook.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[transactionId]);
    const existing=await client.query('SELECT points FROM transactions WHERE business_id=$1 AND id=$2',[businessId,transactionId]);
    if(existing.rowCount) return {transactionId,points:existing.rows[0].points,replay:true};
    const business=(await client.query('SELECT * FROM businesses WHERE id=$1',[businessId])).rows[0];
    const claim=await offers.claimTargetedOffer({client,business,customerId,transactionId,source:'online',amountQ:20,basePoints:10,planFeatureOverrides:{},...extra},{getPlanFeatureOverrides:async()=>assert.fail('No nested pooled plan reads in a purchase')});
    if(extra.failAfterClaim) throw new Error('simulated purchase failure');
    if(!extra.omitLedger) {
      await client.query('INSERT INTO transactions(id,business_id,customer_id,points,amount_q,status,source) VALUES($1,$2,$3,$4,20,$5,\'online\')',[transactionId,businessId,customerId,10+claim.bonusPoints,extra.status??'POSTED']);
      await client.query("UPDATE customer_balances SET points=points+CASE WHEN $3='POSTED' THEN $2 ELSE 0 END,pending_points=pending_points+CASE WHEN $3='PENDING' THEN $2 ELSE 0 END WHERE customer_id=$1",[customerId,10+claim.bonusPoints,extra.status??'POSTED']);
    }
    return {...claim,transactionId,points:10+claim.bonusPoints};
  });
}
const preview = id => context(()=>messages.getCampaignMessages({businessId,campaignId:id,now:daytime()}));
const queue = id => context(()=>messages.queueCampaignMessages({businessId,campaignId:id,request_id:randomUUID(),now:daytime()}));
const dispatch = (send,extra={}) => messages.processCampaignMessagesOnce({businessId,now:daytime,send,...extra});

async function waitForPurchaseBlockedBy(pid) {
  const deadline=Date.now()+1500;
  do {
    const {rows}=await db.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) AS blocked",[pid]);
    if(rows[0].blocked) return;
    await new Promise(resolve=>setTimeout(resolve,10));
  } while(Date.now()<deadline);
  assert.fail('The purchase must actually wait on the held row lock before expiry');
}
async function waitUntilExpired(campaignId) {
  await db.query("SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp()))::double precision+0.02) FROM growth_campaigns WHERE id=$1",[campaignId]);
}

suite('campaign point limits on disposable PostgreSQL',()=>{
  before(async()=>{
    const parsed=new URL(url);
    assert.ok(['127.0.0.1','localhost','[::1]'].includes(parsed.hostname));
    assert.equal(parsed.pathname,'/campaign_limits_test');
    Object.assign(process.env,{NODE_ENV:'test',DB_HOST:parsed.hostname,DB_PORT:parsed.port,DB_NAME:'campaign_limits_test',DB_USER:decodeURIComponent(parsed.username),DB_PASSWORD:decodeURIComponent(parsed.password),DB_PASSWORD_FILE:'',DB_MIGRATIONS_PASSWORD_FILE:'',JWT_SECRET_FILE:'',JWT_SECRET:'fixture-campaign-limits-secret-12345678'});
    db=new pg.Pool({connectionString:url,max:20,options:'-c statement_timeout=10000 -c lock_timeout=8000'});
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS app');
    await db.query(`CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_tenant',true),'')::uuid $$;
      CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.platform_admin',true),'')='true' $$`);
    for(const path of ['../../src/app/schema.sql','../../src/app/schema-extensions.sql','../../src/app/migrations/2026-11-10-customer-recovery.sql','../../src/app/migrations/2026-11-10-growth-campaigns.sql','../../src/app/migrations/2026-11-10-growth-messaging.sql']) await db.query(await migration(path));
    // Old refunded and anonymized claims retain the originally granted member bonus.
    const legacyCampaign=randomUUID();
    await db.query("INSERT INTO businesses(id,name,slug,email,password_hash,plan) VALUES($1,'Legacy','legacy','legacy@example.test','unused','NEGOCIO')",[businessId]);
    await db.query("INSERT INTO growth_campaigns(id,business_id,request_id,name,bonus_points,minimum_purchase_q,duration_days,holdout_percent) VALUES($1,$2,$3,'Legacy',50,0,14,20)",[legacyCampaign,businessId,randomUUID()]);
    for(let index=0;index<2;index++) await db.query("INSERT INTO growth_campaign_members(id,business_id,campaign_id,allocation,bonus_points_awarded,claimed_at) VALUES($1,$2,$3,'treatment',50,now())",[randomUUID(),businessId,legacyCampaign]);
    let limits='';
    try { limits=await migration('../../src/app/migrations/2026-11-10-growth-limits.sql'); } catch { /* asserted below */ }
    assert.ok(limits,'Additive campaign budget migration must exist');
    await db.query(limits);
    await db.query(await migration('../../src/app/migrations/2026-11-10-reusable-audiences.sql'));
    await db.query(await migration('../../src/app/migrations/2026-11-10-automation-controls.sql'));
    assert.equal((await db.query('SELECT points_committed FROM growth_campaigns WHERE id=$1',[legacyCampaign])).rows[0].points_committed,100);
    // Reapplication must preserve gross counters instead of resetting them.
    await db.query('UPDATE growth_campaigns SET points_committed=150 WHERE id=$1',[legacyCampaign]);
    await db.query(limits);
    historical=(await db.query('SELECT points_budget,points_committed FROM growth_campaigns WHERE id=$1',[legacyCampaign])).rows[0];
    await applyCampaignExpansionFixture(db, { allowClockFixture: true });
    database=await import('../../src/app/database.js');
    campaigns=await import('../../src/app/services/growth-campaign-service.js');
    offers=await import('../../src/app/services/targeted-offer-service.js');
    messages=await import('../../src/app/services/campaign-message-service.js');
    config=(await import('../../src/config/index.js')).config;
    plans=(await import('../../src/app/services/plan-config-service.js')).PlanConfigService;
    originalPlans=plans.getPlanFeatureOverrides;
    deps={query:db.query.bind(db),getPlanFeatureOverrides:async()=>({}),audit:async()=>{},transaction:async fn=>{
      const client=await db.connect();
      try { await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result; }
      catch(error) { await client.query('ROLLBACK');throw error; }
      finally {client.release();}
    }};
  });
  after(async()=>{if(plans) plans.getPlanFeatureOverrides=originalPlans;await database?.closeDatabase();await db?.end();});
  beforeEach(async()=>{
    plans.getPlanFeatureOverrides=async()=>({});
    Object.assign(config,{MESSAGE_PROVIDER_ORDER:['waha'],WAHA_BASE_URL:'http://fixture.invalid',WAHA_API_KEY:'fixture-only'});
    await db.query('TRUNCATE businesses CASCADE');
    await db.query("INSERT INTO businesses(id,name,slug,email,password_hash,plan) VALUES($1,'Café','limits','limits@example.test','unused','NEGOCIO'),($2,'Other','other','other@example.test','unused','NEGOCIO')",[businessId,otherBusiness]);
    await db.query("INSERT INTO staff_users(id,business_id,name,email,password_hash,role) VALUES($1,$2,'Owner','owner@example.test','unused','OWNER')",[staffId,businessId]);
    recoveryRunId=randomUUID();customers=Array.from({length:20},()=>randomUUID());
    await db.query("INSERT INTO recovery_runs(id,business_id,request_id,name,inactive_days,requested_limit,member_count) VALUES($1,$2,$3,'Fixture',30,20,20)",[recoveryRunId,businessId,randomUUID()]);
    for(const [index,customerId] of customers.entries()) {
      await db.query("INSERT INTO customers(id,business_id,name,phone) VALUES($1,$2,'Member',$3)",[customerId,businessId,`+5025555${String(index).padStart(4,'0')}`]);
      await db.query('INSERT INTO customer_balances(customer_id,points) VALUES($1,0) ON CONFLICT DO NOTHING',[customerId]);
      await db.query("INSERT INTO recovery_members(business_id,run_id,customer_id,last_purchase_at,recorded_sales_q,purchases) VALUES($1,$2,$3,now()-interval '40 days',100,1)",[businessId,recoveryRunId,customerId]);
      await db.query('INSERT INTO customer_marketing_preferences(business_id,customer_id,marketing_opt_in) VALUES($1,$2,true)',[businessId,customerId]);
    }
  });
  it('backfills gross claims even without surviving customers/transactions and preserves a rerun',()=>{
    assert.deepEqual(historical,{points_budget:null,points_committed:150});
  });
  it('validates budgets in the service, includes them in replay fingerprints and exposes nullable availability',async()=>{
    for(const pointsBudget of [0,49,2000001,50.5,'100']) await assert.rejects(create({pointsBudget}),{statusCode:400});
    const requestId=randomUUID();
    const first=await create({requestId,pointsBudget:75});
    assert.deepEqual(await create({requestId,pointsBudget:75}),first);
    await assert.rejects(create({requestId,pointsBudget:100}),{statusCode:409});
    assert.deepEqual([first.campaign.points_budget,first.campaign.points_committed,first.campaign.points_remaining,first.campaign.budget_exhausted],[75,0,75,false]);
    const uncapped=(await create({pointsBudget:null})).campaign;
    assert.deepEqual([uncapped.points_budget,uncapped.points_remaining,uncapped.budget_exhausted],[null,null,false]);
  });
  it('enforces DB bounds, nondecreasing commitments and immutable activated budgets',async()=>{
    const {campaign}=await create({pointsBudget:100});
    for(const value of [0,49,2000001]) await assert.rejects(db.query('UPDATE growth_campaigns SET points_budget=$2 WHERE id=$1',[campaign.id,value]),{code:'23514'});
    await db.query('UPDATE growth_campaigns SET points_budget=150 WHERE id=$1',[campaign.id]);
    await campaigns.activateGrowthCampaign({businessId,staffId,campaignId:campaign.id},deps);
    for(const value of [200,null]) await assert.rejects(db.query('UPDATE growth_campaigns SET points_budget=$2 WHERE id=$1',[campaign.id,value]),{code:'23514'});
    await db.query('UPDATE growth_campaigns SET points_committed=50 WHERE id=$1',[campaign.id]);
    await assert.rejects(db.query('UPDATE growth_campaigns SET points_committed=0 WHERE id=$1',[campaign.id]),{code:'23514'});
    await assert.rejects(db.query('UPDATE growth_campaigns SET points_committed=151 WHERE id=$1',[campaign.id]),{code:'23514'});
  });
  it('serializes distinct customers competing for the final bonus while awarding every base purchase',async()=>{
    const campaign=await activate({pointsBudget:75});
    const recipients=await members(campaign.id);
    const results=await Promise.all(recipients.map(customerId=>purchase(customerId)));
    assert.equal(results.filter(row=>row.bonusPoints===50).length,1);
    assert.equal(results.filter(row=>row.points===10).length,15);
    const current=await detail(campaign.id);
    assert.deepEqual([current.points_committed,current.points_remaining,current.budget_exhausted],[50,25,true]);
    assert.equal((await db.query('SELECT sum(points)::int AS points FROM transactions')).rows[0].points,210);
  });
  it('does not commit twice for replayed receipts or simultaneous claims from the same customer',async()=>{
    const campaign=await activate();const recipient=(await members(campaign.id))[0];const transactionId=randomUUID();
    const results=await Promise.all([purchase(recipient,{transactionId}),purchase(recipient,{transactionId}),purchase(recipient)]);
    assert.equal(results.filter(row=>row.replay).length,1);
    assert.equal((await detail(campaign.id)).points_committed,50);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM transactions')).rows[0].count,2);
  });
  it('rolls budget back on downstream failures, deferred ledger failure and guard rejection',async()=>{
    const campaign=await activate();const recipient=(await members(campaign.id))[0];
    await assert.rejects(purchase(recipient,{failAfterClaim:true}),/simulated purchase failure/);
    await assert.rejects(purchase(recipient,{omitLedger:true}),{code:'23503'});
    await assert.rejects(purchase(recipient,{basePoints:2147483640}),{statusCode:400});
    await db.query(`UPDATE businesses SET program_json=program_json||'{"award_guard":{"max_points_per_tx":55}}' WHERE id=$1`,[businessId]);
    await assert.rejects(purchase(recipient),{statusCode:403});
    assert.equal((await detail(campaign.id)).points_committed,0);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM growth_campaign_members WHERE claimed_at IS NOT NULL')).rows[0].count,0);
  });
  it('does not replenish pending or posted bonuses after refunds, ledger deletion or customer deletion',async()=>{
    const campaign=await activate({pointsBudget:100});const recipients=await members(campaign.id);
    const posted=await purchase(recipients[0]);const pending=await purchase(recipients[1],{status:'PENDING'});
    const {refundAwardTransaction}=await import('../../src/app/services/loyalty-ops-service.js');
    for(const transactionId of [posted.transactionId,pending.transactionId]) {
      const args={staff:{id:staffId,business_id:businessId,role:'OWNER'},transactionId,requestId:randomUUID()};
      const refund=await context(()=>refundAwardTransaction(args));
      assert.equal(refund.replay,undefined);
      assert.equal((await context(()=>refundAwardTransaction(args))).replay,true);
    }
    assert.equal((await detail(campaign.id)).points_committed,100);
    await db.query('DELETE FROM transactions WHERE id=ANY($1::uuid[])',[[posted.transactionId,pending.transactionId]]);
    await db.query('DELETE FROM customers WHERE id=ANY($1::uuid[])',[recipients.slice(0,2)]);
    assert.equal((await detail(campaign.id)).points_remaining,0);
    assert.equal((await purchase(recipients[2])).points,10);
  });
  it('uses the next available campaign in deterministic expiry order after a competing purchase exhausts the first',async()=>{
    const first=await activate({pointsBudget:50});const second=await activate({pointsBudget:100,bonusPoints:25});
    // Establish a shared eligible pair independently of randomized assignment.
    const shared=(await members(first.id)).filter(id=>customers.includes(id)).slice(0,2);
    await db.query("UPDATE growth_campaign_members SET allocation='treatment' WHERE campaign_id=$1 AND customer_id=ANY($2::uuid[])",[second.id,shared]);
    await db.query("UPDATE growth_campaigns SET expires_at=now()+interval '10 days' WHERE id=$1",[first.id]);
    const results=await Promise.all(shared.map(id=>purchase(id)));
    assert.deepEqual(results.map(row=>row.bonusPoints).sort((a,b)=>a-b),[25,50]);
    assert.deepEqual([(await detail(first.id)).points_committed,(await detail(second.id)).points_committed],[50,25]);
  });
  it('keeps unbudgeted campaigns available and excludes paused, expired, foreign-tenant and exhausted offers',async()=>{
    const capped=await activate({pointsBudget:50});const recipient=(await members(capped.id))[0];
    let visible=await offers.getCustomerGrowthOffers({businessId,customerId:recipient},deps);
    assert.equal(visible.offers[0].availability_terms,'Sujeta a los puntos disponibles de la campaña.');
    await purchase(recipient);
    for(const customerId of await members(capped.id)) assert.deepEqual(await offers.getCustomerGrowthOffers({businessId,customerId},deps),{offers:[]});
    const legacy=await activate({pointsBudget:null});
    const legacyRecipients=await members(legacy.id);
    assert.equal((await offers.getCustomerGrowthOffers({businessId,customerId:legacyRecipients[0]},deps)).offers[0].availability_terms,null);
    await Promise.all(legacyRecipients.map(customerId=>purchase(customerId)));
    assert.deepEqual([(await detail(legacy.id)).points_budget,(await detail(legacy.id)).points_committed,(await detail(legacy.id)).budget_exhausted],[null,800,false]);
    const paused=await activate();await campaigns.pauseGrowthCampaign({businessId,staffId,campaignId:paused.id},deps);
    assert.equal((await purchase((await members(paused.id))[0])).bonusPoints,0);
    const expired=await activate();await db.query("UPDATE growth_campaigns SET starts_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[expired.id]);
    assert.equal((await purchase((await members(expired.id))[0])).bonusPoints,0);
    assert.deepEqual(await offers.getCustomerGrowthOffers({businessId:otherBusiness,customerId:recipient},deps),{offers:[]});
  });
  it('keeps only base points when a campaign expires while its dispatch share lock blocks the purchase',async()=>{
    const campaign=await activate({pointsBudget:50});
    const recipient=(await members(campaign.id))[0];
    const dispatchAt=new Date();dispatchAt.setUTCHours(16,0,0,0);
    if(dispatchAt.getTime()>Date.now()) dispatchAt.setUTCDate(dispatchAt.getUTCDate()-1);
    await db.query("UPDATE growth_campaigns SET starts_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",[campaign.id]);
    await context(()=>messages.queueCampaignMessages({businessId,campaignId:campaign.id,request_id:randomUUID(),now:dispatchAt}));
    let notify=()=>{},release=()=>{},dispatchPid;
    const started=new Promise(resolve=>{notify=()=>resolve(undefined);});
    const finish=new Promise(resolve=>{release=()=>resolve(undefined);});
    const sending=messages.processCampaignMessagesOnce({businessId,now:()=>dispatchAt,limit:1,send:async()=>{
      dispatchPid=(await database.dbQuery('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      notify();await finish;return {ok:true,accepted:true,provider:'fixture'};
    }});
    await started;
    const buying=purchase(recipient);
    try {await waitForPurchaseBlockedBy(dispatchPid);await waitUntilExpired(campaign.id);}
    finally {release();await sending;}
    const result=await buying;
    assert.equal(result.points,10);
    assert.equal(result.campaignId,null);
    assert.equal((await detail(campaign.id)).points_committed,0);
    assert.equal((await db.query('SELECT claimed_at FROM growth_campaign_members WHERE campaign_id=$1 AND customer_id=$2',[campaign.id,recipient])).rows[0].claimed_at,null);
  });
  for(const lockedRow of ['campaign','member']) it(`falls back to the next campaign after expiry while waiting on its ${lockedRow} row lock`,async()=>{
    const first=await activate({pointsBudget:50}),second=await activate({pointsBudget:100,bonusPoints:25});
    const recipient=(await members(first.id))[0];
    await db.query("UPDATE growth_campaign_members SET allocation='treatment' WHERE campaign_id=$1 AND customer_id=$2",[second.id,recipient]);
    await db.query("UPDATE growth_campaigns SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",[first.id]);
    const holder=await db.connect();
    await holder.query('BEGIN');
    const pid=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    if(lockedRow==='campaign') await holder.query('SELECT id FROM growth_campaigns WHERE id=$1 FOR SHARE',[first.id]);
    else await holder.query('SELECT id FROM growth_campaign_members WHERE campaign_id=$1 AND customer_id=$2 FOR UPDATE',[first.id,recipient]);
    const buying=purchase(recipient);
    try {await waitForPurchaseBlockedBy(pid);await waitUntilExpired(first.id);}
    finally {await holder.query('COMMIT');holder.release();}
    const result=await buying;
    assert.equal(result.campaignId,second.id);
    assert.equal(result.bonusPoints,25);
    assert.equal((await detail(first.id)).points_committed,0);
    assert.equal((await detail(second.id)).points_committed,25);
    assert.equal((await db.query('SELECT claimed_at FROM growth_campaign_members WHERE campaign_id=$1 AND customer_id=$2',[first.id,recipient])).rows[0].claimed_at,null);
  });
  it('never invites exhausted campaigns in preview or queue and suppresses queued work before claim',async()=>{
    const campaign=await activate({pointsBudget:50});
    assert.match((await preview(campaign.id)).preview.body,/puntos disponibles de la campaña/);
    await queue(campaign.id);await purchase((await members(campaign.id))[0]);
    const current=await preview(campaign.id);
    assert.equal(current.eligible_count,0);assert.equal(current.can_queue,false);assert.doesNotMatch(current.preview.body,/gana 50 puntos/);
    await assert.rejects(queue(campaign.id),{statusCode:409});
    await dispatch(async()=>assert.fail('Exhausted campaign must not reach provider'));
    const outbox=(await db.query('SELECT status,reason FROM growth_message_outbox')).rows;
    assert.ok(outbox.every(row=>row.status==='suppressed'));
    assert.ok(outbox.some(row=>row.reason==='campaign_budget_exhausted'));
  });
  it('rechecks budget after claiming and after asynchronous final entitlement reads',async()=>{
    const campaign=await activate({pointsBudget:50});await queue(campaign.id);let reads=0;
    plans.getPlanFeatureOverrides=async()=>{
      if(++reads===2) await db.query('UPDATE growth_campaigns SET points_committed=50 WHERE id=$1',[campaign.id]);
      return {};
    };
    await dispatch(async()=>assert.fail('Exhausted-after-claim campaign must not reach provider'),{limit:1});
    assert.equal((await db.query("SELECT count(*)::int AS count FROM growth_message_outbox WHERE status='suppressed'")).rows[0].count,1);
  });
  it('keeps unsubscribe capabilities durable when delivery becomes uncertain',async()=>{
    const campaign=await activate({pointsBudget:50});await queue(campaign.id);
    let token;
    await dispatch(async message=>{
      token=new URL(message.body.split('Dejar de recibir promociones: ')[1]).searchParams.get('token');
      throw new Error('Response lost after provider may have accepted');
    },{limit:1});
    assert.ok(token);
    const {tokenMarketingPreference}=await import('../../src/app/services/marketing-preference-service.js');
    assert.equal((await tokenMarketingPreference({token})).marketing_opt_in,true);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM growth_message_outbox WHERE status='uncertain'")).rows[0].count,1);
  });
  it('dispatches concurrently without taking nested connections from the transaction pool',async()=>{
    const campaign=await activate({pointsBudget:1000});await queue(campaign.id);
    plans.getPlanFeatureOverrides=originalPlans;
    let calls=0,release=()=>{},timedOut=false;
    const recipients=new Set(),pending=[];
    const ready=new Promise(resolve=>{release=()=>resolve(undefined);});
    const timer=setTimeout(()=>{timedOut=true;release();},3000);
    try {
      // Claim contention may legitimately skip a limit:1 iteration. Start the
      // next worker after this sender enters; keep all ten sends in flight so
      // the shared release still exercises transaction-pool exhaustion.
      for(let index=0;index<10;index++) {
        let notify=()=>{};
        const entered=new Promise(resolve=>{notify=()=>resolve(undefined);});
        const sending=dispatch(async item=>{
          recipients.add(item.customerId);notify();
          if(++calls===10) release();
          await ready;
          // The real sender also reads shared plan settings in its own transaction.
          await originalPlans.call(plans);
          return {ok:true,accepted:true,provider:'fixture'};
        },{limit:1});
        pending.push(sending);
        await Promise.race([entered,sending.then(()=>assert.fail('Dispatch ended before entering its sender'))]);
      }
      const results=await Promise.all(pending);
      assert.equal(timedOut,false);
      assert.equal(calls,10);
      assert.equal(recipients.size,10);
      assert.equal(results.reduce((sum,result)=>sum+result.accepted,0),10);
    } finally {clearTimeout(timer);release();await Promise.allSettled(pending);}
  });
  it('holds budget availability through dispatch and releases its locks before a purchase completes',async()=>{
    const campaign=await activate({pointsBudget:50});await queue(campaign.id);
    const recipient=(await members(campaign.id))[0];
    let notifySend=()=>{},releaseSend=()=>{};
    const started=new Promise(resolve=>{notifySend=()=>resolve(undefined);});const finish=new Promise(resolve=>{releaseSend=()=>resolve(undefined);});
    const sending=dispatch(async()=>{notifySend();await finish;return {ok:true,accepted:true,provider:'fixture'};},{limit:1});
    await started;
    let completed=false;const buying=purchase(recipient).then(result=>{completed=true;return result;});
    try {await new Promise(resolve=>setTimeout(resolve,70));assert.equal(completed,false,'Budget cannot exhaust while its invitation is being dispatched');}
    finally {releaseSend();await sending;await buying;}
    assert.equal((await detail(campaign.id)).points_committed,50);
  });
});
