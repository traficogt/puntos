import test from 'node:test';
import assert from 'node:assert/strict';
import { demoApi } from '../src/demo-api.js';
import { DEMO_BILLING_NOW, DEMO_CHECKOUT_ID, createBillingDemoApi, demoBillingScenario, demoCheckoutReturnUrl } from '../src/demo-billing.ts';
import { billingStatusCopy, normalizeBilling, normalizeCheckoutStatus, parseBillingReturn } from '../src/billing-model.ts';
import { normalizeTrial, trialPhase } from '../src/trial-model.ts';

const href = 'https://x.invalid/demostracion/?plan=sin-cobro&vista=libre#plan';
const client = (api) => (path, options) => api(new URL(path, 'https://preview.invalid'), options);
const json = (body) => ({ method: 'POST', body: JSON.stringify(body) });

test('the scenario comes from ?plan= and unknown values mean "billing not deployed"', () => {
  assert.equal(demoBillingScenario(new URL('https://x.invalid/demostracion/?plan=activa')), 'activa');
  assert.equal(demoBillingScenario(new URL('https://x.invalid/demostracion/?plan=pago-fallido#plan')), 'pago-fallido');
  assert.equal(demoBillingScenario(new URL('https://x.invalid/demostracion/?plan=NEGOCIO')), 'none', 'the /prueba/?plan= plan codes are not demo scenarios');
  assert.equal(demoBillingScenario(null), 'none');
  const none = client(createBillingDemoApi('none', DEMO_BILLING_NOW, () => href));
  assert.throws(() => none('/api/admin/billing'), (error) => error.status === 404);
  assert.equal(none('/api/admin/trial'), undefined, 'the trial endpoint stays with ?prueba=');
});

