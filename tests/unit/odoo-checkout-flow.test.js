import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function flow() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed module fixture path.
  const source = await readFile(new URL('../../integrations/odoo/pf_pos_connector/static/src/checkout_flow.js', import.meta.url), 'utf8').catch(() => 'export const missing = true;');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
test('checkout waits for durable preparation before requesting authorization', async () => {
  const module = await flow(); assert.equal(typeof module.prepareAndAuthorize, 'function');
  const calls = [];
  const result = await module.prepareAndAuthorize({
    sync: async () => calls.push('sync'),
    prepare: async selection => { calls.push('persist'); assert.equal(selection.rewardId, 'reward'); return {requestId:'immutable',state:'pending'}; },
    authorize: async id => { calls.push('authorize'); assert.equal(id, 'immutable'); return {state:'authorized'}; },
    reload: async () => calls.push('reload'),
  }, {rewardId:'reward'});
  assert.deepEqual(calls, ['sync','persist','authorize','reload']); assert.equal(result.state, 'authorized');
});
test('failed durable preparation cannot start a remote debit', async () => {
  const module = await flow(); assert.equal(typeof module.prepareAndAuthorize, 'function'); let authorized = false;
  await assert.rejects(module.prepareAndAuthorize({sync:async()=>{},prepare:async()=>{throw Error('offline');},authorize:async()=>{authorized=true;},reload:async()=>{}}, {}), /offline/);
  assert.equal(authorized, false);
});
test('a lost authorization response reloads persisted state without inventing success', async () => {
  const module = await flow(); assert.equal(typeof module.prepareAndAuthorize, 'function'); let reloaded = 0;
  await assert.rejects(module.prepareAndAuthorize({sync:async()=>{},prepare:async()=>({requestId:'same'}),authorize:async()=>{throw Error('offline');},reload:async()=>reloaded++}, {}), /offline/);
  assert.equal(reloaded, 1);
});
test('cancellation persists before the remote call', async () => {
  const module = await flow(); assert.equal(typeof module.prepareAndCancel, 'function'); const calls = [];
  await module.prepareAndCancel({prepareCancel:async()=>calls.push('persist'),cancel:async()=>{calls.push('send');return {state:'cancelled'};},reload:async()=>calls.push('reload')}, 'same', 'Customer changed their mind');
  assert.deepEqual(calls, ['persist','send','reload']);
});
test('receipt confirmation requires a paid server order and every authorization linked', async () => {
  const module = await flow(); assert.equal(typeof module.isConfirmedCheckout, 'function');
  assert.equal(module.isConfirmedCheckout({orderState:'draft',intents:[{state:'authorized'}]}), false);
  assert.equal(module.isConfirmedCheckout({orderState:'paid',intents:[{state:'pending'}]}), false);
  assert.equal(module.isConfirmedCheckout({orderState:'paid',intents:[{state:'recorded'}]}), true);
  assert.equal(module.isConfirmedCheckout({orderState:'invoiced',intents:[{state:'recorded'},{state:'cancelled'}]}), true);
});
test('empty Odoo JSON fields produce no checkout intents', async () => {
  const module = await flow(); assert.equal(typeof module.checkoutIntents, 'function');
  for (const value of [undefined, null, false, {}, []]) {
    assert.deepEqual(module.checkoutIntents({pf_checkout_summary:value}), []);
  }
  assert.deepEqual(module.checkoutIntents({pf_checkout_summary:[{state:'pending'}]}), [{state:'pending'}]);
});
