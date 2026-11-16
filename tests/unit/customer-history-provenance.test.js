import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePointRules, completeAwardEvidence } from '../../src/app/services/transaction-rule-evidence.js';

const load = () => import('../../src/app/services/customer-history-provenance.js').catch(() => null);
async function classify(row) {
  const module = await load();
  assert.equal(typeof module?.customerPointProvenance, 'function');
  return module.customerPointProvenance({ type: 'PURCHASE', source: 'online', status: 'POSTED', points_delta: 20, amount_q: 100, visits: 0, items: 0, ...row });
}

test('customer history classifies documented origins without treating every positive entry as a purchase', async () => {
  for (const [row, kind] of [
    [{}, 'purchase'], [{ source: 'offline' }, 'purchase'], [{ source: 'external' }, 'purchase'], [{ source: 'order' }, 'purchase'],
    [{ type: 'REFERRAL_REWARD' }, 'referral_bonus'], [{ type: 'ACHIEVEMENT' }, 'achievement_bonus'],
    [{ type: 'CHALLENGE' }, 'challenge_bonus'], [{ type: 'TIER_BONUS' }, 'other_bonus'],
    [{ source: 'lifecycle', meta: { event_type: 'birthday_bonus' } }, 'birthday_bonus'],
    [{ source: 'lifecycle', meta: { event_type: 'winback_bonus' } }, 'other_bonus'],
    [{ type: 'OPENING_BALANCE', source: 'migration' }, 'opening_balance'],
    [{ source: 'redeem', points_delta: -20 }, 'redemption'], [{ source: 'expire', points_delta: -20 }, 'expiry'],
    [{ source: 'reversal', type: 'REFUND', points_delta: -20 }, 'reversal'],
    [{ type: 'MANUAL_ADJUSTMENT' }, 'adjustment'],
    [{ type: 'REDEMPTION', source: 'redeem', points_delta: -20 }, 'redemption'],
    [{ source: 'redeem', points_delta: 0 }, 'redemption'],
    [{ type: 'ADJUSTMENT', source: 'pos_checkout_cancel', points_delta: 0 }, 'reversal'],
    [{ type: 'ACHIEVEMENT', source: 'reversal', points_delta: -20, has_original_transaction: true }, 'reversal'],
    [{ type: 'CHALLENGE', source: 'reversal', points_delta: -20, has_original_transaction: true }, 'reversal']
  ]) assert.equal((await classify(row)).kind, kind, JSON.stringify(row));
});

test('unknown and contradictory legacy provenance stays unknown; status is independent', async () => {
  for (const row of [
    { type: null, source: null }, { type: 'PURCHASE', source: 'mystery' },
    { type: 'ACHIEVEMENT', source: 'referral' }, { type: 'OPENING_BALANCE', source: 'redeem' },
    { source: 'lifecycle', meta: { event_type: 'unrecognized' } },
    { source: 'redeem', points_delta: 20 }, { type: 'REFERRAL_REWARD', points_delta: -20 },
    { type: 'ACHIEVEMENT', source: 'reversal', points_delta: -20, has_original_transaction: false }
  ]) assert.equal((await classify(row)).kind, 'unknown');
  for (const status of ['PENDING', 'EXPIRED', 'REVERSED', 'POSTED']) assert.equal((await classify({ status })).status, status);
  assert.equal((await classify({ status: 'other' })).status, 'UNKNOWN');
  assert.equal((await classify({ status: null })).status, 'UNKNOWN');
  assert.equal((await classify({ status: 'POSTED', reversed_transaction_id: 'reversal' })).status, 'REVERSED');
});

test('purchase bonus evidence gives a boolean without inventing a split or exposing private evidence', async () => {
  const evaluated = evaluatePointRules({ program_type: 'SPEND', program_json: { points_per_q: 0.1 } }, { amount_q: 100 }, { now: new Date('2026-11-16T12:00:00Z'), timeZone: 'America/Guatemala' });
  const evidence = completeAwardEvidence(evaluated.evidence, { bonus: { bonusPoints: 10, campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, holdDays: 0, status: 'POSTED', availableAt: null });
  const result = await classify({ meta: { award_evidence: evidence, staff_note: 'PRIVATE' } });
  assert.deepEqual(result, { kind: 'purchase', status: 'POSTED', includes_bonus: true });
  assert.equal((await classify({ meta: { award_evidence: { ...evidence, awarded_points: 999 } } })).includes_bonus, false);
  assert.equal((await classify({ meta: { bonus_points: 10, achievement_name: '<script>PRIVATE</script>' } })).includes_bonus, false);
  assert.equal((await classify({})).includes_bonus, false);
});
