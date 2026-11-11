import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { it } from 'node:test';

it('accepts only code-supplied unqualified SQL aliases for the reporting predicate', async () => {
  const module = new URL('../../src/app/services/reporting-purchase.js', import.meta.url);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository module URL.
  assert.ok(existsSync(module), 'The shared reporting purchase predicate must exist');
  const { reportingPurchase } = await import(module.href);
  assert.equal(typeof reportingPurchase('t'), 'string');
  assert.match(reportingPurchase('first_purchase2'), /first_purchase2\.source/);
  assert.match(reportingPurchase('_purchase'), /_purchase\.source/);
  for (const alias of ['', 'a.b', 't ', '1t', '"t"', 't;DROP TABLE transactions', null, undefined, 1, {}, 't\n']) {
    assert.throws(() => reportingPurchase(alias), TypeError);
  }
});
