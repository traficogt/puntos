import test from 'node:test';
import assert from 'node:assert/strict';
import { demoApi } from '../src/demo-api.js';
import { DEMO_TRIAL_NOW, createTrialDemoApi, demoTrialResponse, demoTrialScenario } from '../src/demo-trial.ts';
import { normalizeTrial, trialPhase } from '../src/trial-model.ts';

const client = (api) => (path, options) => api(new URL(path, 'https://preview.invalid'), options);
const json = (body) => ({ method: 'POST', body: JSON.stringify(body) });

test('the scenario comes from ?prueba= and unknown values mean "feature not deployed"', () => {
  assert.equal(demoTrialScenario(new URL('https://x.invalid/demostracion/?prueba=activa')), 'activa');
  assert.equal(demoTrialScenario(new URL('https://x.invalid/demostracion/?prueba=bloqueada#resumen')), 'bloqueada');
  assert.equal(demoTrialScenario(new URL('https://x.invalid/demostracion/?prueba=otra')), 'none');
  assert.equal(demoTrialScenario(new URL('https://x.invalid/demostracion/')), 'none');
  assert.equal(demoTrialScenario(null), 'none');
  assert.equal(demoTrialResponse('none'), null);
});

test('each scenario answers GET /api/admin/trial with a state the owner app can normalise', () => {
  for (const [scenario, phase, days] of [['activa', 'active', 9], ['ultimos-dias', 'ending', 2], ['bloqueada', 'locked', 0], ['convertida', 'paid', 0]]) {
    const call = client(createTrialDemoApi(scenario));
    const state = normalizeTrial(call('/api/admin/trial'), DEMO_TRIAL_NOW);
    assert.equal(trialPhase(state), phase, scenario);
    assert.equal(state.trial.days_left, days, scenario);
    assert.equal(call('/api/admin/plan'), undefined, 'other paths fall through to the regular demo');
  }
  const locked = normalizeTrial(client(createTrialDemoApi('bloqueada'))('/api/admin/trial'), DEMO_TRIAL_NOW);
  assert.ok(locked.billing.purge_after, 'the lock carries the deletion date');
  assert.equal(locked.upgrade_url, '/negocio/#plan');
});

test('without a scenario the trial endpoint is a 404 so no banner renders, including through demoApi', async () => {
  const call = client(createTrialDemoApi('none'));
  assert.throws(() => call('/api/admin/trial'), (error) => error.status === 404);
  assert.equal(call('/api/admin/concierge-request', json({ phone: '55551234' })), undefined);
  await assert.rejects(demoApi('/api/admin/trial'), (error) => error.status === 404);
  const plan = await demoApi('/api/admin/plan');
  assert.equal(plan.plan, 'NEGOCIO', 'the rest of the demo is untouched');
});

test('a locked trial refuses owner mutations with 402 TRIAL_LOCKED and still accepts the upgrade request', () => {
  const call = client(createTrialDemoApi('bloqueada'));
  assert.throws(() => call('/api/admin/rewards', json({ name: 'Café' })), (error) => error.status === 402 && error.code === 'TRIAL_LOCKED' && error.upgrade_url === '/negocio/#plan');
  assert.equal(call('/api/admin/rewards'), undefined, 'reads keep working');
  assert.deepEqual(call('/api/admin/concierge-request', json({ phone: '55551234', business_type: 'Mejorar plan' })), { ok: true, delivered: 'demo' });
  assert.throws(() => call('/api/admin/concierge-request', json({ phone: '123' })), /teléfono/);
  const active = client(createTrialDemoApi('activa'));
  assert.equal(active('/api/admin/rewards', json({})), undefined, 'an active trial writes normally');
});
