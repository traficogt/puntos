import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../src/app/services/customer-reward-progress.js').catch(() => null);
const now = '2026-11-11T12:00:00Z';
const reward = (id, points_cost, extra = {}) => ({ id, name: id, points_cost, active: true, available: true, branch_ids: [], ...extra });
const snapshot = {
  business_id: 'business-a', customer_id: 'customer-a', points: 40, pending_points: 100,
  snapshot_at: now, program_type: 'VISIT', program_json: { points_per_visit: 10 },
  wallet_branches: [{ id: 'center', name: 'Centro' }], wallet_rewards: [reward('Grande', 100), reward('Café', 20)]
};
async function progress(source = snapshot) {
  const module = await load();
  assert.equal(typeof module?.getCustomerRewardProgress, 'function');
  const calls = [];
  const result = await module.getCustomerRewardProgress({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: source ? [source] : [] }; } }, { businessId: 'business-a', customerId: 'customer-a' });
  return { result, calls };
}

test('customer progress prefers an affordable choice, separates pending points and exposes only public fields', async () => {
  const { result, calls } = await progress({ ...snapshot, membership_token: 'private-token', authentication_token: 'private-auth' });
  assert.equal(result.reward.name, 'Café');
  assert.equal(result.reward.remaining_points, 0);
  assert.equal(result.available_points, 40);
  assert.equal(result.pending_points, 100);
  assert.equal(Date.parse(result.as_of), Date.parse(now));
  assert.doesNotMatch(JSON.stringify(result), /private-token|private-auth|membership|authentication/);
  assert.deepEqual(calls[0].params, ['business-a', 'customer-a']);
  assert.match(calls[0].sql, /c\.business_id=\$1 AND c\.id=\$2/);
  assert.doesNotMatch(calls[0].sql, /native_wallet_passes/);
});

test('protected original terms and scoped choices override the current catalog without spending pending points', async () => {
  const { result } = await progress({ ...snapshot, wallet_cycle: { program_type: 'VISIT', earning_terms: { points_per_visit: 5 } }, wallet_rewards: [reward('Changed', 50, { active: false, promise_id: 'promise', reward_name: 'Café original', branch_ids: ['center'], valid_until: '2026-11-12T12:00:00Z' })] });
  assert.equal(result.reward.name, 'Café original');
  assert.equal(result.reward.remaining_points, 10);
  assert.equal(result.reward.protected, true);
  assert.match(result.conditions, /Centro/);
  assert.match(result.earning, /5 puntos por visita/);
  assert.equal(result.choices[0].name, 'Café original');
  assert.equal(result.choices[0].points_cost, 50);
  assert.equal(result.choices[0].protected, true);
  assert.deepEqual(result.choices[0].branch_labels, ['Centro']);
  assert.equal(result.next_refresh_at, '2026-11-12T12:00:00.000Z');
});

test('current daily guards exclude a target and keep a deadline without inventing a replacement', async () => {
  const { result } = await progress({ ...snapshot, program_json: { ...snapshot.program_json, redemption_guard: { max_redemptions_per_day: 1 } }, wallet_daily_redemptions: 1, wallet_next_day: '2026-11-12T06:00:00Z' });
  assert.equal(result.reward, null);
  assert.ok(result.choices.every(choice => choice.available === false));
  assert.equal(result.next_refresh_at, '2026-11-12T06:00:00.000Z');
});

test('missing or cross-tenant customer has no progress', async () => {
  assert.equal((await progress(null)).result, null);
});
