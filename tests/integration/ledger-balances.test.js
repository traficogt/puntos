import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';

// Every fixture is fictional and lives in a disposable, isolated database.
const url = process.env.LEDGER_BALANCES_TEST_DB_URL;
const suite = url ? describe : describe.skip;
let db, app, ops, recon, corrections, awards, staffService, tiers, defaultTiers, giftCards, customerRoutes, repos;

const tenant = (businessId, fn) => app.withDbClientContext({ tenantId: businessId, platformAdmin: false }, fn);
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0];
const balance = customerId => one('SELECT points, pending_points, lifetime_points FROM customer_balances WHERE customer_id=$1', [customerId]);

async function business(program = {}) {
  const id = randomUUID(), owner = randomUUID(), slug = `ledger-${id}`;
  const programJson = { points_per_visit: 100, external_awards: { enabled: true, api_key: 'fixture-only' }, ...program };
  await db.query(`INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_type,program_json)
    VALUES($1,'Negocio ficticio',$2,$3,'fixture-only','EMPRESA','VISIT',$4)`, [id, slug, `${id}@example.invalid`, programJson]);
  await db.query("INSERT INTO staff_users(id,business_id,name,role,password_hash) VALUES($1,$2,'Dueña ficticia','OWNER','fixture-only')", [owner, id]);
  return { id, slug, staff: { id: owner, business_id: id, role: 'OWNER', branch_id: null } };
}

async function customer(b) {
  const id = randomUUID();
  await db.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,$3,'Cliente ficticio')",
    [id, b.id, `5025${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`]);
  await db.query('INSERT INTO customer_balances(customer_id) VALUES($1)', [id]);
  return id;
}

async function earn(b, customerId, visits = 1) {
  const out = await tenant(b.id, () => awards.awardFromExternalEventTrusted({
    businessSlug: b.slug, customerId, externalEventId: `fixture-${randomUUID()}`, amount_q: 0, visits
  }));
  return out.transactionId;
}

async function rewardFor(b, cost) {
  const id = randomUUID();
  await db.query("INSERT INTO rewards(id,business_id,name,points_cost) VALUES($1,$2,'Premio ficticio',$3)", [id, b.id, cost]);
  return id;
}

async function redeem(b, customerId, rewardId) {
  const out = await tenant(b.id, () => staffService.redeemReward({ staff: b.staff, customerId, rewardId, requestId: randomUUID() }));
  return (await one("SELECT id FROM transactions WHERE source='redeem' AND meta->>'redemption_id'=$1", [out.redemptionId])).id;
}

const refund = (b, transactionId) => tenant(b.id, () => ops.refundAwardTransaction({
  staff: b.staff, transactionId, requestId: randomUUID(), reason: 'Devolución ficticia'
}));

const expire = (b, customerId) => tenant(b.id, () => ops.expirePointsForCustomer(customerId, b.id));

async function setProgram(b, values) {
  await db.query('UPDATE businesses SET program_json = program_json || $2::jsonb WHERE id=$1', [b.id, JSON.stringify(values)]);
}

