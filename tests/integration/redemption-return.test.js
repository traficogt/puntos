import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';

const url = process.env.REDEMPTION_RETURN_TEST_DB_URL;
const suite = url ? describe : describe.skip;
const businessId = randomUUID(), otherBusiness = randomUUID();
const branchA = randomUUID(), branchB = randomUUID(), otherBranch = randomUUID();
const now = new Date('2026-11-11T18:00:00.000Z');
let db, getRedemptionReturns;

suite('redemption return cohorts against isolated PostgreSQL', () => {
  before(async () => {
    const target = new URL(url);
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(target.pathname, '/redemption_return_test', 'Dedicated disposable database required');
    const service = new URL('../../src/app/services/redemption-return-service.js', import.meta.url);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository module URL.
    assert.ok(existsSync(service), 'The redemption return report service must exist');
    ({ getRedemptionReturns } = await import(service.href));
    db = new pg.Client({ connectionString: url });
    await db.connect();
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture, temporary tables only.
    await db.query(await readFile(new URL('../fixtures/redemption-return.sql', import.meta.url), 'utf8'));
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    await db.query('TRUNCATE transactions, redemptions, rewards, customers, branches, businesses, service_redemption_restorations, pos_checkout_intents, redemption_pos_records');
    await db.query('INSERT INTO businesses(id) VALUES($1),($2)', [businessId, otherBusiness]);
    await db.query('INSERT INTO branches VALUES($1,$2),($3,$2),($4,$5)', [branchA, businessId, branchB, otherBranch, otherBusiness]);
  });
  const report = (options = {}) => getRedemptionReturns({ businessId, now, ...options }, db.query.bind(db));
  async function customer(tenant = businessId, deleted = false) {
    const id = randomUUID();
    await db.query('INSERT INTO customers VALUES($1,$2,$3)', [id, tenant, deleted ? now : null]);
    return id;
  }
  async function redeem(customerId, options = {}) {
    /** @type {{id:string,businessId:string,rewardBusiness:string,branchId:string|null,at:string,status:string,created?:string,redeemed?:string|null}} */
    const r = { id: randomUUID(), businessId, rewardBusiness: businessId, branchId: branchA, at: '2026-09-10T18:00:00Z', status: 'REDEEMED', ...options };
    const reward = randomUUID();
    await db.query('INSERT INTO rewards VALUES($1,$2)', [reward, r.rewardBusiness]);
    await db.query('INSERT INTO redemptions VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [r.id, r.businessId, r.branchId, customerId, reward, r.status, r.created ?? r.at, Object.hasOwn(r, 'redeemed') ? r.redeemed : r.at]);
    return r.id;
  }
  async function purchase(customerId, options = {}) {
    const t = { id: randomUUID(), businessId, branchId: branchA, amount: 10, points: 0, visits: 0, items: 0, type: 'PURCHASE', source: 'online', status: 'POSTED', original: null, reversed: null, at: '2026-09-11T18:00:00Z', meta: {}, ...options };
    await db.query(`INSERT INTO transactions(id,business_id,branch_id,customer_id,type,amount_q,points,visits,items,status,source,original_transaction_id,reversed_transaction_id,created_at,meta)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [t.id, t.businessId, t.branchId, customerId, t.type, t.amount, t.points, t.visits, t.items, t.status, t.source, t.original, t.reversed, t.at, t.meta]);
  }

  it('uses every matured customer as denominator and separates ongoing customers even if already returned', async () => {
    const returned = await customer(), absent = await customer(), ongoingReturned = await customer(), ongoingAbsent = await customer();
    await redeem(returned); await redeem(absent);
    await redeem(ongoingReturned, { at: '2026-11-01T18:00:00Z' });
    await redeem(ongoingAbsent, { at: '2026-11-01T18:00:00Z' });
    await purchase(returned); await purchase(returned, { at: '2026-09-12T18:00:00Z' });
    await purchase(ongoingReturned, { at: '2026-11-02T18:00:00Z' });
    const out = await report();
    assert.deepEqual(out.completed, { customers: 2, returned_customers: 1, without_return_customers: 1, return_rate_pct: 50 });
    assert.deepEqual(out.ongoing, { customers: 2, returned_customers: 1 });
    assert.equal(out.cohort.customers, 4);
    assert.equal(out.cohort.days, 90);
    assert.equal(out.follow_up.days, 30);
    assert.equal(out.generated_at, now.toISOString());
    assert.equal(out.timezone, 'America/Guatemala');
    assert.equal(JSON.stringify(out).includes(returned), false, 'Aggregate response has no customer identifiers');
  });

  it('enters each customer once on the first eligible redemption within the cohort, not the first ever or each reward', async () => {
    const id = await customer();
    await redeem(id, { at: '2026-07-01T18:00:00Z' });
    await redeem(id, { at: '2026-09-10T18:00:00Z' });
    await redeem(id, { at: '2026-10-01T18:00:00Z' });
    await purchase(id, { at: '2026-10-20T18:00:00Z' });
    const out = await report();
    assert.equal(out.completed.customers, 1);
    assert.equal(out.completed.returned_customers, 0, 'A later redemption cannot restart follow-up');
  });

  it('requires a later business-local calendar day, including across UTC midnight', async () => {
    const sameDay = await customer(), nextDay = await customer();
    for (const id of [sameDay, nextDay]) await redeem(id, { at: '2026-09-10T23:00:00Z' });
    await purchase(sameDay, { at: '2026-09-11T05:59:59.999Z' });
    await purchase(nextDay, { at: '2026-09-11T06:00:00Z' });
    assert.equal((await report()).completed.returned_customers, 1);
  });

  it('uses an exact half-open 30-day follow-up and matures at its end, independent of database timezone', async () => {
    const end = await customer(), beforeEnd = await customer(), exactMaturity = await customer(), stillOngoing = await customer();
    for (const id of [end, beforeEnd]) await redeem(id);
    await purchase(end, { at: '2026-10-10T18:00:00Z' });
    await purchase(beforeEnd, { at: '2026-10-10T17:59:59.999Z' });
    await redeem(exactMaturity, { at: '2026-10-12T18:00:00Z' });
    await redeem(stillOngoing, { at: '2026-10-12T18:00:00.001Z' });
    await purchase(exactMaturity, { at: now.toISOString() });
    await db.query("SET TIME ZONE 'America/New_York'");
    const out = await report();
    assert.equal(out.completed.customers, 3);
    assert.equal(out.completed.returned_customers, 1);
    assert.equal(out.ongoing.customers, 1);
    await db.query("SET TIME ZONE 'UTC'");
  });

  it('uses saved business timezone across DST and applies local cohort boundaries', async () => {
    await db.query('UPDATE businesses SET program_json=$2 WHERE id=$1', [businessId, { region: { country: 'US', currency: 'USD', timezone: 'America/New_York' } }]);
    const inside = await customer(), outside = await customer(), sameDay = await customer();
    await redeem(inside, { at: '2026-10-13T04:00:00Z' });
    await redeem(outside, { at: '2026-10-13T03:59:59.999Z' });
    await redeem(sameDay, { at: '2026-11-01T04:30:00Z' });
    await purchase(inside, { at: '2026-10-14T04:00:00Z' });
    await purchase(sameDay, { at: '2026-11-02T04:59:59Z' });
    const out = await report({ days: 30 });
    assert.equal(out.timezone, 'America/New_York');
    assert.equal(out.cohort.start, '2026-10-13T04:00:00.000Z');
    assert.equal(out.cohort.customers, 2);
    assert.equal(out.ongoing.returned_customers, 1);
  });

  it('reuses genuine-purchase rules, including pending loyalty and zero-amount visits while excluding refunds and bonuses', async () => {
    const valid = [
      { source: 'online' }, { source: 'offline', status: 'PENDING' }, { source: 'external', amount: 0, visits: 1 },
      { source: 'order', amount: 0, items: 1 }, { type: null }
    ];
    const invalid = [
      ...['lifecycle', 'expire', 'redeem', 'reversal', 'correction', 'migration', 'unknown'].map(source => ({ source })),
      ...['ACHIEVEMENT', 'CHALLENGE', 'OPENING_BALANCE', 'MANUAL_ADJUSTMENT', 'REFERRAL_REWARD'].map(type => ({ type })),
      { status: 'REVERSED' }, { status: 'CANCELLED' }, { original: randomUUID() }, { reversed: randomUUID() },
      { amount: 0, points: 100 }, { amount: 0 }
    ];
    for (const values of [...valid, ...invalid]) { const id = await customer(); await redeem(id); await purchase(id, values); }
    const out = await report();
    assert.equal(out.completed.customers, valid.length + invalid.length);
    assert.equal(out.completed.returned_customers, valid.length);
  });

  it('retains a genuine purchase whose points later expired, while excluding reversed expired purchases', async () => {
    const valid = await customer(), refunded = await customer();
    await redeem(valid); await redeem(refunded);
    await purchase(valid, { status: 'EXPIRED' });
    await purchase(refunded, { status: 'EXPIRED', reversed: randomUUID() });
    const out = await report();
    assert.equal(out.completed.customers, 2);
    assert.equal(out.completed.returned_customers, 1);
  });

  it('excludes cancelled, restored, corrected, unrecorded POS and returned rewards before selecting cohort entry', async () => {
    for (const status of ['CANCELLED', 'PENDING', 'EXPIRED']) await redeem(await customer(), { status });
    const restored = await redeem(await customer());
    await db.query('INSERT INTO service_redemption_restorations VALUES($1,$2)', [businessId, restored]);
    for (const values of [{ reversed: randomUUID() }, { status: 'REVERSED' }]) {
      const id = await customer(), r = await redeem(id);
      await purchase(id, { source: 'redeem', meta: { redemption_id: r }, ...values });
    }
    for (const status of ['authorized', 'cancelled']) {
      const r = await redeem(await customer());
      await db.query('INSERT INTO pos_checkout_intents VALUES($1,$2,$3,NULL)', [businessId, r, status]);
    }
    const posReturned = await redeem(await customer());
    await db.query('INSERT INTO redemption_pos_records VALUES($1,$2,1)', [businessId, posReturned]);
    const validId = await customer();
    const invalidFirst = await redeem(validId, { at: '2026-08-20T18:00:00Z' });
    await db.query('INSERT INTO service_redemption_restorations VALUES($1,$2)', [businessId, invalidFirst]);
    await redeem(validId); await purchase(validId);
    const out = await report();
    assert.equal(out.cohort.customers, 1);
    assert.equal(out.completed.returned_customers, 1);
  });

  it('dates recorded checkout redemption from completion and explicitly counts legacy timestamp fallbacks', async () => {
    const pos = await customer(), legacy = await customer();
    const id = await redeem(pos, { at: '2026-09-10T18:00:00Z' });
    await db.query("INSERT INTO pos_checkout_intents VALUES($1,$2,'recorded','2026-11-01T18:00:00Z')", [businessId, id]);
    await purchase(pos, { at: '2026-09-11T18:00:00Z' });
    await redeem(legacy, { redeemed: null });
    const out = await report();
    assert.equal(out.completed.customers, 1);
    assert.equal(out.ongoing.customers, 1);
    assert.equal(out.ongoing.returned_customers, 0);
    assert.equal(out.cohort.legacy_timestamp_customers, 1);
  });

  it('applies tenant and branch scope to both entry and return, including null branches and deleted history', async () => {
    const a = await customer(), b = await customer(), unassigned = await customer(), deleted = await customer(businessId, true), outsider = await customer(otherBusiness);
    await redeem(a); await purchase(a, { branchId: branchB });
    await redeem(b, { branchId: branchB }); await purchase(b);
    await redeem(unassigned, { branchId: null }); await purchase(unassigned, { branchId: null });
    await redeem(deleted); await purchase(deleted);
    await redeem(outsider, { businessId: otherBusiness, rewardBusiness: otherBusiness, branchId: otherBranch });
    await purchase(outsider, { businessId: otherBusiness, branchId: otherBranch });
    await redeem(outsider); // Corrupt cross-tenant customer link.
    await redeem(await customer(), { rewardBusiness: otherBusiness });
    const wrongPurchase = await customer(); await redeem(wrongPurchase); await purchase(wrongPurchase, { businessId: otherBusiness });
    const all = await report();
    assert.equal(all.completed.customers, 5);
    assert.equal(all.completed.returned_customers, 4);
    const branch = await report({ branchId: branchA });
    assert.equal(branch.completed.customers, 3);
    assert.equal(branch.completed.returned_customers, 1);
    assert.deepEqual(branch.scope, { branch_id: branchA });
    await assert.rejects(report({ branchId: otherBranch }), { statusCode: 400 });
    await assert.rejects(report({ branchId: randomUUID() }), { statusCode: 400 });
  });

  it('keeps the full denominator beyond history page limits and reads aggregates in one read-only snapshot', async () => {
    for (let index = 0; index < 61; index++) { const id = await customer(); await redeem(id); if (index === 0) await purchase(id); }
    const queries = [];
    const out = await getRedemptionReturns({ businessId, now }, async (sql, params) => {
      queries.push(sql);
      assert.match(sql.trim(), /^(SELECT|WITH)\b/i);
      return db.query(sql, params);
    });
    assert.equal(out.completed.customers, 61);
    assert.equal(out.completed.returned_customers, 1);
    assert.equal(out.completed.return_rate_pct, 1.64);
    assert.equal(queries.filter(sql => sql.includes('FROM redemptions')).length, 1);
  });

  it('returns zero counts and an unavailable rate when there is no completed cohort, and validates periods', async () => {
    for (const days of [7, 30, 90]) {
      const out = await report({ days });
      assert.deepEqual(out.completed, { customers: 0, returned_customers: 0, without_return_customers: 0, return_rate_pct: null });
      assert.deepEqual(out.ongoing, { customers: 0, returned_customers: 0 });
      assert.equal(out.cohort.customers, 0);
    }
    for (const days of [0, 31, 365, '90', NaN]) await assert.rejects(report({ days }), { statusCode: 400 });
  });
});
