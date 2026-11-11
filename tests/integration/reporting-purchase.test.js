import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';
import { getMerchantOverview } from '../../src/app/services/merchant-overview-service.js';
import { getGrowthCampaign } from '../../src/app/services/growth-campaign-service.js';
import { getRedemptionReturns } from '../../src/app/services/redemption-return-service.js';
import { createAcquisitionService } from '../../src/app/services/acquisition-service.js';
import { getReferralGrowth } from '../../src/app/services/referral-growth-service.js';
import { getRewardEconomics } from '../../src/app/services/reward-economics-service.js';
import { getPilot } from '../../src/app/services/merchant-pilot-service.js';
import { getSecondVisitControls } from '../../src/app/services/second-visit-service.js';
import { getRecoveryAudience, getRecoveryRun } from '../../src/app/services/customer-recovery-service.js';

const url = process.env.REPORTING_PURCHASE_TEST_DB_URL;
const suite = url ? describe : describe.skip;
const businessId = randomUUID(), otherBusiness = randomUUID();
const branchId = randomUUID(), otherBranch = randomUUID();
const customerId = randomUUID(), otherCustomer = randomUUID();
const campaignId = randomUUID(), rewardId = randomUUID();
const sourceId = randomUUID(), pilotId = randomUUID(), referrerId = randomUUID();
const runId = randomUUID();
const now = new Date('2020-11-11T18:00:00.000Z');
let db, query;

