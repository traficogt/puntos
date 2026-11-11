import assert from 'node:assert/strict';
import { test } from 'node:test';
const module = await import('../src/demo-transactions.js').catch(() => ({}));
const base = '/api/admin/transaction-history';
test('synthetic history supports filters, pages, exact lookup and honest partial history', async () => {
  assert.equal(typeof module.demoTransactions, 'function', 'demo history must be available');
  const first = await module.demoTransactions(new URL(`${base}?limit=2`, 'http://fixture'));
  assert.equal(first.movements.length, 2); assert.ok(first.next_cursor);
  const second = await module.demoTransactions(new URL(`${base}?limit=2&cursor=${first.next_cursor}`, 'http://fixture'));
  assert.equal(second.movements.some(row => first.movements.some(prior => prior.id === row.id)), false);
  const filtered = await module.demoTransactions(new URL(`${base}?kind=refund`, 'http://fixture'));
  assert.equal(filtered.movements.length, 1); assert.equal(filtered.movements[0].kind, 'refund');
  const details = await module.demoTransactions(new URL(`${base}/${first.movements[0].id}`, 'http://fixture'));
  assert.equal(details.explanation.coverage, 'recorded'); assert.equal(details.explanation.award.awarded_points, details.movement.points);
  const old = await module.demoTransactions(new URL(`${base}/${first.movements[1].id}`, 'http://fixture'));
  assert.equal(old.explanation.coverage, 'partial'); assert.equal(old.explanation.award, null);
  await assert.rejects(module.demoTransactions(new URL(`${base}/ffffffff-ffff-4fff-8fff-ffffffffffff`, 'http://fixture')), { status: 404 });
  await assert.rejects(module.demoTransactions(new URL(base, 'http://fixture'), { method: 'POST' }), { status: 405 });
});
test('demo drill-down honors staff, source, branch and interval filters',async()=>{
 const staff='bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
 const one=await module.demoTransactions(new URL(`${base}?staff_id=${staff}&source_group=staff&start=2026-11-11T17:30:00.000Z&end=2026-11-11T18:30:00.000Z`,'http://fixture'));
 assert.equal(one.movements.length,1);assert.equal(one.movements[0].source,'online');
 const other=await module.demoTransactions(new URL(`${base}?staff_id=ffffffff-ffff-4fff-8fff-ffffffffffff`,'http://fixture'));assert.equal(other.movements.length,0);
 const pos=await module.demoTransactions(new URL(`${base}?source_group=pos`,'http://fixture'));assert.equal(pos.movements.length,1);
});
