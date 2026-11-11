import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, before, after, beforeEach, it } from 'node:test';
import pg from 'pg';
const url = process.env.OWNER_OUTCOME_TEST_DB_URL, suite = url ? describe : describe.skip;
const businessId = randomUUID(), other = randomUUID(), now = new Date('2026-11-11T18:00:00Z');
const business = { id: businessId, program_json: {} }; let db, read;
suite('owner outcome evidence in disposable PostgreSQL', () => {
  before(async () => {
    const u = new URL(url); assert.equal(u.hostname, '127.0.0.1'); assert.equal(u.pathname, '/owner_outcome_test');
    db = new pg.Client({ connectionString: url }); await db.connect();
    // Fixed repository fixture, only used against the explicitly named disposable database.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await db.query(await readFile(new URL('../fixtures/redemption-return.sql', import.meta.url), 'utf8'));
    await db.query(`ALTER TABLE rewards ADD COLUMN active boolean DEFAULT true,ADD COLUMN valid_until timestamptz;
      CREATE TEMP TABLE reward_unit_costs(business_id uuid,reward_id uuid,unit_cost_q numeric,PRIMARY KEY(business_id,reward_id));
      CREATE TEMP TABLE hospitality_entitlements(id uuid PRIMARY KEY,business_id uuid,expires_at timestamptz,unit_cost_limit numeric);
      CREATE TEMP TABLE reward_entitlement_fulfillments(id uuid PRIMARY KEY,business_id uuid,hospitality_id uuid UNIQUE);`);
    ({ getOwnerOutcomeEvidence: read } = await import('../../src/app/services/owner-outcome-service.js'));
  });
  after(async () => db?.end());
  beforeEach(async () => {
    await db.query('TRUNCATE businesses,rewards,reward_unit_costs,hospitality_entitlements,reward_entitlement_fulfillments');
    await db.query('INSERT INTO businesses(id) VALUES($1),($2)', [businessId, other]);
  });
  it('reads every matured courtesy, excluding future/outside window and other tenants', async () => {
    for (let i = 0; i < 105; i++) {
      const id = randomUUID(); await db.query('INSERT INTO hospitality_entitlements VALUES($1,$2,$3,5)', [id, businessId, '2026-11-10T18:00:00Z']);
      if (i < 5) await db.query('INSERT INTO reward_entitlement_fulfillments VALUES($1,$2,$3)', [randomUUID(), businessId, id]);
    }
    for (const [bid, expiry] of [[other, '2026-11-10T18:00:00Z'], [businessId, '2026-11-11T18:00:00Z'], [businessId, '2026-10-12T17:59:59Z']]) await db.query('INSERT INTO hospitality_entitlements VALUES($1,$2,$3,999)', [randomUUID(), bid, expiry]);
    const out = await read({ businessId, business, now, includeReturns: false }, db.query.bind(db));
    assert.deepEqual(out.hospitality, { total: 105, fulfilled: 5, expired_unused: 100, reserved_unused: 500 }); assert.equal(out.returns, null);
  });
  it('missing cost is distinct from known zero and ignores inactive, expired and foreign rewards', async () => {
    const ids = Array.from({ length: 5 }, () => randomUUID());
    await db.query("INSERT INTO rewards VALUES($1,$6,true,NULL),($2,$6,true,NULL),($3,$6,false,NULL),($4,$6,true,'2026-11-01'),($5,$7,true,NULL)", [...ids, businessId, other]);
    await db.query('INSERT INTO reward_unit_costs VALUES($1,$2,0)', [businessId, ids[1]]);
    assert.deepEqual((await read({ businessId, business, now, includeReturns: false }, db.query.bind(db))).costs, { active: 2, missing: 1 });
  });
  it('reuses the exact return report and rejects a mismatched business context', async () => {
    const out = await read({ businessId, business, now }, db.query.bind(db));
    assert.equal(out.returns.cohort.customers, 0); assert.equal(out.returns.follow_up.days, 30);
    await assert.rejects(read({ businessId: other, business, now }, db.query.bind(db)), { statusCode: 403 });
  });
});
