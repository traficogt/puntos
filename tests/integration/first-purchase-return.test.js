import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';

const url = process.env.FIRST_PURCHASE_RETURN_TEST_DB_URL;
const suite = url ? describe : describe.skip;
const businessId = randomUUID(), otherBusiness = randomUUID();
const branchA = randomUUID(), branchB = randomUUID(), otherBranch = randomUUID();
const now = new Date('2026-11-16T18:00:00.000Z');
let db, getFirstPurchaseReturns;

suite('weekly first purchase cohorts against isolated PostgreSQL', () => {
  before(async () => {
    const target = new URL(url);
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(target.pathname, '/first_purchase_return_test', 'Dedicated disposable database required');
    const service = new URL('../../src/app/services/first-purchase-return-service.js', import.meta.url);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository module URL.
    assert.ok(existsSync(service), 'First purchase return report service must exist');
    ({ getFirstPurchaseReturns } = await import(service.href));
    db = new pg.Client({ connectionString: url });
    await db.connect();
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture, temporary tables only.
    await db.query(await readFile(new URL('../fixtures/first-purchase-return.sql', import.meta.url), 'utf8'));
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    await db.query('TRUNCATE transactions, customers, branches, businesses');
    await db.query('INSERT INTO businesses(id) VALUES($1),($2)', [businessId, otherBusiness]);
    await db.query('INSERT INTO branches VALUES($1,$2),($3,$2),($4,$5)', [branchA, businessId, branchB, otherBranch, otherBusiness]);
  });
  const report = (options = {}) => getFirstPurchaseReturns({ businessId, now, weekStart: '2026-10-12', ...options }, db.query.bind(db));
  async function customer(tenant = businessId, deleted = false) {
    const id = randomUUID();
    await db.query('INSERT INTO customers VALUES($1,$2,$3)', [id, tenant, deleted ? now : null]);
    return id;
  }
  async function purchase(customerId, options = {}) {
    const t = { id: randomUUID(), businessId, branchId: branchA, amount: 10, points: 0, visits: 0, items: 0, type: 'PURCHASE', source: 'online', status: 'POSTED', original: null, reversed: null, at: '2026-10-12T18:00:00Z', occurredAt: '2026-10-12T18:00:00Z', ...options };
    await db.query(`INSERT INTO transactions(id,business_id,branch_id,customer_id,type,amount_q,points,visits,items,status,source,original_transaction_id,reversed_transaction_id,created_at,purchase_occurred_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [t.id, t.businessId, t.branchId, customerId, t.type, t.amount, t.points, t.visits, t.items, t.status, t.source, t.original, t.reversed, t.at, t.occurredAt]);
    return t.id;
  }
  const at = stamp => ({ at: stamp, occurredAt: stamp });

  it('includes every mature customer in the denominator and separates open windows even when already returned', async () => {
    const returned = await customer(), absent = await customer(), openReturned = await customer(), openAbsent = await customer();
    await purchase(returned); await purchase(absent);
    for (const id of [openReturned, openAbsent]) await purchase(id, at('2026-10-18T18:00:00Z'));
    await purchase(returned, at('2026-10-13T18:00:00Z'));
    await purchase(returned, at('2026-10-14T18:00:00Z'));
    await purchase(openReturned, at('2026-10-19T18:00:00Z'));
    const out = await report();
    assert.deepEqual(out.completed, { customers: 2, returned_customers: 1, without_return_customers: 1, return_rate_pct: 50 });
    assert.deepEqual(out.ongoing, { customers: 2, returned_customers: 1 });
    assert.equal(out.cohort.customers, 4);
    assert.equal(out.generated_at, now.toISOString());
    assert.equal(out.timezone, 'America/Guatemala');
    assert.equal(JSON.stringify(out).includes(returned), false);
  });

  it('finds the first genuine purchase in full history before selecting a week or branch', async () => {
    const old = await customer(), anotherWeek = await customer(), anotherBranch = await customer();
    for (const id of [old, anotherWeek, anotherBranch]) await purchase(id);
    await purchase(old, at('2020-01-01T18:00:00Z'));
    await purchase(anotherWeek, at('2026-10-11T18:00:00Z'));
    await purchase(anotherBranch, { branchId: branchB, ...at('2026-10-12T17:00:00Z') });
    assert.equal((await report()).cohort.customers, 1);
    assert.equal((await report({ branchId: branchA })).cohort.customers, 0);
    assert.equal((await report({ branchId: branchB })).cohort.customers, 1);
  });

  it('uses half-open local Monday bounds, including the earliest selectable week', async () => {
    for (const stamp of ['2026-10-12T05:59:59.999Z', '2026-10-12T06:00:00Z', '2026-10-19T05:59:59.999Z', '2026-10-19T06:00:00Z']) {
      await purchase(await customer(), at(stamp));
    }
    const out = await report();
    assert.equal(out.cohort.start, '2026-10-12T06:00:00.000Z');
    assert.equal(out.cohort.end, '2026-10-19T06:00:00.000Z');
    assert.equal(out.cohort.week_end, '2026-10-18');
    assert.equal(out.cohort.customers, 2);
    await purchase(await customer(), at('2025-11-24T06:00:00Z'));
    assert.equal((await report({ weekStart: '2025-11-24' })).cohort.customers, 1);
  });

  it('does not count same-local-day split receipts across UTC midnight as a return', async () => {
    const same = await customer(), later = await customer();
    for (const id of [same, later]) await purchase(id, at('2026-10-12T23:00:00Z'));
    await purchase(same, at('2026-10-13T05:59:59.999Z'));
    await purchase(later, at('2026-10-13T06:00:00Z'));
    assert.equal((await report()).completed.returned_customers, 1);
  });

  it('uses an exact 720-hour return window and matures exactly at its end regardless of database timezone', async () => {
    const boundary = await customer(), before = await customer(), mature = await customer(), open = await customer();
    await purchase(boundary); await purchase(before);
    await purchase(boundary, at('2026-11-11T18:00:00Z'));
    await purchase(before, at('2026-11-11T17:59:59.999Z'));
    await purchase(mature, at('2026-10-17T18:00:00Z'));
    await purchase(open, at('2026-10-17T18:00:00.001Z'));
    await db.query("SET TIME ZONE 'America/New_York'");
    try {
      const out = await report();
      assert.deepEqual(out.completed, { customers: 3, returned_customers: 1, without_return_customers: 2, return_rate_pct: 33.33 });
      assert.equal(out.ongoing.customers, 1);
    } finally { await db.query("SET TIME ZONE 'UTC'"); }
  });

  it('uses the merchant timezone across DST for weeks and later local days', async () => {
    await db.query('UPDATE businesses SET program_json=$2 WHERE id=$1', [businessId, { region: { country: 'US', currency: 'USD', timezone: 'America/New_York' } }]);
    const same = await customer(), later = await customer();
    for (const id of [same, later]) await purchase(id, at('2026-11-01T04:30:00Z'));
    await purchase(same, at('2026-11-02T04:59:59.999Z'));
    await purchase(later, at('2026-11-02T05:00:00Z'));
    const out = await report({ weekStart: '2026-10-26' });
    assert.equal(out.cohort.start, '2026-10-26T04:00:00.000Z');
    assert.equal(out.cohort.end, '2026-11-02T05:00:00.000Z');
    assert.equal(out.ongoing.customers, 2);
    assert.equal(out.ongoing.returned_customers, 1);
  });

  it('enforces both event time and server receipt before the snapshot for entry and return', async () => {
    const lateFirst = await customer(), lateReturn = await customer(), futureEvent = await customer();
    await purchase(lateFirst, { occurredAt: '2026-10-12T18:00:00Z', at: now.toISOString() });
    await purchase(lateReturn);
    await purchase(lateReturn, { occurredAt: '2026-10-13T18:00:00Z', at: now.toISOString() });
    await purchase(futureEvent, { occurredAt: now.toISOString(), at: '2026-11-15T18:00:00Z' });
    assert.equal((await report()).cohort.customers, 1);
    assert.equal((await report()).completed.returned_customers, 0);
    assert.equal((await report({ weekStart: '2026-11-16' })).cohort.customers, 0);
    const next = await report({ now: new Date(now.getTime() + 1) });
    assert.equal(next.cohort.customers, 2);
    assert.equal(next.completed.returned_customers, 1);
    assert.equal((await report({ weekStart: '2026-11-16', now: new Date(now.getTime() + 1) })).cohort.customers, 1);
  });

  it('reassigns a cohort when older activity arrives late and counts eligible returns received after follow-up', async () => {
    const older = await customer(), returned = await customer();
    await purchase(older); await purchase(returned);
    const receipt = '2026-11-15T18:00:00Z';
    await purchase(older, { occurredAt: '2020-01-01T18:00:00Z', at: receipt });
    await purchase(returned, { occurredAt: '2026-10-13T18:00:00Z', at: receipt });
    const early = await report({ now: new Date(receipt) });
    assert.equal(early.cohort.customers, 2);
    assert.equal(early.completed.returned_customers, 0);
    const out = await report();
    assert.equal(out.cohort.customers, 1);
    assert.equal(out.completed.returned_customers, 1);
  });

  it('excludes non-purchases and complete reversals before choosing entry and return', async () => {
    const invalid = [
      ...['lifecycle', 'expire', 'redeem', 'reversal', 'correction', 'migration', 'unknown'].map(source => ({ source })),
      ...['ACHIEVEMENT', 'CHALLENGE', 'OPENING_BALANCE', 'MANUAL_ADJUSTMENT', 'REFERRAL_REWARD'].map(type => ({ type })),
      { status: 'REVERSED' }, { status: 'CANCELLED' }, { original: randomUUID() }, { reversed: randomUUID() },
      { amount: 0, points: 100 }, { amount: 0 }
    ];
    for (const values of invalid) {
      const id = await customer();
      await purchase(id, { ...at('2020-01-01T18:00:00Z'), ...values });
      await purchase(id);
      await purchase(id, { ...at('2026-10-13T18:00:00Z'), ...values });
    }
    const out = await report();
    assert.equal(out.cohort.customers, invalid.length);
    assert.equal(out.completed.returned_customers, 0);
  });

  it('retains pending and expired points, zero-amount visits/items and legacy types as genuine purchases', async () => {
    const valid = [{ source: 'online' }, { source: 'offline', status: 'PENDING' }, { source: 'external', status: 'EXPIRED' }, { source: 'order', amount: 0, visits: 1 }, { amount: 0, items: 1 }, { type: null }];
    for (const values of valid) {
      const id = await customer();
      await purchase(id, values);
      await purchase(id, { ...at('2026-10-13T18:00:00Z'), ...values });
    }
    assert.equal((await report()).completed.returned_customers, valid.length);
  });

  it('responds to later reversals without mutating purchases or point state', async () => {
    const id = await customer();
    const first = await purchase(id);
    const second = await purchase(id, at('2026-10-13T18:00:00Z'));
    assert.equal((await report()).completed.returned_customers, 1);
    await db.query("UPDATE transactions SET reversed_transaction_id=$2, status='REVERSED' WHERE id=$1", [second, randomUUID()]);
    assert.equal((await report()).completed.returned_customers, 0);
    await db.query("UPDATE transactions SET reversed_transaction_id=$2, status='REVERSED' WHERE id=$1", [first, randomUUID()]);
    assert.equal((await report()).cohort.customers, 0);
  });

  it('falls back to server creation timestamps only when purchase time is missing and resolves ties deterministically', async () => {
    const legacy = await customer(), tied = await customer();
    await purchase(legacy, { occurredAt: null });
    await purchase(legacy, { ...at('2026-10-13T18:00:00Z'), occurredAt: null });
    await purchase(tied, { id: '00000000-0000-4000-8000-000000000001', branchId: branchA });
    await purchase(tied, { id: '00000000-0000-4000-8000-000000000002', branchId: branchB });
    assert.equal((await report()).cohort.legacy_timestamp_customers, 1);
    assert.equal((await report({ branchId: branchA })).cohort.customers, 2);
    assert.equal((await report({ branchId: branchB })).cohort.customers, 0);
  });

  it('scopes the branch only to the first business-wide purchase and retains deleted customers without PII', async () => {
    const a = await customer(), b = await customer(), unassigned = await customer(), deleted = await customer(businessId, true), outsider = await customer(otherBusiness), wrongReturn = await customer();
    await purchase(a); await purchase(a, { branchId: branchB, ...at('2026-10-13T18:00:00Z') });
    await purchase(b, { branchId: branchB }); await purchase(b, at('2026-10-13T18:00:00Z'));
    await purchase(unassigned, { branchId: null }); await purchase(unassigned, { branchId: null, ...at('2026-10-13T18:00:00Z') });
    await purchase(deleted); await purchase(deleted, at('2026-10-13T18:00:00Z'));
    await purchase(outsider, { businessId: otherBusiness, branchId: otherBranch });
    await purchase(outsider); // Deliberately corrupt cross-tenant customer link.
    await purchase(wrongReturn); await purchase(wrongReturn, { businessId: otherBusiness, ...at('2026-10-13T18:00:00Z') });
    const all = await report();
    assert.equal(all.completed.customers, 5);
    assert.equal(all.completed.returned_customers, 4);
    const branch = await report({ branchId: branchA });
    assert.equal(branch.completed.customers, 3);
    assert.equal(branch.completed.returned_customers, 2);
    assert.deepEqual(branch.scope, { branch_id: branchA, first_purchase_scope: 'business', return_scope: 'business' });
    assert.equal(JSON.stringify(branch).includes(deleted), false);
    await assert.rejects(report({ branchId: otherBranch }), { statusCode: 400 });
  });

  it('has no history page cap and runs one read-only aggregate statement without changing ledger rows', async () => {
    for (let index = 0; index < 61; index++) {
      const id = await customer(); await purchase(id);
      if (index === 0) await purchase(id, at('2026-10-13T18:00:00Z'));
    }
    const beforeRows = (await db.query('SELECT * FROM transactions ORDER BY id')).rows;
    const queries = [];
    const out = await getFirstPurchaseReturns({ businessId, now, weekStart: '2026-10-12' }, async (sql, params) => {
      queries.push(sql);
      assert.match(sql.trim(), /^(SELECT|WITH)\b/i);
      return db.query(sql, params);
    });
    assert.equal(out.completed.customers, 61);
    assert.equal(out.completed.returned_customers, 1);
    assert.equal(out.completed.return_rate_pct, 1.64);
    assert.equal(queries.filter(sql => sql.includes('FROM transactions')).length, 1);
    assert.deepEqual((await db.query('SELECT * FROM transactions ORDER BY id')).rows, beforeRows);
  });

  it('returns empty aggregates with no invented return rate or completeness', async () => {
    const out = await report();
    assert.deepEqual(out.completed, { customers: 0, returned_customers: 0, without_return_customers: 0, return_rate_pct: null });
    assert.deepEqual(out.ongoing, { customers: 0, returned_customers: 0 });
    assert.equal(out.cohort.customers, 0);
    assert.equal(out.data_readiness.state, 'recorded_only');
  });
});