test('each scenario answers GET /api/admin/billing with a state the plan page can render', () => {
  const expectations = [
    ['sin-cobro', 'trial', 'En prueba', 'active'],
    ['pago-pendiente', 'trial', 'En prueba', 'active'],
    ['activa', 'active', 'Activo', 'paid'],
    // Converted trials read as "paid" in the trial model whatever the billing status; the plan page tells the rest.
    ['pago-fallido', 'past_due', 'Pago pendiente', 'paid'],
    ['cancelada', 'canceled', 'Cancelado', 'paid'],
  ];
  for (const [scenario, status, badge, phase] of expectations) {
    const call = client(createBillingDemoApi(scenario, DEMO_BILLING_NOW, () => href));
    const view = normalizeBilling(call('/api/admin/billing'));
    assert.equal(view.billing.status, status, scenario);
    assert.equal(view.billing.upgrade_available, true, scenario);
    assert.equal(billingStatusCopy(view).badge, badge, scenario);
    assert.equal(view.catalog.plans.length, 3, scenario);
    const trial = normalizeTrial(call('/api/admin/trial'), DEMO_BILLING_NOW);
    assert.equal(trial.upgrade_available, true, `${scenario}: the banner CTA leads to #plan`);
    assert.equal(trialPhase(trial), phase, scenario);
  }
  const pending = normalizeBilling(client(createBillingDemoApi('pago-pendiente', DEMO_BILLING_NOW, () => href))('/api/admin/billing'));
  assert.equal(pending.billing.checkout_pending.id, DEMO_CHECKOUT_ID);
  assert.match(pending.billing.checkout_pending.url, /plan=activa(&[^#]*)?#plan\?checkout=/);
});

test('the demo checkout returns to the demo itself with the scenario switched to activa', () => {
  const url = demoCheckoutReturnUrl(href, 'chk_x');
  assert.equal(url, '/demostracion/?plan=activa&vista=libre#plan?checkout=chk_x&resultado=exito');
  assert.deepEqual(parseBillingReturn(new URL(url, 'https://x.invalid').hash), { checkoutId: 'chk_x', result: 'exito' });
  const call = client(createBillingDemoApi('sin-cobro', DEMO_BILLING_NOW, () => href));
  const checkout = call('/api/admin/billing/checkout', json({ plan: 'NEGOCIO', currency: 'USD' })).checkout;
  assert.equal(checkout.id, `${DEMO_CHECKOUT_ID}_negocio`);
  assert.match(checkout.url, /^\/demostracion\/\?plan=activa/);
  assert.throws(() => call('/api/admin/billing/checkout', json({ plan: 'PREMIUM' })), (error) => error.code === 'BILLING_PLAN_INVALID');
  const paid = client(createBillingDemoApi('activa', DEMO_BILLING_NOW, () => href));
  assert.equal(normalizeCheckoutStatus(paid(`/api/admin/billing/checkout/${DEMO_CHECKOUT_ID}_negocio`)), 'completed');
  assert.equal(paid(`/api/admin/billing/checkout/${DEMO_CHECKOUT_ID}_negocio`).subscription.plan, 'NEGOCIO');
  assert.throws(() => paid('/api/admin/billing/checkout', json({ plan: 'EMPRESA' })), (error) => error.code === 'BILLING_ALREADY_ACTIVE');
  assert.equal(normalizeCheckoutStatus(client(createBillingDemoApi('pago-pendiente', DEMO_BILLING_NOW, () => href))(`/api/admin/billing/checkout/${DEMO_CHECKOUT_ID}`)), 'pending');
});

test('change upgrades now, cancel ends at the period end, and invoices list the FEL links', () => {
  const call = client(createBillingDemoApi('activa', DEMO_BILLING_NOW, () => href));
  const changed = call('/api/admin/billing/change', json({ plan: 'EMPRESA' })).subscription;
  assert.equal(changed.plan, 'EMPRESA');
  assert.equal(changed.monthly_total_minor, 12900);
  assert.equal(normalizeBilling(call('/api/admin/billing')).billing.plan, 'EMPRESA', 'the state moves with the change');
  const downgraded = call('/api/admin/billing/change', json({ plan: 'NEGOCIO' })).subscription;
  assert.equal(downgraded.plan, 'NEGOCIO', 'the response names the scheduled plan');
  assert.equal(normalizeBilling(call('/api/admin/billing')).billing.plan, 'EMPRESA', 'a downgrade applies next cycle');
  const canceled = call('/api/admin/billing/cancel', json({ at_period_end: true })).subscription;
  assert.equal(canceled.status, 'canceled');
  assert.equal(canceled.cancel_at, canceled.current_period_end);
  assert.throws(() => call('/api/admin/billing/cancel', json({ at_period_end: true })), (error) => error.status === 409);
  const invoices = call('/api/admin/billing/invoices').invoices;
  assert.equal(invoices.length, 2);
  assert.match(invoices[0].tax_invoice_url, /^https:\/\/app\.recurrente\.com\//);
  assert.equal(client(createBillingDemoApi('sin-cobro', DEMO_BILLING_NOW, () => href))('/api/admin/billing/invoices').invoices.length, 0);
  assert.equal(client(createBillingDemoApi('pago-fallido', DEMO_BILLING_NOW, () => href))('/api/admin/billing/invoices').invoices[0].status, 'failed');
});

test('through demoApi the default demo keeps billing undeployed and the rest untouched', async () => {
  await assert.rejects(demoApi('/api/admin/billing'), (error) => error.status === 404);
  await assert.rejects(demoApi('/api/admin/billing/checkout', json({ plan: 'NEGOCIO' })), (error) => error.status === 404);
  await assert.rejects(demoApi('/api/admin/trial'), (error) => error.status === 404);
  assert.equal((await demoApi('/api/admin/plan')).plan, 'NEGOCIO');
  assert.ok(await demoApi('/api/admin/billing/iva.csv'), 'the analytics IVA export keeps answering');
  const paid = client(createBillingDemoApi('activa', DEMO_BILLING_NOW, () => href));
  assert.equal(paid('/api/admin/billing/iva.csv'), undefined, 'a billing scenario leaves the IVA export to analytics');
  assert.equal(paid('/api/admin/plan'), undefined);
});