// Receipt time is immutable for application roles. The fixture superuser
// moves history into the past to model elapsed time.
async function backdate(transactionId, days) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query("UPDATE transactions SET created_at = now() - make_interval(days => $2) WHERE id = $1", [transactionId, days]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function findings(b, customerId) {
  const report = await tenant(b.id, () => recon.runLedgerReconciliation({ businessId: b.id, customerId, persist: false }));
  assert.equal(report.checkedCustomers, 1);
  return report.findings;
}

async function assertReconciled(b, customerId) {
  assert.deepEqual(await findings(b, customerId), []);
  await assert.rejects(tenant(b.id, () => corrections.requestLedgerCorrection({
    businessId: b.id, customerId, requestedByStaffId: b.staff.id, reason: 'Revisión ficticia del saldo'
  })), { statusCode: 409, message: 'Customer balance already matches the ledger' });
}

async function until(check, description) {
  const deadline = Date.now() + 8000;
  do {
    if (await check()) return;
    await delay(20);
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for ${description}`);
}

suite('ledger balances, expiry and tiers against isolated PostgreSQL', { concurrency: false }, () => {
  before(async () => {
    const target = new URL(url);
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(target.pathname, '/ledger_balances_test', 'Dedicated disposable database required');
    assert.equal(process.env.NODE_ENV, 'test');
    assert.equal(process.env.DB_NAME, 'ledger_balances_test');
    db = new pg.Pool({ connectionString: url, max: 6 });
    [app, ops, recon, corrections, awards, staffService, { TierService: tiers, DEFAULT_TIERS: defaultTiers }, giftCards, { analyticsCustomerRoutes: customerRoutes }, repos] = await Promise.all([
      import('../../src/app/database.js'), import('../../src/app/services/loyalty-ops-service.js'),
      import('../../src/app/services/ledger-reconciliation-service.js'), import('../../src/app/services/ledger-correction-service.js'),
      import('../../src/app/services/external-award-service.js'), import('../../src/app/services/staff-service.js'),
      import('../../src/app/services/tier-service.js'), import('../../src/app/services/gift-card-service.js'),
      import('../../src/app/routes/analytics/customer-360.js'),
      Promise.all([import('../../src/app/repositories/business-repository.js'), import('../../src/app/repositories/reward-repository.js')])
    ]);
  });
  after(async () => { await app?.closeDatabase(); await db?.end(); });

  it('earn -> refund reconciles: the reversal row alone carries the refund', async () => {
    const b = await business(), c = await customer(b);
    const award = await earn(b, c, 2);
    await earn(b, c, 1);
    await refund(b, award);
    assert.deepEqual(await balance(c), { points: 100, pending_points: 0, lifetime_points: 100 });
    await assertReconciled(b, c);

    // The customer ledger view uses the same expectation.
    const layer = customerRoutes.stack.find(entry => entry.route?.path === '/admin/analytics/customer/:id/ledger');
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    let routeError;
    await tenant(b.id, () => layer.route.stack[0].handle({ params: { id: c }, tenantId: b.id }, res, error => { routeError = error; }));
    assert.equal(routeError, undefined);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.balances.mismatch, false);
    assert.equal(res.body.balances.expected.points, 100);
  });

  it('earn -> expire reconciles: the expired original keeps its effect and the expire row deducts', async () => {
    const b = await business(), c = await customer(b);
    const award = await earn(b, c);
    await backdate(award, 100);
    await setProgram(b, { points_expiration_days: 90 });
    const out = await expire(b, c);
    assert.deepEqual(out, { expiredCount: 1, expiredPoints: 100, deductedPoints: 100 });
    assert.deepEqual(await balance(c), { points: 0, pending_points: 0, lifetime_points: 100 });
    assert.equal((await one('SELECT status FROM transactions WHERE id=$1', [award])).status, 'EXPIRED');
    await assertReconciled(b, c);
    assert.deepEqual(await expire(b, c), { expiredCount: 0, expiredPoints: 0, deductedPoints: 0 });
  });

  it('redeem -> return reconciles without counting the restored points twice or as earned', async () => {
    const b = await business(), c = await customer(b);
    await earn(b, c);
    const debit = await redeem(b, c, await rewardFor(b, 40));
    assert.deepEqual(await balance(c), { points: 60, pending_points: 0, lifetime_points: 100 });
    await assertReconciled(b, c);
    await refund(b, debit);
    assert.deepEqual(await balance(c), { points: 100, pending_points: 0, lifetime_points: 100 });
    await assertReconciled(b, c);
  });

  it('pending -> settle reconciles and settled points become lifetime points', async () => {
    const b = await business({ pending_points_hold_days: 1 }), c = await customer(b);
    const held = await earn(b, c);
    assert.deepEqual(await balance(c), { points: 0, pending_points: 100, lifetime_points: 0 });
    await assertReconciled(b, c);
    await db.query("UPDATE transactions SET available_at = now() - interval '1 minute' WHERE id=$1", [held]);
    const out = await tenant(b.id, () => ops.settlePendingPointsForCustomer(c, b.id));
    assert.equal(out.settledCount, 1);
    assert.deepEqual(await balance(c), { points: 100, pending_points: 0, lifetime_points: 100 });
    await assertReconciled(b, c);

    const refunded = await earn(b, c);
    await refund(b, refunded);
    assert.deepEqual(await balance(c), { points: 100, pending_points: 0, lifetime_points: 100 });
    await assertReconciled(b, c);
  });

  it('expires only old points that later debits did not already consume (FIFO)', async () => {
    const b = await business(), c = await customer(b);
    const day0 = await earn(b, c);
    const day10 = await redeem(b, c, await rewardFor(b, 100));
    const day85 = await earn(b, c);
    await backdate(day0, 91);
    await backdate(day10, 81);
    await backdate(day85, 6);
    await setProgram(b, { points_expiration_days: 90 });

    const out = await expire(b, c);
    assert.deepEqual(out, { expiredCount: 1, expiredPoints: 100, deductedPoints: 0 });
    assert.deepEqual(await balance(c), { points: 100, pending_points: 0, lifetime_points: 200 });
    assert.equal((await one('SELECT status FROM transactions WHERE id=$1', [day85])).status, 'POSTED');
    await assertReconciled(b, c);

    // Partially consumed: 30 of the old 100 were spent; the recent 100 are protected.
    const other = await customer(b);
    const old = await earn(b, other);
    const spent = await redeem(b, other, await rewardFor(b, 30));
    const recentAward = await earn(b, other);
    await backdate(old, 95);
    await backdate(spent, 60);
    await backdate(recentAward, 3);
    assert.deepEqual(await expire(b, other), { expiredCount: 1, expiredPoints: 100, deductedPoints: 70 });
    assert.deepEqual(await balance(other), { points: 100, pending_points: 0, lifetime_points: 200 });
    await assertReconciled(b, other);
  });

  it('a staff refund cannot deduct an expired award again', async () => {
    const b = await business(), c = await customer(b);
    const award = await earn(b, c);
    await backdate(award, 100);
    await setProgram(b, { points_expiration_days: 90 });
    await expire(b, c);
    await earn(b, c, 2);
    assert.deepEqual(await balance(c), { points: 200, pending_points: 0, lifetime_points: 300 });
    await assert.rejects(refund(b, award), { statusCode: 409, message: /vencieron/ });
    assert.deepEqual(await balance(c), { points: 200, pending_points: 0, lifetime_points: 300 });
    await assertReconciled(b, c);
  });

  it('runs held staff-award hooks once, after settlement commits', async () => {
    const b = await business({ pending_points_hold_days: 3 }), c = await customer(b);
    const challenge = (await one(`INSERT INTO challenges(business_id,name,challenge_type,requirement_type,requirement_value,reward_points,start_date)
      VALUES($1,'Reto ficticio','personal','points',1000,10,now() - interval '1 day') RETURNING id`, [b.id])).id;
    const held = async () => {
      const id = randomUUID();
      await db.query(`INSERT INTO transactions(id,business_id,customer_id,staff_user_id,amount_q,visits,items,points,status,available_at,source)
        VALUES($1,$2,$3,$4,0,1,0,100,'PENDING',now() - interval '1 minute','online')`, [id, b.id, c, b.staff.id]);
      await db.query('UPDATE customer_balances SET pending_points = pending_points + 100 WHERE customer_id=$1', [c]);
      return id;
    };
    const progress = async () => Number((await one('SELECT progress FROM customer_challenges WHERE customer_id=$1 AND challenge_id=$2', [c, challenge]))?.progress ?? 0);

    await held();
    await tenant(b.id, () => ops.settlePendingPointsForCustomer(c, b.id));
    assert.equal(await progress(), 100);
    await tenant(b.id, () => ops.settlePendingPointsForCustomer(c, b.id));
    assert.equal(await progress(), 100, 'A settled row never runs its hooks twice');

    // Settlement joined to a caller transaction waits for that commit.
    await held();
    await assert.rejects(tenant(b.id, () => app.withTransaction(async client => {
      await ops.settlePendingPointsForCustomer(c, b.id, fn => fn(client));
      throw new Error('fixture rollback');
    })), /fixture rollback/);
    assert.equal(await progress(), 100);
    assert.equal((await balance(c)).pending_points, 100);
    await tenant(b.id, () => app.withTransaction(client => ops.settlePendingPointsForCustomer(c, b.id, fn => fn(client))));
    assert.equal(await progress(), 200);
    assert.deepEqual(await balance(c), { points: 200, pending_points: 0, lifetime_points: 200 });
    await assertReconciled(b, c);
  });

  it('creates Spanish default tiers and upgrades from earned points, not the spendable balance', async () => {
    const b = await business(), c = await customer(b);
    const created = await tenant(b.id, () => tiers.createDefaultTiers(b.id));
    assert.deepEqual(created.map(t => t.name), ['Bronce', 'Plata', 'Oro']);
    const [bronce] = created;

    // No tier assignment yet: progress must still point at the next tier.
    await db.query('DELETE FROM customer_tiers WHERE customer_id=$1', [c]);
    let info = await tenant(b.id, () => tiers.getCustomerTierInfo(c));
    assert.equal(info.name, 'Bronce');
    assert.equal(info.next_tier_name, 'Plata');
    assert.equal(info.points_to_next_tier, 500);

    await earn(b, c, 6);
    await redeem(b, c, await rewardFor(b, 500));
    // A stale assignment (imports, bonuses or integrations) is evaluated on read.
    await db.query('UPDATE customer_tiers SET tier_id=$2 WHERE customer_id=$1', [c, bronce.id]);
    info = await tenant(b.id, () => tiers.getCustomerTierInfo(c));
    assert.equal(info.name, 'Plata');
    assert.equal(info.current_points, 600);
    assert.equal(info.available_points, 100);
    assert.equal(info.next_tier_name, 'Oro');
    assert.equal(info.points_to_next_tier, 1400);
    assert.ok(info.points_to_next_tier >= 0);

    // Spending never lowers the earned measure that tiers use.
    await redeem(b, c, await rewardFor(b, 100));
    assert.equal((await tenant(b.id, () => tiers.checkTierProgression(c))).upgraded, false);
    info = await tenant(b.id, () => tiers.getCustomerTierInfo(c));
    assert.equal(info.name, 'Plata');
    assert.equal(info.available_points, 0);
  });

  it('rewrites only untouched English default tiers, keeping their ids and assignments', async () => {
    // The English defaults as businesses created before the Spanish ones stored them.
    const english = [
      { name: 'Bronze', tier_level: 1, min_points: 0, points_multiplier: 1, perks: ['Earn points on purchases', 'Redeem rewards'], color: '#CD7F32' },
      { name: 'Silver', tier_level: 2, min_points: 500, points_multiplier: 1.25, perks: ['25% bonus points', 'Early access to new rewards', 'Birthday bonus'], color: '#C0C0C0' },
      { name: 'Gold', tier_level: 3, min_points: 2000, points_multiplier: 1.5, perks: ['50% bonus points', 'Exclusive rewards', 'Priority support', 'Free delivery'], color: '#FFD700' }
    ];
    const seeded = async (tierList) => {
      const b = await business();
      for (const t of tierList) {
        await db.query(`INSERT INTO loyalty_tiers(business_id,name,tier_level,min_points,points_multiplier,perks,color)
          VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`, [b.id, t.name, t.tier_level, t.min_points, t.points_multiplier, JSON.stringify(t.perks), t.color]);
      }
      return b;
    };
    const rows = async b => (await db.query(`SELECT id, name, tier_level, min_points, points_multiplier, perks, color,
      min_spend, min_visits, icon_url, active, updated_at FROM loyalty_tiers WHERE business_id=$1 ORDER BY tier_level`, [b.id])).rows;
    const edit = (level, change) => english.map(t => t.tier_level === level ? { ...t, ...change } : t);

    const untouched = await seeded(english);
    const c = await customer(untouched);
    const before = await rows(untouched);
    await db.query(`INSERT INTO customer_tiers(customer_id, tier_id) VALUES($1,$2)
      ON CONFLICT (customer_id) DO UPDATE SET tier_id = EXCLUDED.tier_id`, [c, before[1].id]);
    const kept = [
      await seeded(edit(2, { min_points: 400 })),
      await seeded(edit(3, { perks: ['Exclusive rewards', 'Priority support', 'Free delivery'] })),
      await seeded([...english, { name: 'Platinum', tier_level: 4, min_points: 5000, points_multiplier: 2, perks: ['100% bonus points'], color: '#E5E4E2' }])
    ];
    const spanish = await business();
    await tenant(spanish.id, () => tiers.createDefaultTiers(spanish.id));
    kept.push(spanish);
    const keptBefore = await Promise.all(kept.map(rows));

    // Fixed repository migration path; no request input is used.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const migration = await fs.readFile(new URL('../../src/app/migrations/2026-11-17-ledger-default-tier-text.sql', import.meta.url), 'utf8');
    await db.query(migration);
    await db.query(migration);

    const after = await rows(untouched);
    assert.deepEqual(after.map(t => t.name), defaultTiers.map(t => t.name));
    assert.deepEqual(after.map(t => t.perks), defaultTiers.map(t => t.perks));
    assert.ok(!JSON.stringify(after).includes('bonus points'));
    // Only the text changes: same rows, thresholds, multipliers and colors.
    const settings = t => ({ id: t.id, tier_level: t.tier_level, min_points: t.min_points, points_multiplier: t.points_multiplier, color: t.color, active: t.active });
    assert.deepEqual(after.map(settings), before.map(settings));
    const assigned = await one('SELECT lt.name FROM customer_tiers ct JOIN loyalty_tiers lt ON lt.id = ct.tier_id WHERE ct.customer_id = $1', [c]);
    assert.equal(assigned.name, 'Plata');

    // Any owner change, an extra tier, or tiers already in Spanish: left exactly as they were.
    assert.deepEqual(await Promise.all(kept.map(rows)), keptBefore);
  });

  it('rolling-window tiers use earned points inside the window for upgrades and the sweep', async () => {
    const policy = { mode: 'rolling_days', rolling_days: 30 };
    const b = await business({ tier_policy: policy }), c = await customer(b);
    await tenant(b.id, () => tiers.createDefaultTiers(b.id));
    const old = await earn(b, c, 6);
    await backdate(old, 60);
    let info = await tenant(b.id, () => tiers.getCustomerTierInfo(c));
    assert.equal(info.name, 'Bronce');
    assert.equal(info.tier_points_mode, 'rolling_days');
    assert.equal(info.current_points, 0);
    assert.equal(info.available_points, 600);
    assert.equal(info.points_to_next_tier, 500);

    await earn(b, c, 5);
    await redeem(b, c, await rewardFor(b, 1000));
    info = await tenant(b.id, () => tiers.getCustomerTierInfo(c));
    assert.equal(info.name, 'Plata');
    assert.equal(info.current_points, 500);
    assert.equal(info.points_to_next_tier, 1500);
    const sweep = await tenant(b.id, () => tiers.runTierRetentionSweep(b.id, policy));
    assert.equal(sweep.downgrades, 0);
    assert.equal((await one('SELECT lt.name FROM customer_tiers ct JOIN loyalty_tiers lt ON lt.id=ct.tier_id WHERE ct.customer_id=$1', [c])).name, 'Plata');
  });

  // Unserialized, both redemptions passed the count: with a deferred visit both
  // were recorded; otherwise their customer locks deadlocked one of them.
  for (const deferVisit of [false, true]) {
    it(`serializes one customer's redemptions before applying the daily limit (deferVisit=${deferVisit})`, async () => {
      const b = await business({ redemption_guard: { max_redemptions_per_day: 1 } }), c = await customer(b);
      await earn(b, c, 2);
      const [first, second] = [await rewardFor(b, 50), await rewardFor(b, 50)];
      const [{ BusinessRepo }, { RewardRepo }] = repos;
      // Without the reward-promise lock, so the redemption path itself must serialize.
      const deps = { BusinessRepo, RewardRepo, withTransaction: app.withTransaction, deferVisit,
        settlePendingPointsForCustomer: async () => {}, expirePointsForCustomer: async () => {}, enqueueWebhookEvent: async () => {} };
      const gate = await db.connect();
      let attempts;
      try {
        await gate.query('BEGIN');
        await gate.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [c]);
        attempts = [first, second].map(rewardId => tenant(b.id, () => staffService.redeemRewardWithDeps(deps, {
          staff: b.staff, customerId: c, rewardId, requestId: randomUUID()
        })));
        await until(async () => (await one(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`)).n >= 2, 'both redemptions to wait');
        await gate.query('COMMIT');
      } finally { gate.release(); }
      const results = await Promise.allSettled(attempts);
      const rejected = results.filter(result => result.status === 'rejected').map(result => result.reason);
      assert.equal(rejected.length, 1, JSON.stringify(rejected.map(error => error?.message)));
      assert.equal(rejected[0].statusCode, 409);
      assert.match(rejected[0].message, /Daily redemption limit/);
      assert.equal((await balance(c)).points, 150);
      assert.equal((await one("SELECT count(*)::int AS n FROM redemptions WHERE customer_id=$1 AND status <> 'CANCELLED'", [c])).n, 1);
    });
  }

  it('checks a gift card ledger over its entire history', async () => {
    const b = await business(), card = randomUUID();
    await db.query(`INSERT INTO gift_cards(id,business_id,code,qr_token,initial_amount_q,balance_q,status,created_by)
      VALUES($1,$2,$3,$4,150,49,'ACTIVE',$5)`, [card, b.id, `GC-${card.slice(0, 8)}`, `gft_${card}`, b.staff.id]);
    await db.query(`INSERT INTO gift_card_transactions(id,gift_card_id,business_id,tx_type,amount_q,balance_after_q,created_at)
      VALUES($1,$2,$3,'ISSUE',150,150,now() - interval '1 day')`, [randomUUID(), card, b.id]);
    for (let i = 0; i < 101; i++) {
      await db.query(`INSERT INTO gift_card_transactions(id,gift_card_id,business_id,tx_type,amount_q,balance_after_q,created_at)
        VALUES($1,$2,$3,'REDEEM',1,$4,now() - make_interval(secs => $5))`, [randomUUID(), card, b.id, 149 - i, 1000 - i]);
    }
    const details = await tenant(b.id, () => giftCards.giftCardLedgerDetails({ staff: b.staff, code_or_token: `GC-${card.slice(0, 8)}` }));
    assert.equal(details.transactions.length, 100);
    assert.equal(details.ledger.issue_total_q, 150);
    assert.equal(details.ledger.redeem_total_q, 101);
    assert.equal(details.ledger.mismatch, false);
  });
});
