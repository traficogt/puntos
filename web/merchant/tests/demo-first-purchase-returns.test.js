import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoFirstPurchaseReturns } from '../src/demo-first-purchase-returns.js';

const endpoint = 'https://example.invalid/api/admin/analytics/first-purchase-returns';
test('first-purchase demo provides deterministic weekly cohorts and complete denominators', () => {
  const recent = demoFirstPurchaseReturns(new URL(endpoint));
  assert.equal(recent.cohort.week_start, '2026-11-09');
  assert.equal(recent.available_weeks.length, 52);
  assert.equal(new Set(recent.available_weeks).size, 52);
  assert.equal(recent.completed.return_rate_pct, null);
  assert.ok(recent.ongoing.customers > 0);
  for (const week of recent.available_weeks) {
    assert.equal(new Date(`${week}T12:00:00Z`).getUTCDay(), 1);
    for (const branch of ['', '10000000-0000-4000-8000-000000000001']) {
      const url = new URL(`${endpoint}?week_start=${week}&branch_id=${branch}`);
      const out = demoFirstPurchaseReturns(url);
      assert.deepEqual(demoFirstPurchaseReturns(url), out);
      assert.equal(out.cohort.week_start, week);
      assert.equal(out.cohort.customers, out.completed.customers + out.ongoing.customers);
      assert.equal(out.completed.customers, out.completed.returned_customers + out.completed.without_return_customers);
      assert.ok(out.ongoing.returned_customers <= out.ongoing.customers);
      assert.equal(out.scope.first_purchase_scope, 'business');
      assert.equal(out.scope.return_scope, 'business');
      assert.match(out.notes.join(' '), /ficticio/);
    }
  }
  const mature = demoFirstPurchaseReturns(new URL(`${endpoint}?week_start=2026-10-05`));
  assert.equal(mature.completed.return_rate_pct, 40);
  assert.equal(mature.ongoing.customers, 0);
  const split = demoFirstPurchaseReturns(new URL(`${endpoint}?week_start=2026-10-12`));
  assert.ok(split.completed.customers > 0 && split.ongoing.customers > 0);
  const empty = demoFirstPurchaseReturns(new URL(`${endpoint}?week_start=2025-12-01`));
  assert.equal(empty.cohort.customers, 0);
});
