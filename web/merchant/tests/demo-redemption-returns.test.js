import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

test('return report demo distinguishes complete follow-up and recent cohorts with an explicit branch scope', async () => {
  const file = new URL('../src/demo-redemption-returns.js', import.meta.url);
  assert.ok(existsSync(file), 'Return report demo fixture must exist');
  const { demoRedemptionReturns } = await import(file.href);
  for (const days of [7, 30, 90]) {
    const url = new URL(`https://example.invalid/api/admin/analytics/redemption-returns?days=${days}`);
    const out = demoRedemptionReturns(url);
    assert.equal(out.cohort.days, days);
    assert.equal(out.follow_up.days, 30);
    assert.equal(out.cohort.customers, out.completed.customers + out.ongoing.customers);
    assert.equal(out.completed.customers, out.completed.returned_customers + out.completed.without_return_customers);
    assert.equal(out.completed.return_rate_pct, days === 90 ? 40 : null);
    assert.equal(out.ongoing.returned_customers <= out.ongoing.customers, true);
    assert.equal(out.scope.branch_id, null);
    assert.ok(out.notes.some(note => /ficticio/i.test(note)));
    assert.deepEqual(demoRedemptionReturns(url), out);
    url.searchParams.set('branch_id', '10000000-0000-4000-8000-000000000001');
    const branch = demoRedemptionReturns(url);
    assert.equal(branch.scope.branch_id, '10000000-0000-4000-8000-000000000001');
    assert.ok(branch.cohort.customers < out.cohort.customers);
    assert.equal(branch.cohort.customers, branch.completed.customers + branch.ongoing.customers);
  }
});
