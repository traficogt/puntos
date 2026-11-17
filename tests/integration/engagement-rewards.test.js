import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';

// Fictional fixtures only. Run through the isolated domain runner:
//   npm run test:integration:domains -- engagement-rewards
const url = process.env.ENGAGEMENT_REWARDS_TEST_DB_URL;
const suite = url ? describe : describe.skip;
let db, app, achievements, challenges, referrals, refunds, derived, recon;
let phoneSequence = 0;

const tenant = (businessId, fn) => app.withDbClientContext({ tenantId: businessId, platformAdmin: false }, fn);
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0];
const count = async (sql, values = []) => Number((await one(sql, values)).n);

async function business({ plan = 'EMPRESA', program = {} } = {}) {
  const id = randomUUID(), staffId = randomUUID();
  await db.query(`INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_type,program_json)
    VALUES($1,'Fictional engagement fixture',$2,$3,'fixture-only',$4,'SPEND',$5)`,
  [id, `engagement-${id}`, `${id}@example.invalid`, plan, program]);
  await db.query("INSERT INTO staff_users(id,business_id,name,role,password_hash) VALUES($1,$2,'Fictional owner','OWNER','fixture-only')", [staffId, id]);
  return { id, staff: { id: staffId, business_id: id, role: 'OWNER' } };
}

async function customer(b) {
  const id = randomUUID();
  phoneSequence += 1;
  await db.query("INSERT INTO customers(id,business_id,phone,name) VALUES($1,$2,$3,'Fictional customer')",
    [id, b.id, `5025${String(1000000 + phoneSequence).slice(-7)}`]);
  await db.query('INSERT INTO customer_balances(customer_id) VALUES($1) ON CONFLICT DO NOTHING', [id]);
  return id;
}

async function refresh(customerId) {
  const client = await db.connect();
  try { await derived.refreshCustomerDerivedState(client, customerId); } finally { client.release(); }
}

// A recorded staff purchase, as staff-award-service writes it.
async function purchase(b, customerId, { amount = 0, visits = 1, points = 0, at = null } = {}) {
  const id = randomUUID();
  await db.query(`INSERT INTO transactions(id,business_id,customer_id,staff_user_id,amount_q,visits,items,points,status,source,created_at)
    VALUES($1,$2,$3,$4,$5,$6,0,$7,'POSTED','online',COALESCE($8::timestamptz,now()))`,
  [id, b.id, customerId, b.staff.id, amount, visits, points, at]);
  await db.query('UPDATE customer_balances SET points=points+$2,lifetime_points=lifetime_points+$2 WHERE customer_id=$1', [customerId, points]);
  await refresh(customerId);
  return id;
}

async function redeem(b, customerId, points) {
  await db.query(`INSERT INTO transactions(id,business_id,customer_id,staff_user_id,points,status,source)
    VALUES($1,$2,$3,$4,$5,'POSTED','redeem')`, [randomUUID(), b.id, customerId, b.staff.id, -points]);
  await db.query('UPDATE customer_balances SET points=points-$2 WHERE customer_id=$1', [customerId, points]);
}

const refund = (b, transactionId, requestId = randomUUID()) => tenant(b.id, () => refunds.refundAwardTransaction({
  staff: b.staff, transactionId, requestId, reason: 'Fixture refund'
}));
const balance = customerId => one('SELECT points,lifetime_points FROM customer_balances WHERE customer_id=$1', [customerId]);

// The shared ledger expectation (ledgerExpectationSql) matches the stored balance.
async function assertReconciled(b, customerId) {
  const report = await tenant(b.id, () => recon.runLedgerReconciliation({ businessId: b.id, customerId, persist: false }));
  assert.equal(report.checkedCustomers, 1);
  assert.deepEqual(report.findings, []);
}