suite('reporting purchases against dedicated disposable PostgreSQL', () => {
  before(async () => {
    const target = new URL(url);
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(target.pathname, '/reporting_purchase_test');
    db = new pg.Client({ connectionString: url });
    await db.connect();
    query = db.query.bind(db);
    // Fixed repository fixture; all tables are session-local and have no RLS.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await query(await readFile(new URL('../fixtures/merchant-overview.sql', import.meta.url), 'utf8'));
    await query(`ALTER TABLE transactions ADD COLUMN meta jsonb DEFAULT '{}';
      CREATE TEMP TABLE service_redemption_restorations(business_id uuid,redemption_id uuid);
      CREATE TEMP TABLE pos_checkout_intents(business_id uuid,redemption_id uuid,status text,recorded_at timestamptz);
      CREATE TEMP TABLE redemption_pos_records(business_id uuid,redemption_id uuid,returned_quantity numeric DEFAULT 0);
      CREATE TEMP TABLE growth_campaigns(id uuid PRIMARY KEY,business_id uuid,name text DEFAULT 'Test',status text DEFAULT 'active',bonus_points int DEFAULT 10,
        minimum_purchase_q numeric DEFAULT 0,duration_days int DEFAULT 30,holdout_percent int DEFAULT 20,
        member_count int DEFAULT 2,treatment_count int DEFAULT 1,control_count int DEFAULT 1,created_at timestamptz DEFAULT now(),
        starts_at timestamptz DEFAULT '2020-10-01T18:00:00Z',expires_at timestamptz DEFAULT '2020-10-31T18:00:00Z');
      CREATE TEMP TABLE growth_campaign_members(id uuid PRIMARY KEY,business_id uuid,campaign_id uuid,customer_id uuid,allocation text,
        bonus_transaction_id uuid,bonus_points_awarded int DEFAULT 0);
      CREATE TEMP TABLE growth_message_outbox(business_id uuid,campaign_id uuid,status text);
      ALTER TABLE businesses ADD COLUMN plan text DEFAULT 'NEGOCIO',ADD COLUMN program_type text DEFAULT 'SPEND';
      ALTER TABLE branches ADD COLUMN name text DEFAULT 'Sucursal';
      ALTER TABLE customers ADD COLUMN name text DEFAULT 'Cliente',ADD COLUMN phone text,ADD COLUMN imported_at timestamptz,ADD COLUMN created_at timestamptz DEFAULT '2020-10-01T18:00:00Z';
      ALTER TABLE rewards ADD COLUMN points_cost int DEFAULT 10,ADD COLUMN active boolean DEFAULT true,ADD COLUMN valid_until timestamptz,ADD COLUMN stock int;
      ALTER TABLE growth_campaign_members ADD COLUMN claimed_at timestamptz;
      CREATE TEMP TABLE acquisition_sources(id uuid PRIMARY KEY,business_id uuid,name text,code text,branch_id uuid,visits bigint DEFAULT 0,created_at timestamptz DEFAULT '2020-10-01T18:00:00Z');
      CREATE TEMP TABLE acquisition_attributions(id uuid,business_id uuid,source_id uuid,customer_id uuid,created_at timestamptz DEFAULT '2020-10-01T18:00:00Z');
      CREATE TEMP TABLE referrals(id uuid,business_id uuid,referred_customer_id uuid,referrer_customer_id uuid,status text DEFAULT 'pending',created_at timestamptz DEFAULT '2020-10-01T18:00:00Z',
        referrer_rewarded_at timestamptz,referrer_reward_points int,referred_rewarded_at timestamptz,referred_reward_points int);
      CREATE TEMP TABLE redemption_cost_snapshots(redemption_id uuid,business_id uuid,reward_id uuid,points_cost int,unit_cost_q numeric,redeemed_at timestamptz);
      CREATE TEMP TABLE reward_unit_costs(business_id uuid,reward_id uuid,unit_cost_q numeric);
      CREATE TEMP TABLE customer_balances(customer_id uuid,points int DEFAULT 0,pending_points int DEFAULT 0);
      CREATE TEMP TABLE reward_economics_settings(business_id uuid,gross_margin_pct numeric,cost_per_point_q numeric);
      CREATE TEMP TABLE merchant_pilots(id uuid,business_id uuid,name text DEFAULT 'Piloto',status text DEFAULT 'active',checklist_version int DEFAULT 1,
        started_at timestamptz DEFAULT '2020-10-01T18:00:00Z',planned_end_at timestamptz DEFAULT '2020-10-31T18:00:00Z',closed_at timestamptz);
      CREATE TEMP TABLE merchant_pilot_checks(business_id uuid,pilot_id uuid,check_key text,status text,note text,updated_at timestamptz);
      CREATE TEMP TABLE second_visit_enrollments(business_id uuid,customer_id uuid,first_transaction_id uuid,campaign_id uuid);
      CREATE TEMP TABLE second_visit_budgets(business_id uuid,month date,points_committed int,offers_created int);
      CREATE TEMP TABLE recovery_runs(id uuid,business_id uuid,name text DEFAULT 'Recuperación',notes text DEFAULT '',inactive_days int DEFAULT 30,requested_limit int DEFAULT 10,member_count int DEFAULT 1,created_at timestamptz DEFAULT '2020-10-01T18:00:00Z');
      CREATE TEMP TABLE recovery_members(business_id uuid,run_id uuid,customer_id uuid,status text DEFAULT 'contacted',contacted_at timestamptz DEFAULT '2020-10-01T18:00:00Z',
        last_purchase_at timestamptz DEFAULT '2020-08-01T18:00:00Z',recorded_sales_q numeric DEFAULT 10,purchases int DEFAULT 1);`);
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    await query('TRUNCATE transactions,redemptions,rewards,customers,branches,businesses,growth_campaigns,growth_campaign_members,acquisition_sources,acquisition_attributions,referrals,merchant_pilots,second_visit_enrollments,recovery_runs,recovery_members');
    await query('INSERT INTO businesses(id) VALUES($1),($2)', [businessId, otherBusiness]);
    await query('INSERT INTO branches VALUES($1,$2),($3,$4)', [branchId, businessId, otherBranch, otherBusiness]);
    await query('INSERT INTO customers VALUES($1,$2,NULL),($3,$4,NULL)', [customerId, businessId, otherCustomer, otherBusiness]);
    await query("INSERT INTO rewards VALUES($1,$2,'Café')", [rewardId, businessId]);
    await query("INSERT INTO redemptions VALUES($1,$2,$3,$4,$5,10,'REDEEMED','2020-10-01T18:00:00Z','2020-10-01T18:00:00Z')", [randomUUID(), businessId, branchId, customerId, rewardId]);
    await query('INSERT INTO growth_campaigns(id,business_id) VALUES($1,$2)', [campaignId, businessId]);
    await query("INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation) VALUES($1,$2,$3,$4,'treatment')", [randomUUID(), businessId, campaignId, customerId]);
    await query('INSERT INTO customers(id,business_id) VALUES($1,$2)', [referrerId, businessId]);
    await query("INSERT INTO acquisition_sources(id,business_id,name,code) VALUES($1,$2,'Origen','reporting-source')", [sourceId, businessId]);
    await query('INSERT INTO acquisition_attributions(id,business_id,source_id,customer_id) VALUES($1,$2,$3,$4)', [randomUUID(),businessId,sourceId,customerId]);
    await query('INSERT INTO referrals(id,business_id,referred_customer_id,referrer_customer_id) VALUES($1,$2,$3,$4)', [randomUUID(),businessId,customerId,referrerId]);
    await query('INSERT INTO merchant_pilots(id,business_id) VALUES($1,$2)', [pilotId,businessId]);
    await query('INSERT INTO second_visit_enrollments VALUES($1,$2,$3,$4)', [businessId,customerId,randomUUID(),campaignId]);
    await query('INSERT INTO recovery_runs(id,business_id) VALUES($1,$2)', [runId,businessId]);
    await query('INSERT INTO recovery_members(business_id,run_id,customer_id) VALUES($1,$2,$3)', [businessId,runId,customerId]);
  });

  async function purchase(values = {}) {
    const t = { id: randomUUID(), tenant: businessId, customer: customerId, branch: branchId,
      amount: 20, visits: 0, items: 0, points: 10, type: 'PURCHASE', source: 'online', status: 'POSTED',
      original: null, reversed: null, at: '2020-10-02T18:00:00Z', ...values };
    await query(`INSERT INTO transactions(id,business_id,customer_id,branch_id,amount_q,visits,items,points,type,source,status,original_transaction_id,reversed_transaction_id,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [t.id,t.tenant,t.customer,t.branch,t.amount,t.visits,t.items,t.points,t.type,t.source,t.status,t.original,t.reversed,t.at]);
    return t.id;
  }
  const overview = (options = {}) => getMerchantOverview({ businessId, days: 90, now, ...options }, query);
  const campaign = (options = {}) => getGrowthCampaign({ businessId, campaignId, ...options }, { query });
  const returns = (options = {}) => getRedemptionReturns({ businessId, days: 90, now, ...options }, query);

  it('keeps overview counts, sales and daily totals after points expire; a reversal still removes the purchase', async () => {
    const id = await purchase();
    const posted = await overview();
    assert.equal(posted.current.purchases, 1);
    assert.equal(posted.current.recorded_sales_q, 20);
    await query("UPDATE transactions SET status='EXPIRED' WHERE id=$1", [id]);
    const expired = await overview();
    assert.deepEqual(expired, posted, 'Point expiry cannot erase recorded sales or visits');
    await query("UPDATE transactions SET status='REVERSED' WHERE id=$1", [id]);
    const reversed = await overview();
    assert.equal(reversed.current.purchases, 0);
    assert.equal(reversed.current.recorded_sales_q, 0);
  });

  it('keeps campaign returns and recorded sales after point expiry without changing assigned denominators', async () => {
    const id = await purchase();
    const posted = (await campaign()).results.treatment;
    assert.equal(posted.returned_customers, 1);
    assert.equal(posted.recorded_sales_q, 20);
    await query("UPDATE transactions SET status='EXPIRED' WHERE id=$1", [id]);
    assert.deepEqual((await campaign()).results.treatment, posted);
    await query("UPDATE transactions SET status='REVERSED' WHERE id=$1", [id]);
    const reversed = (await campaign()).results.treatment;
    assert.equal(reversed.returned_customers, 0);
    assert.equal(reversed.recorded_sales_q, 0);
    assert.equal(reversed.members, posted.members);
  });

  it('keeps redemption returns after expiry and removes refund-linked expired purchases', async () => {
    const id = await purchase();
    const posted = await returns();
    assert.equal(posted.completed.returned_customers, 1);
    await query("UPDATE transactions SET status='EXPIRED' WHERE id=$1", [id]);
    assert.deepEqual(await returns(), posted);
    await query('UPDATE transactions SET reversed_transaction_id=$2 WHERE id=$1', [id, randomUUID()]);
    const refunded = await returns();
    assert.equal(refunded.completed.customers, 1);
    assert.equal(refunded.completed.returned_customers, 0);
  });

  it('includes pending, legacy, visit and item purchases; excludes bonuses, imports, empty awards and corrections', async () => {
    for (const values of [
      { status: 'PENDING', source: 'offline' }, { status: 'EXPIRED', type: null, source: 'external' },
      { amount: 0, visits: 1, source: 'order' }, { amount: 0, items: 1 }
    ]) await purchase(values);
    for (const values of [
      ...['lifecycle','expire','redeem','reversal','correction','migration','unknown'].map(source => ({ source })),
      ...['ACHIEVEMENT','CHALLENGE','REFERRAL_REWARD','MANUAL_ADJUSTMENT','OPENING_BALANCE'].map(type => ({ type })),
      { status: 'REVERSED' }, { status: 'CANCELLED' }, { original: randomUUID() },
      { status: 'EXPIRED', reversed: randomUUID() }, { amount: 0, points: 500 }
    ]) await purchase(values);
    const out = await overview();
    assert.equal(out.current.purchases, 4);
    assert.equal(out.current.recorded_sales_q, 40);
    assert.equal((await campaign()).results.treatment.recorded_sales_q, 40);
    assert.equal((await returns()).completed.returned_customers, 1);
  });

  it('preserves tenant, branch and each report date boundaries with expired purchases', async () => {
    await purchase({ status: 'EXPIRED' });
    await purchase({ status: 'EXPIRED', branch: null, amount: 5 });
    await purchase({ status: 'EXPIRED', tenant: otherBusiness, customer: otherCustomer, branch: otherBranch, amount: 999 });
    await purchase({ status: 'EXPIRED', at: now.toISOString(), amount: 999 });
    assert.equal((await overview()).current.recorded_sales_q, 25);
    assert.equal((await overview({ branchId })).current.recorded_sales_q, 20);
    assert.equal((await overview({ businessId: otherBusiness })).current.recorded_sales_q, 999);
    assert.equal((await campaign()).results.treatment.recorded_sales_q, 25);
    await assert.rejects(campaign({ businessId: otherBusiness }), { statusCode: 404 });
    assert.equal((await returns({ businessId: otherBusiness })).cohort.customers, 0);
    await assert.rejects(returns({ branchId: otherBranch }), { statusCode: 400 });
  });

  /** @type {Array<[string, () => Promise<{ count: number, sales?: number, denominator?: number }>]>} */
  const auditedReports = [
    ['acquisition', async () => {
      const service = createAcquisitionService({ query, context: (_scope, fn) => fn() });
      const out = await service.report({ id: businessId, slug: 'reporting-test' }, 'https://example.test');
      return { count: out.sources[0].first_purchasers, sales: out.sources[0].recorded_sales_q };
    }],
    ['referral growth', async () => {
      const out = await getReferralGrowth({ businessId, days: 90, now }, query);
      return { count: out.summary.purchased, denominator: out.summary.registered };
    }],
    ['reward economics', async () => {
      const out = await getRewardEconomics({ businessId, days: 90, now }, query);
      return { count: out.observed.recorded_purchases, sales: out.observed.recorded_sales_q };
    }],
    ['pilot results', async () => {
      const out = await getPilot({ businessId, pilotId }, { query, now: () => now });
      return { count: out.results.current.purchases, sales: out.results.current.recorded_sales_q };
    }],
    ['second-visit results', async () => {
      const out = await getSecondVisitControls({ businessId, now }, { query, getPlanFeatureOverrides: async () => ({}) });
      return { count: out.results.returned_customers, denominator: out.results.offers_created };
    }],
    ['manual recovery results', async () => {
      const out = await getRecoveryRun({ businessId, runId, now }, { query });
      return { count: out.run.returned_count, sales: out.run.recorded_sales_after_contact_q, denominator: out.run.contacted_count };
    }]
  ];
  for (const [name, read] of auditedReports) {
    it(`${name} retains recorded purchases after expiry and excludes a later reversal`, async () => {
      const id = await purchase();
      await purchase({ status: 'EXPIRED', tenant: otherBusiness, customer: otherCustomer, branch: otherBranch, amount: 999 });
      await purchase({ status: 'EXPIRED', tenant: otherBusiness, customer: customerId, amount: 999 });
      const posted = await read();
      assert.equal(posted.count, 1);
      if ('sales' in posted) assert.equal(posted.sales, 20);
      await query("UPDATE transactions SET status='EXPIRED' WHERE id=$1", [id]);
      assert.deepEqual(await read(), posted);
      await query("UPDATE transactions SET status='REVERSED' WHERE id=$1", [id]);
      const reversed = await read();
      assert.equal(reversed.count, 0);
      if ('sales' in reversed) assert.equal(reversed.sales, 0);
      if ('denominator' in reversed) assert.equal(reversed.denominator, posted.denominator);
    });
  }

  it('keeps recovery audience selection separate from the expanded reporting definition', async () => {
    await purchase({ status: 'EXPIRED' });
    const audience = await getRecoveryAudience({ businessId, inactiveDays: 30, now }, { query });
    assert.equal(audience.total, 0, 'A reporting fix must not enroll a different marketing audience');
  });
});
