import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, describe, it } from 'node:test';
import pg from 'pg';
const url = process.env.CAMPAIGN_EXPANSION_TEST_DB_URL;
const suite = url ? describe : describe.skip;
const businessId = randomUUID(), otherBusiness = randomUUID(), staffId = randomUUID();
let db, growth, prepare, preflight, targeted, deps, segmentId, customers, audits;
const definition = { window_days: 90, include: { match: 'all', rules: [{ field: 'joined_days', operator: 'gte', value: 0 }] }, exclude: { match: 'any', rules: [] } };
async function sqlFile(path) {
  // Static repository migrations selected below, never request input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFile(new URL(path, import.meta.url), 'utf8');
}
suite('quiet offers, campaign preflight and durable preparation in isolated PostgreSQL', () => {
  before(async () => {
    const parsed = new URL(url);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
    assert.equal(parsed.pathname, '/campaign_expansion_test');
    db = new pg.Pool({ connectionString: url });
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await db.query(await sqlFile('../fixtures/customer-recovery.sql'));
    await db.query(`ALTER TABLE businesses ADD COLUMN name text DEFAULT 'Cafe', ADD COLUMN plan text DEFAULT 'NEGOCIO', ADD COLUMN program_type text DEFAULT 'SPEND', ADD COLUMN program_json jsonb DEFAULT '{}';
      ALTER TABLE customers ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE transactions ALTER COLUMN created_at SET DEFAULT now();
      CREATE TABLE customer_balances(customer_id uuid PRIMARY KEY, points int DEFAULT 0);
      CREATE TABLE background_jobs(id uuid PRIMARY KEY,business_id uuid REFERENCES businesses(id),job_type text,status text DEFAULT 'QUEUED',payload jsonb,result jsonb,error text,attempts int DEFAULT 0,run_after timestamptz DEFAULT now(),locked_at timestamptz,started_at timestamptz,completed_at timestamptz,created_at timestamptz DEFAULT now());
      CREATE TABLE lifecycle_message_outbox(id uuid PRIMARY KEY,business_id uuid,customer_id uuid,status text,last_attempt_at timestamptz);`);
    for (const name of ['customer-recovery','growth-campaigns','growth-limits','reusable-audiences','growth-messaging']) await db.query(await sqlFile(`../../src/app/migrations/2026-11-10-${name}.sql`));
    let migration = '';
    try { migration = await sqlFile('../../src/app/migrations/2026-11-11-campaign-expansion.sql'); } catch { /* missing feature asserted explicitly */ }
    assert.ok(migration, 'Quiet offers, preflight and durable campaign preparation schema must exist');
    await db.query(migration);
    growth = await import('../../src/app/services/growth-campaign-service.js');
    prepare = await import('../../src/app/services/campaign-preparation-service.js');
    preflight = await import('../../src/app/services/campaign-preflight-service.js');
    targeted = await import('../../src/app/services/targeted-offer-service.js');
    deps = { query: db.query.bind(db), audit: async e => audits.push(e), getPlanFeatureOverrides: async () => ({}),
      runInTenant: async (_businessId, fn) => fn(), transaction: async fn => {
        const client = await db.connect();
        try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      } };
  });
  after(async () => db?.end());
  beforeEach(async () => {
    audits = []; segmentId = randomUUID(); customers = Array.from({ length: 20 }, () => randomUUID()).sort();
    await db.query('TRUNCATE businesses,staff_users,customers,transactions,customer_balances CASCADE');
    await db.query(`INSERT INTO businesses(id,program_json) VALUES($1,'{"points_per_q":1}'),($2,'{}')`, [businessId, otherBusiness]);
    await db.query('INSERT INTO staff_users VALUES($1,$2)', [staffId, businessId]);
    await db.query(`INSERT INTO customers(id,business_id,name,phone,created_at) SELECT id,$1,'Member','50255550000',now()-interval '1 day' FROM unnest($2::uuid[]) id`, [businessId, customers]);
    await db.query(`INSERT INTO merchant_audiences(id,business_id,request_id,request_fingerprint,name,definition) VALUES($1,$2,$3,$4,'Everybody',$5)`, [segmentId, businessId, randomUUID(), 'a'.repeat(64), definition]);
  });
  const input = patch => ({ businessId, staffId, requestId: randomUUID(), audienceSegmentId: segmentId, audienceSegmentVersion: 1, audienceLimit: 20, name: 'This afternoon', bonusPoints: 50, minimumPurchaseQ: 10, durationDays: 14, holdoutPercent: 20, estimatedCostPerPointQ: 0.1, ...patch });
  const quiet = patch => growth.createGrowthCampaign(input({ offerKind: 'quiet', durationMinutes: 60, durationDays: null, holdoutPercent: 0, pointsBudget: 100, ...patch }), deps);
  const preview = campaignId => preflight.createCampaignPreflight({ businessId, staffId, campaignId }, deps);
  async function activate(campaignId) { const { preflight: p } = await preview(campaignId); return growth.activateGrowthCampaign({ businessId, staffId, campaignId, preflightId: p.id }, deps); }
  async function award(customerId, patch = {}) {
    return deps.transaction(async client => {
      const transactionId = randomUUID(), business = (await client.query('SELECT * FROM businesses WHERE id=$1', [businessId])).rows[0];
      const bonus = await targeted.claimTargetedOffer({ client, business, customerId, transactionId, source: 'online', amountQ: 10, basePoints: 10, planFeatureOverrides: {}, ...patch });
      await client.query('INSERT INTO transactions(id,business_id,customer_id,amount_q,points) VALUES($1,$2,$3,10,$4)', [transactionId, businessId, customerId, 10 + bonus.bonusPoints]);
      return { ...bonus, transactionId };
    });
  }
  it('requires bounded quiet terms and makes a draft without granting or messaging', async () => {
    for (const patch of [{ durationMinutes: 29 }, { durationMinutes: 241 }, { pointsBudget: null }, { audienceLimit: 201 }, { holdoutPercent: 20 }]) await assert.rejects(quiet(patch), { statusCode: 400 });
    const { campaign } = await quiet();
    assert.equal(campaign.offer_kind, 'quiet'); assert.equal(campaign.status, 'draft'); assert.equal(campaign.duration_minutes, 60);
    assert.equal(campaign.control_count, 0); assert.equal(campaign.expires_at, null);
    assert.equal((await award(customers[0])).bonusPoints, 0);
    assert.equal((await db.query('SELECT * FROM growth_message_outbox')).rowCount, 0);
    await assert.rejects(growth.activateGrowthCampaign({ businessId, staffId, campaignId: campaign.id }, deps), { statusCode: 409 });
  });
  it('starts a one-hour DB-clock offer with no control, requires a purchase, and caps concurrent claims', async () => {
    const { campaign: draft } = await quiet();
    const [a,b] = await Promise.all([activate(draft.id), activate(draft.id)]);
    assert.equal(a.campaign.starts_at, b.campaign.starts_at);
    assert.equal(a.campaign.control_count, 0); assert.equal(a.campaign.treatment_count, 20);
    assert.equal(Date.parse(a.campaign.expires_at) - Date.parse(a.campaign.starts_at), 60 * 60000);
    assert.equal((await award(customers[0], { amountQ: 0 })).bonusPoints, 0);
    const bonuses = await Promise.all(customers.slice(0,5).map(id => award(id)));
    assert.equal(bonuses.reduce((n,b) => n+b.bonusPoints,0), 100);
    assert.equal((await growth.getGrowthCampaign({ businessId, campaignId: draft.id }, deps)).results.estimated_incremental_sales_q, null);
    const used = bonuses.find(b => b.bonusPoints);
    await db.query("UPDATE transactions SET status='REVERSED' WHERE id=$1", [used.transactionId]);
    assert.equal((await award(customers[9])).bonusPoints, 0, 'refund does not replenish gross budget');
    assert.equal((await db.query('SELECT points_committed FROM growth_campaigns WHERE id=$1',[draft.id])).rows[0].points_committed,100);
  });
  it('uses only one targeted bonus per purchase across overlapping offers and preserves awarded points when paused', async () => {
    const one = (await quiet({ pointsBudget: 50 })).campaign, two = (await quiet({ durationMinutes: 120 })).campaign;
    await activate(one.id); await activate(two.id);
    const first = await award(customers[0]); assert.equal(first.bonusPoints, 50); assert.equal(first.campaignId, one.id);
    assert.equal((await award(customers[0])).campaignId, two.id);
    await growth.pauseGrowthCampaign({ businessId, staffId, campaignId: two.id }, deps);
    assert.equal((await db.query('SELECT points FROM transactions WHERE id=$1',[first.transactionId])).rows[0].points, 60);
    assert.equal((await award(customers[2])).bonusPoints, 0);
    await assert.rejects(db.query('UPDATE growth_campaigns SET bonus_points=100 WHERE id=$1',[one.id]), { code: '23514' });
  });
  it('expires automatically by server time and does not let a waiting purchase claim after expiry', async () => {
    const { campaign } = await quiet(); await activate(campaign.id);
    // Test-only clock fixture established before the guard; no API can change these dates.
    await db.query('ALTER TABLE growth_campaigns DISABLE TRIGGER growth_campaigns_terms_guard');
    await db.query("UPDATE growth_campaigns SET starts_at=now()-interval '1 hour',expires_at=now()+interval '0.15 second' WHERE id=$1",[campaign.id]);
    await db.query('ALTER TABLE growth_campaigns ENABLE TRIGGER growth_campaigns_terms_guard');
    const blocker = await db.connect(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM growth_campaigns WHERE id=$1 FOR NO KEY UPDATE',[campaign.id]);
    const pending = award(customers[0]); await new Promise(resolve => setTimeout(resolve,250));
    await blocker.query('COMMIT'); blocker.release();
    assert.equal((await pending).bonusPoints,0);
    assert.deepEqual(await targeted.getCustomerGrowthOffers({businessId,customerId:customers[0]},deps), {offers:[]});
  });
  it('previews exact commitment, one-targeted-offer stacking, contact exclusions and unknown external discounts', async () => {
    await db.query('INSERT INTO customer_marketing_preferences(business_id,customer_id,marketing_opt_in) VALUES($1,$2,true),($1,$3,true)',[businessId,customers[0],customers[1]]);
    await db.query("INSERT INTO lifecycle_message_outbox VALUES($1,$2,$3,'uncertain',now())",[randomUUID(),businessId,customers[0]]);
    const {campaign} = await quiet({pointsBudget:125}); const {preflight:p} = await preview(campaign.id);
    assert.equal(p.maximum_commitment_points,100); assert.equal(p.maximum_incentive_cost_q,10);
    assert.equal(p.stacking.targeted_offers_per_purchase,1); assert.equal(p.stacking.external_discounts,'unknown');
    assert.equal(p.reward_availability.state,'not_applicable');
    assert.equal(p.contacts.without_permission_or_phone,18); assert.equal(p.contacts.frequency_excluded,1); assert.equal(p.contacts.eligible_now,1);
    assert.equal(p.can_activate,true);
  });
  it('rejects stale preview after consent changes and recomputes guard contradictions on activation', async () => {
    const {campaign} = await quiet(); const {preflight:p} = await preview(campaign.id);
    await db.query('INSERT INTO customer_marketing_preferences(business_id,customer_id,marketing_opt_in) VALUES($1,$2,true)',[businessId,customers[0]]);
    await assert.rejects(growth.activateGrowthCampaign({businessId,staffId,campaignId:campaign.id,preflightId:p.id},deps),{statusCode:409});
    await db.query(`UPDATE businesses SET program_json=program_json||'{"award_guard":{"max_points_per_tx":40}}' WHERE id=$1`,[businessId]);
    const next = (await preview(campaign.id)).preflight;
    assert.equal(next.can_activate,false); assert.ok(next.blockers.some(b=>b.code==='bonus_exceeds_purchase_guard'));
    await assert.rejects(activate(campaign.id),{statusCode:409});
  });
  it('blocks stale activity audiences while leaving non-activity audiences usable with explicit unknown cost', async () => {
    await db.query(`UPDATE businesses SET program_json=program_json||'{"pos_integration":{"mode":"loyverse","automatic":true,"enabled":true}}' WHERE id=$1`,[businessId]);
    const {campaign:a} = await quiet({estimatedCostPerPointQ:null});
    const p=(await preview(a.id)).preflight; assert.equal(p.can_activate,true); assert.equal(p.maximum_incentive_cost_q,null);
    await db.query('UPDATE merchant_audiences SET definition=$2,version=2 WHERE id=$1',[segmentId,{...definition,include:{match:'all',rules:[{field:'has_purchase',operator:'eq',value:false}]}}]);
    const {campaign:b}=await quiet({audienceSegmentVersion:2}); const blocked=(await preview(b.id)).preflight;
    assert.equal(blocked.can_activate,false); assert.ok(blocked.blockers.some(b=>b.code==='data_not_ready'));
  });
  it('keeps the small campaign API bounded, snapshots up to 5000 in the worker and resumes after chunk failure', async () => {
    const more = Array.from({length:5100},()=>randomUUID());
    await db.query(`INSERT INTO customers(id,business_id,name,phone,created_at) SELECT id,$1,'Bulk','50255550000',now()-interval '1 day' FROM unnest($2::uuid[]) id`,[businessId,more]);
    await assert.rejects(growth.createGrowthCampaign(input({audienceLimit:5000}),deps),{statusCode:400});
    const opts=input({audienceLimit:5000}); const first=await prepare.createCampaignPreparation(opts,deps); const replay=await prepare.createCampaignPreparation(opts,deps);
    assert.equal(first.campaign.id,replay.campaign.id); assert.equal(first.campaign.preparation_status,'queued'); assert.equal(first.campaign.member_count,0);
    assert.equal((await db.query("SELECT * FROM background_jobs WHERE job_type='growth.campaign.prepare'")).rowCount,1);
    await assert.rejects(activate(first.campaign.id),{statusCode:409});
    let chunks=0;
    await assert.rejects(prepare.runCampaignPreparationJob({businessId,campaignId:first.campaign.id},{...deps,afterChunk:async()=>{if(++chunks===2)throw Error('test restart');}}),/test restart/);
    const partial=(await growth.getGrowthCampaign({businessId,campaignId:first.campaign.id},deps)).campaign;
    assert.equal(partial.prepared_count,500); assert.equal(partial.preparation_status,'failed');
    await db.query('UPDATE merchant_audiences SET archived=true,version=2 WHERE id=$1',[segmentId]);
    await prepare.retryCampaignPreparation({businessId,staffId,campaignId:first.campaign.id},deps);
    const done=await prepare.runCampaignPreparationJob({businessId,campaignId:first.campaign.id},deps);
    assert.equal(done.status,'ready'); assert.equal(done.prepared,5000);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM growth_campaign_members WHERE campaign_id=$1',[first.campaign.id])).rows[0].n,5000);
    assert.equal((await prepare.runCampaignPreparationJob({businessId,campaignId:first.campaign.id},deps)).prepared,5000);
    const active=(await activate(first.campaign.id)).campaign; assert.equal(active.member_count,5000); assert.equal(active.control_count,1000);
  });
  it('cancels partial preparation permanently, retains progress and never activates it', async () => {
    const {campaign}=await prepare.createCampaignPreparation(input({audienceLimit:1000}),deps);
    await prepare.runCampaignPreparationJob({businessId,campaignId:campaign.id},{...deps,afterChunk:async()=>{await prepare.cancelCampaignPreparation({businessId,staffId,campaignId:campaign.id},deps);}});
    const c=(await growth.getGrowthCampaign({businessId,campaignId:campaign.id},deps)).campaign;
    assert.equal(c.preparation_status,'cancelled'); assert.equal(c.prepared_count,20);
    await assert.rejects(activate(campaign.id),{statusCode:409});
    await assert.rejects(prepare.retryCampaignPreparation({businessId,staffId,campaignId:campaign.id},deps),{statusCode:409});
  });
  it('rolls back queued work when audit fails and enforces tenant boundaries for preview and preparation', async () => {
    await assert.rejects(prepare.createCampaignPreparation(input({audienceLimit:1000}),{...deps,audit:async()=>{throw Error('audit');}}),/audit/);
    assert.equal((await db.query('SELECT * FROM background_jobs')).rowCount,0);
    const {campaign}=await quiet();
    await assert.rejects(preflight.createCampaignPreflight({businessId:otherBusiness,staffId,campaignId:campaign.id},deps),{statusCode:404});
    await assert.rejects(prepare.cancelCampaignPreparation({businessId:otherBusiness,staffId,campaignId:campaign.id},deps),{statusCode:404});
    await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='campaign_expansion_reader') THEN CREATE ROLE campaign_expansion_reader; END IF; END $$;
      GRANT USAGE ON SCHEMA public,app TO campaign_expansion_reader; GRANT SELECT ON growth_campaigns,growth_campaign_preflights,growth_campaign_preparations TO campaign_expansion_reader`);
    const client=await db.connect();
    try { await client.query('SET ROLE campaign_expansion_reader'); assert.equal((await client.query('SELECT * FROM growth_campaigns')).rowCount,0);
      await client.query("SELECT set_config('app.current_tenant',$1,false)",[otherBusiness]); assert.equal((await client.query('SELECT * FROM growth_campaign_preflights')).rowCount,0);
      await client.query("SELECT set_config('app.current_tenant',$1,false)",[businessId]); assert.equal((await client.query('SELECT * FROM growth_campaigns')).rowCount,1);
    } finally { await client.query('RESET ROLE'); await client.query("SELECT set_config('app.current_tenant','',false)"); client.release(); }
  });
});