// Receipt time is immutable for application roles; the fixture superuser
// moves reward rows into the past to model elapsed time.
async function backdateRewards(customerId, days) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(`UPDATE transactions SET created_at = now() - make_interval(days => $2)
      WHERE customer_id = $1 AND type IN ('ACHIEVEMENT','CHALLENGE')`, [customerId, days]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function achievement(b, values) {
  return one(`INSERT INTO achievements(business_id,name,requirement_type,requirement_value,points_reward)
    VALUES($1,$2,$3,$4,$5) RETURNING *`, [b.id, values.name, values.type, values.value, values.reward]);
}

async function challenge(b, values) {
  return one(`INSERT INTO challenges(business_id,name,challenge_type,requirement_type,requirement_value,reward_points,start_date,end_date,recurrence,max_completions)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
  [b.id, values.name, values.recurrence ? 'recurring' : 'limited_time', values.type, values.value, values.reward,
    values.start ?? new Date(Date.now() - 86400000), values.end ?? null, values.recurrence ?? null, values.max ?? null]);
}

async function referralFixture(b, { enabled = true, min = null, onSignup = false, referrerReward = 100, referredReward = 50 } = {}) {
  await db.query(`INSERT INTO referral_settings(business_id,enabled,referrer_reward_points,referred_reward_points,min_purchase_to_complete,reward_on_signup)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(business_id) DO UPDATE SET enabled=EXCLUDED.enabled,
      referrer_reward_points=EXCLUDED.referrer_reward_points,referred_reward_points=EXCLUDED.referred_reward_points,
      min_purchase_to_complete=EXCLUDED.min_purchase_to_complete,reward_on_signup=EXCLUDED.reward_on_signup`,
  [b.id, enabled, referrerReward, referredReward, min, onSignup]);
  const referrer = await customer(b), referred = await customer(b);
  const code = await one(`INSERT INTO referral_codes(business_id,referrer_customer_id,code) VALUES($1,$2,$3) RETURNING *`,
    [b.id, referrer, `R${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`]);
  const referral = await one(`INSERT INTO referrals(business_id,referral_code_id,referrer_customer_id,referred_customer_id,status)
    VALUES($1,$2,$3,$4,'pending') RETURNING *`, [b.id, code.id, referrer, referred]);
  return { referrer, referred, referral, code };
}

suite('engagement rewards against disposable PostgreSQL', { concurrency: false }, () => {
  before(async () => {
    const target = new URL(url);
    assert.equal(target.hostname, '127.0.0.1');
    assert.ok(Number(target.port) > 1024 && target.port !== '5432', 'Use a disposable non-default port');
    assert.equal(target.pathname, '/engagement_rewards_test');
    assert.equal(process.env.PF_DOMAIN_ISOLATED, '1', 'Use the isolated domain runner');
    assert.equal(process.env.DB_NAME, 'engagement_rewards_test');
    db = new pg.Pool({ connectionString: url, max: 4 });
    [app, achievements, challenges, { ReferralService: referrals }, refunds, derived, recon] = await Promise.all([
      import('../../src/app/database.js'),
      import('../../src/app/services/gamification/achievements-service.js'),
      import('../../src/app/services/gamification/challenges-service.js'),
      import('../../src/app/services/referral-service.js'),
      import('../../src/app/services/loyalty-ops-service.js'),
      import('../../src/app/services/customer-derived-state.js'),
      import('../../src/app/services/ledger-reconciliation-service.js')
    ]);
  });
  after(async () => { await app?.closeDatabase(); await db?.end(); });

  it('unfinished weekly progress does not carry into a later week', async () => {
    const b = await business(), c = await customer(b);
    const weekly = await challenge(b, { name: '3 visitas esta semana', type: 'visits', value: 3, reward: 30, recurrence: 'weekly', start: new Date(Date.now() - 60 * 86400000) });
    // Two visits recorded two weeks ago.
    await db.query(`INSERT INTO customer_challenges(customer_id,challenge_id,progress,updated_at) VALUES($1,$2,2,now()-interval '14 days')`, [c, weekly.id]);
    const tx = await purchase(b, c, { visits: 1 });
    const done = await tenant(b.id, () => challenges.updateChallengeProgress(c, 'visits', 1, { sourceTransactionId: tx }));
    assert.equal(done.length, 0);
    const row = await one('SELECT progress,completed,times_completed FROM customer_challenges WHERE customer_id=$1 AND challenge_id=$2', [c, weekly.id]);
    assert.deepEqual(row, { progress: 1, completed: false, times_completed: 0 });
    assert.equal(await count("SELECT count(*) n FROM transactions WHERE customer_id=$1 AND type='CHALLENGE'", [c]), 0);
    // The wallet shows the current week only, before any new visit too.
    await db.query(`UPDATE customer_challenges SET updated_at=now()-interval '14 days' WHERE customer_id=$1`, [c]);
    const listed = await tenant(b.id, () => challenges.getCustomerChallenges(c, b.id));
    assert.equal(listed.find(item => item.id === weekly.id).progress, 0);
    assert.equal(Object.hasOwn(listed[0], 'progress_updated_at'), false);
  });

  it('a redemption and an unrelated refund keep points and streak achievements', async () => {
    const b = await business(), c = await customer(b);
    await achievement(b, { name: 'Points Collector', type: 'points', value: 1000, reward: 100 });
    await achievement(b, { name: 'Week Warrior', type: 'streak', value: 3, reward: 75 });
    const day = n => new Date(Date.UTC(2026, 9, n, 15)).toISOString();
    for (const n of [1, 2, 3]) await purchase(b, c, { amount: 340, points: 340, at: day(n) });
    const earned = await tenant(b.id, () => achievements.checkAndAwardAchievements(c));
    assert.deepEqual(earned.map(item => item.name).sort(), ['Points Collector', 'Week Warrior']);
    await redeem(b, c, 900);
    await purchase(b, c, { amount: 5, points: 5, at: day(20) }); // breaks the running streak
    const unrelated = await purchase(b, c, { amount: 10, points: 10 });
    const result = await refund(b, unrelated);
    assert.equal(result.gamificationReconciliation.achievementsRevoked, 0);
    assert.equal(await count('SELECT count(*) n FROM customer_achievements WHERE customer_id=$1', [c]), 2);
    assert.equal((await balance(c)).points, 1020 + 175 - 900 + 5);
  });

  it('refunding the purchase that made an achievement possible still revokes it and its reward', async () => {
    const b = await business(), c = await customer(b);
    await achievement(b, { name: 'Points Collector', type: 'points', value: 1000, reward: 100 });
    await purchase(b, c, { amount: 600, points: 600 });
    const crossing = await purchase(b, c, { amount: 400, points: 400 });
    await tenant(b.id, () => achievements.checkAndAwardAchievements(c, 'purchase', { sourceTransactionId: crossing }));
    assert.deepEqual(await balance(c), { points: 1100, lifetime_points: 1100 });
    const result = await refund(b, crossing);
    assert.equal(result.gamificationReconciliation.achievementsRevoked, 1);
    // The reward reversal leaves lifetime points equal to the ledger.
    assert.deepEqual(await balance(c), { points: 600, lifetime_points: 600 });
    await assertReconciled(b, c);
  });

  it('revoking an expired achievement or challenge reward does not deduct the expired points again', async () => {
    const b = await business({ program: { points_expiration_days: 90 } }), c = await customer(b);
    await achievement(b, { name: 'First Purchase', type: 'visits', value: 1, reward: 10 });
    await challenge(b, { name: 'Primera visita', type: 'visits', value: 1, reward: 5, start: new Date(Date.now() - 200 * 86400000) });
    // The visit itself earns no points, so only the rewards can expire.
    const visit = await purchase(b, c, { visits: 1 });
    await tenant(b.id, () => achievements.checkAndAwardAchievements(c, 'purchase', { sourceTransactionId: visit }));
    await tenant(b.id, () => challenges.updateChallengeProgress(c, 'visits', 1, { sourceTransactionId: visit }));
    assert.deepEqual(await balance(c), { points: 15, lifetime_points: 15 });
    await backdateRewards(c, 100);
    assert.deepEqual(await tenant(b.id, () => refunds.expirePointsForCustomer(c, b.id)), { expiredCount: 2, expiredPoints: 15, deductedPoints: 15 });
    assert.deepEqual(await balance(c), { points: 0, lifetime_points: 15 });

    const result = await refund(b, visit);
    assert.equal(result.gamificationReconciliation.achievementsRevoked, 1);
    assert.equal(result.gamificationReconciliation.challengesRevoked, 1);
    assert.equal(await count('SELECT count(*) n FROM customer_achievements WHERE customer_id=$1', [c]), 0);
    // Expiry already removed these points; the revocation does not deduct them again.
    assert.deepEqual(await balance(c), { points: 0, lifetime_points: 15 });
    assert.equal(await count("SELECT count(*) n FROM transactions WHERE customer_id=$1 AND source='reversal' AND type IN ('ACHIEVEMENT','CHALLENGE')", [c]), 0);
    await assertReconciled(b, c);
  });

  it('concurrent award checks pay an achievement and a challenge exactly once', async () => {
    const b = await business(), c = await customer(b);
    await achievement(b, { name: 'First Purchase', type: 'visits', value: 1, reward: 10 });
    const daily = await challenge(b, { name: 'Visita hoy', type: 'visits', value: 1, reward: 5, recurrence: 'daily' });
    // Concurrent purchases by the same customer run their hooks at the same time.
    const sources = [];
    for (let i = 0; i < 6; i++) sources.push(await purchase(b, c, { visits: 1 }));
    await Promise.all(sources.map(tx => tenant(b.id, () => achievements.checkAndAwardAchievements(c, 'purchase', { sourceTransactionId: tx }))));
    await Promise.all(sources.map(tx => tenant(b.id, () => challenges.updateChallengeProgress(c, 'visits', 1, { sourceTransactionId: tx }))));
    assert.equal(await count("SELECT count(*) n FROM transactions WHERE customer_id=$1 AND type='ACHIEVEMENT'", [c]), 1);
    assert.equal(await count("SELECT count(*) n FROM transactions WHERE customer_id=$1 AND type='CHALLENGE'", [c]), 1);
    assert.deepEqual(await balance(c), { points: 15, lifetime_points: 15 });
    const progress = await one('SELECT times_completed FROM customer_challenges WHERE customer_id=$1 AND challenge_id=$2', [c, daily.id]);
    assert.equal(progress.times_completed, 1);
    const earned = await one('SELECT reward_transaction_id FROM customer_achievements WHERE customer_id=$1', [c]);
    assert.ok(earned.reward_transaction_id, 'the earned row links its reward');
  });

  it('one-time challenge reconciliation counts only purchases inside the challenge dates', async () => {
    const b = await business(), c = await customer(b);
    const before = [];
    for (let i = 0; i < 4; i++) before.push(await purchase(b, c, { visits: 1, at: new Date(Date.now() - (10 + i) * 86400000).toISOString() }));
    const limited = await challenge(b, { name: '3 visitas en noviembre', type: 'visits', value: 3, reward: 40, start: new Date(Date.now() - 3 * 86400000) });
    const inside = await purchase(b, c, { visits: 1 });
    await tenant(b.id, () => challenges.updateChallengeProgress(c, 'visits', 1, { sourceTransactionId: inside }));
    // Refunding a purchase from before the challenge must not mark it completed without a reward.
    await refund(b, before[0]);
    let row = await one('SELECT progress,completed,times_completed FROM customer_challenges WHERE customer_id=$1 AND challenge_id=$2', [c, limited.id]);
    assert.deepEqual(row, { progress: 1, completed: false, times_completed: 0 });
    assert.equal(await count("SELECT count(*) n FROM transactions WHERE customer_id=$1 AND type='CHALLENGE'", [c]), 0);

    // Complete it inside the dates, then refund an in-window purchase: the reward is revoked
    // even though earlier purchases would make the lifetime total large enough.
    const second = await purchase(b, c, { visits: 1 });
    await tenant(b.id, () => challenges.updateChallengeProgress(c, 'visits', 1, { sourceTransactionId: second }));
    const third = await purchase(b, c, { visits: 1 });
    const completed = await tenant(b.id, () => challenges.updateChallengeProgress(c, 'visits', 1, { sourceTransactionId: third }));
    assert.equal(completed.length, 1);
    const result = await refund(b, third);
    assert.equal(result.gamificationReconciliation.challengesRevoked, 1);
    row = await one('SELECT progress,completed,times_completed FROM customer_challenges WHERE customer_id=$1 AND challenge_id=$2', [c, limited.id]);
    assert.deepEqual(row, { progress: 2, completed: false, times_completed: 0 });
    assert.equal(await count("SELECT count(*) n FROM transactions WHERE customer_id=$1 AND type='CHALLENGE' AND source<>'reversal' AND status='POSTED'", [c]), 0);
    assert.deepEqual(await balance(c), { points: 0, lifetime_points: 0 });
    await assertReconciled(b, c);
  });

  it('referral rewards stop when the owner disables the program or the plan drops it', async () => {
    const b = await business();
    const off = await referralFixture(b, { enabled: false });
    await purchase(b, off.referred, { amount: 50, points: 50 });
    assert.equal(await tenant(b.id, () => referrals.checkAndCompleteReferral(off.referred)), null);
    assert.equal((await one('SELECT status FROM referrals WHERE id=$1', [off.referral.id])).status, 'pending');
    await assert.rejects(tenant(b.id, () => referrals.applyReferralCode(off.code.code, randomUUID(), b.id)), { statusCode: 403 });

    const small = await business({ plan: 'EMPRENDEDOR' });
    const planless = await referralFixture(small, { enabled: true });
    await purchase(small, planless.referred, { amount: 50, points: 50 });
    await tenant(small.id, () => referrals.checkAndCompleteReferral(planless.referred));
    assert.equal((await one('SELECT status FROM referrals WHERE id=$1', [planless.referral.id])).status, 'pending');
    assert.equal(await count("SELECT count(*) n FROM transactions WHERE business_id=$1 AND type='REFERRAL_REWARD'", [small.id]), 0);
  });

  it('refunded purchases do not count toward the referral minimum', async () => {
    const b = await business();
    const r = await referralFixture(b, { min: 100 });
    const refunded = await purchase(b, r.referred, { amount: 150, points: 150 });
    await refund(b, refunded);
    await tenant(b.id, () => referrals.checkAndCompleteReferral(r.referred));
    assert.equal((await one('SELECT status FROM referrals WHERE id=$1', [r.referral.id])).status, 'pending');
    await purchase(b, r.referred, { amount: 120, points: 120 });
    await tenant(b.id, () => referrals.checkAndCompleteReferral(r.referred));
    assert.equal((await one('SELECT status FROM referrals WHERE id=$1', [r.referral.id])).status, 'rewarded');
  });

  it('refunding the qualifying purchase reverses both referral rewards once', async () => {
    const b = await business();
    const r = await referralFixture(b, { min: 100 });
    await purchase(b, r.referrer, { amount: 200, points: 200 });
    const qualifying = await purchase(b, r.referred, { amount: 150, points: 150 });
    await tenant(b.id, () => referrals.checkAndCompleteReferral(r.referred));
    assert.equal((await balance(r.referrer)).points, 300);
    assert.equal((await balance(r.referred)).points, 200);
    const requestId = randomUUID();
    const result = await refund(b, qualifying, requestId);
    assert.equal(result.gamificationReconciliation.referralRewardsReversed, 2);
    assert.deepEqual(await balance(r.referrer), { points: 200, lifetime_points: 200 });
    assert.deepEqual(await balance(r.referred), { points: 0, lifetime_points: 0 });
    const referral = await one('SELECT status,referrer_rewarded_at,referred_rewarded_at FROM referrals WHERE id=$1', [r.referral.id]);
    assert.deepEqual(referral, { status: 'pending', referrer_rewarded_at: null, referred_rewarded_at: null });
    await refund(b, qualifying, requestId); // replay
    assert.equal(await count("SELECT count(*) n FROM transactions WHERE business_id=$1 AND type='REFERRAL_REWARD' AND source='reversal'", [b.id]), 2);
    assert.equal((await balance(r.referrer)).points, 200);
    await assertReconciled(b, r.referrer);
    await assertReconciled(b, r.referred);
  });

  it('a referral whose referrer reward already expired is kept, so a later purchase cannot pay it twice', async () => {
    const b = await business({ program: { points_expiration_days: 90 } });
    const r = await referralFixture(b, { min: 100 });
    await purchase(b, r.referrer, { amount: 200, points: 200 });
    const qualifying = await purchase(b, r.referred, { amount: 150, points: 150 });
    await tenant(b.id, () => referrals.checkAndCompleteReferral(r.referred));
    assert.equal((await balance(r.referrer)).points, 300);
    // Age only the referrer's reward past the expiry window, then expire it.
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(`UPDATE transactions SET created_at = now() - interval '100 days'
        WHERE customer_id = $1 AND type = 'REFERRAL_REWARD'`, [r.referrer]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    const expired = await tenant(b.id, () => refunds.expirePointsForCustomer(r.referrer, b.id));
    assert.equal(expired.deductedPoints, 100);
    assert.equal((await balance(r.referrer)).points, 200);

    const result = await refund(b, qualifying);
    // Reversing only the referred side and reopening the referral would let the
    // next purchase pay the expired referrer side again; the referral is kept.
    assert.equal(result.gamificationReconciliation.referralRewardsReversed, 0);
    assert.equal((await one('SELECT status FROM referrals WHERE id=$1', [r.referral.id])).status, 'rewarded');
    assert.equal((await balance(r.referrer)).points, 200);

    await purchase(b, r.referred, { amount: 150, points: 150 });
    await tenant(b.id, () => referrals.checkAndCompleteReferral(r.referred));
    assert.equal(await count("SELECT count(*) n FROM transactions WHERE customer_id=$1 AND type='REFERRAL_REWARD' AND source<>'reversal'", [r.referrer]), 1);
    await assertReconciled(b, r.referrer);
    await assertReconciled(b, r.referred);
  });

  it('withdrawing a referral re-measures the referrer achievements once', async () => {
    const b = await business();
    await achievement(b, { name: 'Social Butterfly', type: 'referrals', value: 1, reward: 50 });
    const r = await referralFixture(b, { min: 100 });
    await purchase(b, r.referrer, { amount: 200, points: 200 });
    const qualifying = await purchase(b, r.referred, { amount: 150, points: 150 });
    await tenant(b.id, () => referrals.checkAndCompleteReferral(r.referred));
    const earned = await tenant(b.id, () => achievements.checkAndAwardAchievements(r.referrer));
    assert.deepEqual(earned.map(item => item.name), ['Social Butterfly']);
    assert.deepEqual(await balance(r.referrer), { points: 350, lifetime_points: 350 });

    const requestId = randomUUID();
    const result = await refund(b, qualifying, requestId);
    assert.equal(result.gamificationReconciliation.referralRewardsReversed, 2);
    assert.equal(result.gamificationReconciliation.referrerAchievementsRevoked, 1);
    assert.equal(await count('SELECT count(*) n FROM customer_achievements WHERE customer_id=$1', [r.referrer]), 0);
    assert.deepEqual(await balance(r.referrer), { points: 200, lifetime_points: 200 });
    await refund(b, qualifying, requestId); // replay
    assert.equal(await count("SELECT count(*) n FROM transactions WHERE customer_id=$1 AND type='ACHIEVEMENT' AND source='reversal'", [r.referrer]), 1);
    assert.equal((await balance(r.referrer)).points, 200);
    await assertReconciled(b, r.referrer);
    await assertReconciled(b, r.referred);

    // Without negative balances, a referrer who already spent the achievement
    // reward keeps it, as they would keep a referral reward they cannot cover.
    const spent = await referralFixture(b, { min: 100 });
    await purchase(b, spent.referrer, { amount: 200, points: 200 });
    const second = await purchase(b, spent.referred, { amount: 150, points: 150 });
    await tenant(b.id, () => referrals.checkAndCompleteReferral(spent.referred));
    await tenant(b.id, () => achievements.checkAndAwardAchievements(spent.referrer));
    await redeem(b, spent.referrer, 220);
    const kept = await refund(b, second);
    assert.equal(kept.gamificationReconciliation.referralRewardsReversed, 2);
    assert.equal(kept.gamificationReconciliation.referrerAchievementsRevoked, 0);
    assert.equal((await one('SELECT status FROM referrals WHERE id=$1', [spent.referral.id])).status, 'pending');
    assert.equal(await count('SELECT count(*) n FROM customer_achievements WHERE customer_id=$1', [spent.referrer]), 1);
    assert.deepEqual(await balance(spent.referrer), { points: 30, lifetime_points: 250 });
    await assertReconciled(b, spent.referrer);
  });

  it('item milestones count recorded purchases only', async () => {
    const b = await business(), c = await customer(b);
    await achievement(b, { name: 'Coleccionista', type: 'items', value: 3, reward: 20 });
    const row = (values) => db.query(`INSERT INTO transactions(id,business_id,customer_id,staff_user_id,type,amount_q,visits,items,points,status,source)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,'POSTED','online')`, [randomUUID(), b.id, c, b.staff.id, ...values]);
    await row(['PURCHASE', 10, 1, 2]);
    // A manual adjustment that carries an item count is not a purchase.
    await row(['MANUAL_ADJUSTMENT', 0, 0, 5]);
    await refresh(c);
    assert.deepEqual(await tenant(b.id, () => achievements.checkAndAwardAchievements(c)), []);
    await row(['PURCHASE', 5, 1, 1]);
    await refresh(c);
    const earned = await tenant(b.id, () => achievements.checkAndAwardAchievements(c));
    assert.deepEqual(earned.map(item => item.name), ['Coleccionista']);
  });

  it('a refund that leaves the referral qualified, or a signup reward, keeps the referral rewards', async () => {
    const b = await business();
    const r = await referralFixture(b, { min: 100 });
    const first = await purchase(b, r.referred, { amount: 150, points: 150 });
    await purchase(b, r.referred, { amount: 120, points: 120 });
    await tenant(b.id, () => referrals.checkAndCompleteReferral(r.referred));
    const result = await refund(b, first);
    assert.equal(result.gamificationReconciliation.referralRewardsReversed, 0);
    assert.equal((await one('SELECT status FROM referrals WHERE id=$1', [r.referral.id])).status, 'rewarded');

    const signup = await business();
    const s = await referralFixture(signup, { onSignup: true });
    await tenant(signup.id, () => referrals.completeAndRewardReferral(s.referral.id, { trigger: 'signup' }));
    const bought = await purchase(signup, s.referred, { amount: 20, points: 20 });
    await refund(signup, bought);
    assert.equal((await one('SELECT status FROM referrals WHERE id=$1', [s.referral.id])).status, 'rewarded');
  });

  it('rewarded referrals count toward Social Butterfly', async () => {
    const b = await business();
    await achievement(b, { name: 'Social Butterfly', type: 'referrals', value: 2, reward: 150 });
    const first = await referralFixture(b);
    const code = await one('SELECT id FROM referral_codes WHERE referrer_customer_id=$1', [first.referrer]);
    const another = await customer(b);
    await db.query(`INSERT INTO referrals(business_id,referral_code_id,referrer_customer_id,referred_customer_id,status) VALUES($1,$2,$3,$4,'pending')`,
      [b.id, code.id, first.referrer, another]);
    for (const referred of [first.referred, another]) {
      await purchase(b, referred, { amount: 10, points: 10 });
      await tenant(b.id, () => referrals.checkAndCompleteReferral(referred));
    }
    assert.equal(await count("SELECT count(*) n FROM referrals WHERE referrer_customer_id=$1 AND status='rewarded'", [first.referrer]), 2);
    const earned = await tenant(b.id, () => achievements.checkAndAwardAchievements(first.referrer));
    assert.deepEqual(earned.map(item => item.name), ['Social Butterfly']);
  });
});
