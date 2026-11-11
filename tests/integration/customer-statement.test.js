import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, after, describe, it } from 'node:test';
import pg from 'pg';

const url = process.env.CUSTOMER_STATEMENT_TEST_DB_URL;
const suite = url ? describe : describe.skip;
const businessId = randomUUID(), customerId = randomUUID(), otherBusiness = randomUUID(), otherCustomer = randomUUID();
const now = '2026-11-11T12:00:00.000Z', recent = '2026-11-10T12:00:00.000Z';
let pool, getCustomerStatement;
const read = () => getCustomerStatement(pool, { businessId, customerId, now });
async function txn(points, source = 'online', extra = {}) {
  const id = randomUUID();
  await pool.query(`INSERT INTO transactions(id,business_id,customer_id,points,source,status,type,meta,created_at,original_transaction_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [id, extra.businessId || businessId, extra.customerId || customerId, points, source, extra.status || 'POSTED', extra.type || 'PURCHASE', extra.meta || {}, extra.at || recent, extra.original || null]);
  return id;
}
suite('customer statement: complete, scoped ledger summary', () => {
  before(async () => {
    const parsed = new URL(url);
    assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname));
    assert.equal(parsed.pathname, '/customer_statement_test');
    pool = new pg.Pool({ connectionString: url });
    await pool.query(`CREATE TABLE IF NOT EXISTS customers(id uuid PRIMARY KEY,business_id uuid,deleted_at timestamptz);
      CREATE TABLE IF NOT EXISTS customer_balances(customer_id uuid PRIMARY KEY,points integer,pending_points integer);
      CREATE TABLE IF NOT EXISTS transactions(id uuid PRIMARY KEY,business_id uuid,customer_id uuid,points integer,source text,status text,type text,meta jsonb,created_at timestamptz,original_transaction_id uuid,reversed_transaction_id uuid);
      CREATE TABLE IF NOT EXISTS ledger_balance_adjustments(id uuid PRIMARY KEY,business_id uuid,customer_id uuid,delta_points integer,created_at timestamptz);
      CREATE TABLE IF NOT EXISTS redemptions(id uuid PRIMARY KEY,business_id uuid,customer_id uuid,status text,redeemed_at timestamptz,created_at timestamptz);
      CREATE TABLE IF NOT EXISTS service_redemption_restorations(redemption_id uuid,business_id uuid);
      CREATE TABLE IF NOT EXISTS pos_checkout_intents(redemption_id uuid,business_id uuid,status text,recorded_at timestamptz);
      ALTER TABLE pos_checkout_intents ADD COLUMN IF NOT EXISTS recorded_at timestamptz;
      CREATE TABLE IF NOT EXISTS redemption_pos_records(redemption_id uuid,business_id uuid,returned_quantity numeric);`);
    ({ getCustomerStatement } = await import('../../src/app/services/customer-statement-service.js'));
  });
  after(async () => pool?.end());
  beforeEach(async () => {
    await pool.query('TRUNCATE customers,customer_balances,transactions,ledger_balance_adjustments,redemptions,service_redemption_restorations,pos_checkout_intents,redemption_pos_records');
    await pool.query('INSERT INTO customers VALUES($1,$2,NULL),($3,$4,NULL)', [customerId, businessId, otherCustomer, otherBusiness]);
    await pool.query('INSERT INTO customer_balances VALUES($1,42,7)', [customerId]);
  });
  it('sums more than the history limit, separates expiry and never infers cash value', async () => {
    for (let i = 0; i < 60; i++) await txn(2);
    await txn(20, 'online', { status: 'EXPIRED' });
    await txn(-9, 'expire');
    await txn(-30, 'redeem');
    await txn(7, 'online', { status: 'PENDING' });
    await txn(999, 'online', { businessId: otherBusiness, customerId: otherCustomer });
    const statement = await read();
    assert.deepEqual(statement.points, { earned: 140, redeemed: 30, expired: 9, adjustments: 0 });
    assert.deepEqual(statement.balance, { available: 42, pending: 7 });
    assert.equal(statement.period.days, 30);
    assert.equal(statement.period.start, '2026-10-12T12:00:00.000Z');
    assert.equal(statement.as_of, now);
    assert.equal('cash_value' in statement, false);
    assert.equal('merchant_cost' in statement, false);
  });
  it('shows posted refunds as signed corrections without losing original earnings, excludes pending refunds', async () => {
    const posted = await txn(40, 'online', { status: 'REVERSED' });
    await txn(-40, 'reversal', { original: posted, meta: { original_status: 'POSTED' } });
    const pending = await txn(70, 'online', { status: 'REVERSED' });
    await txn(0, 'reversal', { original: pending, meta: { original_status: 'PENDING' } });
    await txn(50, 'migration', { type: 'OPENING_BALANCE' });
    await pool.query('INSERT INTO ledger_balance_adjustments VALUES($1,$2,$3,15,$4)', [randomUUID(), businessId, customerId, recent]);
    assert.deepEqual((await read()).points, { earned: 40, redeemed: 0, expired: 0, adjustments: 25 });
  });
  it('never treats a cancelled pending order without a reversal row as earned points', async () => {
    await txn(500, 'order', { status: 'REVERSED' });
    const legacy = await txn(30, 'online', { status: 'REVERSED' });
    await txn(-30, 'reversal', { original: legacy });
    assert.deepEqual((await read()).points, { earned: 30, redeemed: 0, expired: 0, adjustments: -30 });
  });
  it('uses a half-open time interval and returns null for a mismatched or deleted customer', async () => {
    await txn(1, 'online', { at: '2026-10-12T12:00:00Z' });
    await txn(20, 'online', { at: '2026-10-12T11:59:59Z' });
    await txn(30, 'online', { at: now });
    assert.equal((await read()).points.earned, 1);
    assert.equal(await getCustomerStatement(pool, { businessId: otherBusiness, customerId, now }), null);
    await pool.query('UPDATE customers SET deleted_at=now() WHERE id=$1', [customerId]);
    assert.equal(await read(), null);
  });
  it('counts only recorded completed rewards, excluding restored, reversed and unconfirmed POS redemptions', async () => {
    const ids = Array.from({ length: 7 }, () => randomUUID());
    for (const id of ids) await pool.query("INSERT INTO redemptions VALUES($1,$2,$3,'REDEEMED',$4,$4)", [id, businessId, customerId, recent]);
    await pool.query('INSERT INTO service_redemption_restorations VALUES($1,$2)', [ids[1], businessId]);
    await txn(-20, 'redeem', { status: 'REVERSED', meta: { redemption_id: ids[2] } });
    await pool.query("INSERT INTO pos_checkout_intents VALUES($1,$4,'authorized',NULL),($2,$4,'cancelled',NULL),($3,$4,'recorded',$5)", [ids[3], ids[4], ids[5], businessId, recent]);
    await pool.query("UPDATE redemptions SET status='CANCELLED' WHERE id=$1", [ids[6]]);
    assert.equal((await read()).rewards.completed, 2);
    await pool.query('INSERT INTO redemption_pos_records VALUES($1,$2,1)', [ids[0], businessId]);
    assert.equal((await read()).rewards.completed, 1);
    await pool.query('UPDATE pos_checkout_intents SET recorded_at=$2 WHERE redemption_id=$1', [ids[5], now]);
    assert.equal((await read()).rewards.completed, 0);
  });
});
