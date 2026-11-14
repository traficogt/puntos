import assert from 'node:assert/strict';
import { it } from 'node:test';
import { assertPurchaseTimeReplay } from '../../src/app/services/purchase-event-time.js';

it('compares PostgreSQL Date values without losing receipt millisecond precision', () => {
  const transaction = { purchase_occurred_at: new Date('2026-01-02T15:30:00.123Z') };
  assert.doesNotThrow(() => assertPurchaseTimeReplay(transaction, '2026-01-02T15:30:00.123Z'));
  assert.throws(() => assertPurchaseTimeReplay(transaction, '2026-01-02T15:30:00.124Z'), { statusCode: 409 });
  assert.doesNotThrow(() => assertPurchaseTimeReplay(transaction, undefined));
  assert.doesNotThrow(() => assertPurchaseTimeReplay({}, '2026-01-02T15:30:00.123Z'));
});
