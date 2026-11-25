import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLING_UNAVAILABLE_MESSAGE,
  MAX_ONLINE_BRANCHES,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  advancePolling,
  billingErrorMessage,
  billingStatusCopy,
  canCancel,
  canChangePlan,
  canStartCheckout,
  cancelCopy,
  checkoutUrl,
  formatMinor,
  invoiceStatusLabel,
  isBillingUnavailable,
  isSubscriptionBillingPath,
  nextPollDelay,
  normalizeBilling,
  normalizeCheckoutStatus,
  normalizeInvoices,
  parseBillingReturn,
  planChangeCopy,
  planChangeKind,
  pollingCopy,
  quoteLine,
  quotePlans,
  responsePlanName,
  showsInvoices,
  startPolling,
} from '../src/billing-model.ts';

const now = new Date('2026-11-25T15:00:00Z');
const day = (offset) => new Date(now.getTime() + offset * 86_400_000).toISOString();
const catalog = {
  currency: 'USD',
  plans: [
    { id: 'EMPRENDEDOR', name: 'Conecta', unit_amount_minor: 3900, monthly: 39 },
    { id: 'NEGOCIO', name: 'Impulsa', unit_amount_minor: 7900, monthly: 79 },
    { id: 'EMPRESA', name: 'Expande', unit_amount_minor: 12900, monthly: 129 },
  ],
};
const response = (billing, extra = {}) => ({ ok: true, billing, catalog, branches: 1, trial: { status: 'converted', days_left: 0, ends_at: day(-20) }, ...extra });
const active = {
  status: 'active', provider: 'recurrente', currency: 'USD', plan: 'NEGOCIO', plan_name: 'Impulsa', quantity: 2, unit_amount_minor: 7900, monthly_total_minor: 15800,
  current_period_start: day(-10), current_period_end: day(20), cancel_at: null, past_due_since: null, next_payment_attempt_at: null,
  latest_tax_invoice_url: 'https://app.recurrente.com/fel/2', upgrade_available: true, checkout_pending: null,
};

test('money in minor units formats as "USD 79.00" / "Q600.00" with fixed grouping', () => {
  assert.equal(formatMinor(7900, 'USD'), 'USD 79.00');
  assert.equal(formatMinor(129000, 'USD'), 'USD 1,290.00');
  assert.equal(formatMinor(60000, 'GTQ'), 'Q600.00');
  assert.equal(formatMinor(5, 'GTQ'), 'Q0.05');
  assert.equal(formatMinor(-1550, 'USD'), '−USD 15.50');
  assert.equal(formatMinor(1234, 'eur'), 'USD 12.34', 'unknown currencies fall back to USD');
  assert.equal(formatMinor(null, 'USD'), '—');
  assert.equal(formatMinor(Number.NaN, 'USD'), '—');
});

test('the GET /api/admin/billing body normalises status, provider, totals and the pending checkout', () => {
  const view = normalizeBilling(response(active));
  assert.equal(view.billing.status, 'active');
  assert.equal(view.billing.provider, 'recurrente');
  assert.equal(view.billing.monthly_total_minor, 15800);
  assert.equal(view.billing.plan_name, 'Impulsa');
  assert.equal(view.branches, 1);
  assert.deepEqual(view.catalog.plans.map((plan) => plan.id), ['EMPRENDEDOR', 'NEGOCIO', 'EMPRESA']);
  const trial = normalizeBilling(response({ status: 'trial', provider: null, currency: 'USD', plan: 'EMPRENDEDOR', quantity: 1, upgrade_available: true, checkout_pending: { id: 'chk_1', url: 'https://pay.recurrente.com/chk_1', expires_at: day(1) } }, { trial: { status: 'active', days_left: 9, ends_at: day(9) }, branches: 0 }));
  assert.equal(trial.billing.status, 'trial');
  assert.equal(trial.billing.provider, null);
  assert.equal(trial.billing.monthly_total_minor, null);
  assert.deepEqual(trial.billing.checkout_pending, { id: 'chk_1', url: 'https://pay.recurrente.com/chk_1', expires_at: day(1) });
  assert.equal(trial.branches, 1, 'at least one branch is billed');
  assert.equal(trial.trial.days_left, 9);
  const derived = normalizeBilling({ billing: { status: 'ACTIVE', plan: 'empresa', quantity: '3', unit_amount_minor: '12900' }, catalog: { currency: 'GTQ', plans: [{ id: 'EMPRESA', monthly: 999 }] } });
  assert.equal(derived.billing.status, 'active');
  assert.equal(derived.billing.plan, 'EMPRESA');
  assert.equal(derived.billing.plan_name, 'Expande');
  assert.equal(derived.billing.monthly_total_minor, 38700, 'unit × quantity when the server omits the total');
  assert.equal(derived.catalog.currency, 'GTQ');
  assert.equal(derived.catalog.plans[0].unit_amount_minor, 99900, 'monthly is the fallback for the unit');
  assert.equal(normalizeBilling({ ok: true, plan: 'NEGOCIO' }), null, 'a legacy plan response is not billing');
  assert.equal(normalizeBilling({ billing: { status: 'weird' } }), null);
  assert.equal(normalizeBilling(null), null);
  assert.equal(normalizeBilling([]), null);
});

test('plan quotes multiply unit × branches, keep Conecta at one branch and read as Spanish lines', () => {
  const quotes = quotePlans({ catalog, branches: 3 });
  assert.deepEqual(quotes.map((quote) => [quote.plan, quote.quantity, quote.total_minor]), [['EMPRENDEDOR', 1, 3900], ['NEGOCIO', 3, 23700], ['EMPRESA', 3, 38700]]);
  assert.equal(quoteLine(quotes[0]), 'USD 39.00 al mes · 1 sucursal');
  assert.equal(quoteLine(quotes[1]), 'USD 79.00 × 3 sucursales = USD 237.00 al mes');
  assert.equal(quotePlans({ catalog, branches: 0 })[1].quantity, 1);
  assert.equal(planChangeKind('NEGOCIO', 'EMPRESA'), 'upgrade');
  assert.equal(planChangeKind('EMPRESA', 'NEGOCIO'), 'downgrade');
  assert.equal(planChangeKind('NEGOCIO', 'NEGOCIO'), 'same');
  assert.equal(planChangeKind(null, 'EMPRENDEDOR'), 'upgrade');
});

test('status copy maps each subscription status to badge, title and next step', () => {
  const activeCopy = billingStatusCopy(normalizeBilling(response(active)));
  assert.equal(activeCopy.badge, 'Activo');
  assert.equal(activeCopy.title, 'Plan Impulsa activo');
  assert.match(activeCopy.body, /Próximo cobro el .*2026: USD 158\.00 \(2 sucursales × USD 79\.00\)/);
  const pastDue = billingStatusCopy(normalizeBilling(response({ ...active, status: 'past_due', past_due_since: day(-2), next_payment_attempt_at: day(1) })));
  assert.equal(pastDue.badge, 'Pago pendiente');
  assert.match(pastDue.body, /fue rechazado.*volverá a intentar.*7 días/s);
  const canceled = billingStatusCopy(normalizeBilling(response({ ...active, status: 'canceled', cancel_at: day(20) })));
  assert.equal(canceled.badge, 'Cancelado');
  assert.match(canceled.body, /Sigue activo hasta el .*No hay más cobros\./);
  const manual = billingStatusCopy(normalizeBilling(response({ ...active, status: 'manual', provider: 'manual' })));
  assert.equal(manual.badge, 'Acuerdo directo');
  const trial = billingStatusCopy(normalizeBilling(response({ status: 'trial', plan: 'EMPRENDEDOR', upgrade_available: true }, { trial: { status: 'active', days_left: 9, ends_at: day(9) } })));
  assert.equal(trial.badge, 'En prueba');
  assert.equal(trial.title, 'Prueba gratis de Conecta');
  assert.match(trial.body, /^Te quedan 9 días\. La prueba termina el .*Sin cobro hasta que elijas un plan/);
  const oneDay = billingStatusCopy(normalizeBilling(response({ status: 'trial', plan: 'EMPRENDEDOR' }, { trial: { status: 'active', days_left: 1, ends_at: day(1) } })));
  assert.match(oneDay.body, /^Te queda 1 día\./);
  const locked = billingStatusCopy(normalizeBilling(response({ status: 'trial', plan: 'EMPRENDEDOR' }, { trial: { status: 'locked', days_left: 0, ends_at: day(-3) } })));
  assert.equal(locked.title, 'Tu prueba terminó');
  assert.equal(locked.color, 'red');
});

test('change and cancel dialogs explain now_and_charge versus next cycle in plain words', () => {
  const view = normalizeBilling(response(active));
  const quotes = quotePlans(view);
  const upgrade = planChangeCopy(view, quotes[2]);
  assert.equal(upgrade.kind, 'upgrade');
  assert.equal(upgrade.title, 'Cambiar a Expande ahora');
  assert.match(upgrade.body, /Hoy se cobra solo la diferencia proporcional.*pagas USD 129\.00 al mes/);
  assert.equal(upgrade.confirm, 'Cambiar a Expande y pagar la diferencia');
  const downgrade = planChangeCopy(view, quotes[0]);
  assert.equal(downgrade.kind, 'downgrade');
  assert.match(downgrade.body, /Sigues con Impulsa hasta el .*no hay reembolso.*USD 39\.00 al mes.*límites de Conecta/s);
  assert.equal(planChangeCopy(view, quotes[1]).kind, 'same');
  const cancel = cancelCopy(view);
  assert.equal(cancel.title, 'Cancelar al final del período');
  assert.match(cancel.body, /^Tu plan Impulsa sigue activo hasta el .*No se reembolsan los días ya pagados\.$/);
});

test('the Recurrente return URL is read from the hash query and rejected when malformed', () => {
  assert.deepEqual(parseBillingReturn('#plan?checkout=chk_123&resultado=exito'), { checkoutId: 'chk_123', result: 'exito' });
  assert.deepEqual(parseBillingReturn('plan?resultado=cancelado&checkout=chk_9'), { checkoutId: 'chk_9', result: 'cancelado' });
  assert.deepEqual(parseBillingReturn('#plan?checkout=chk_9&resultado=otro'), { checkoutId: 'chk_9', result: null });
  assert.equal(parseBillingReturn('#plan'), null);
  assert.equal(parseBillingReturn('#resumen?checkout=chk_1'), null, 'only the plan page handles returns');
  assert.equal(parseBillingReturn('#plan?checkout='), null);
  assert.equal(parseBillingReturn('#plan?checkout=<script>'), null);
  assert.equal(parseBillingReturn(`#plan?checkout=${'a'.repeat(121)}`), null);
  assert.equal(parseBillingReturn(null), null);
});

test('polling runs every 3 s, stops on a final status, survives transient errors and times out at 2 min', () => {
  assert.equal(POLL_INTERVAL_MS, 3000);
  assert.equal(POLL_TIMEOUT_MS, 120_000);
  const start = 1_000_000;
  let state = startPolling('chk_1', start);
  assert.equal(state.phase, 'polling');
  assert.equal(nextPollDelay(state), 3000);
  state = advancePolling(state, { kind: 'response', status: 'pending' }, start + 3000);
  assert.equal(state.phase, 'polling');
  assert.equal(state.attempts, 1);
  state = advancePolling(state, { kind: 'error', error: new TypeError('Failed to fetch') }, start + 6000);
  assert.equal(state.phase, 'polling', 'a network blip keeps polling');
  const done = advancePolling(state, { kind: 'response', status: 'completed' }, start + 9000);
  assert.equal(done.phase, 'completed');
  assert.equal(nextPollDelay(done), null);
  assert.equal(advancePolling(done, { kind: 'response', status: 'pending' }).phase, 'completed', 'final states are sticky');
  assert.equal(advancePolling(state, { kind: 'response', status: 'expired' }).phase, 'expired');
  assert.equal(advancePolling(state, { kind: 'response', status: 'canceled' }).phase, 'canceled');
  assert.equal(advancePolling(state, { kind: 'error', error: { status: 503, code: 'BILLING_UNAVAILABLE' } }).phase, 'unavailable');
  assert.equal(advancePolling(state, { kind: 'error', error: { status: 404 } }).phase, 'unavailable');
  assert.equal(advancePolling(state, { kind: 'response', status: 'pending' }, start + 116_999).phase, 'polling');
  assert.equal(advancePolling(state, { kind: 'response', status: 'pending' }, start + 117_000).phase, 'timeout', 'no poll would be scheduled past the deadline');
  assert.equal(pollingCopy(done, 'Impulsa').title, 'Tu plan Impulsa está activo');
  assert.equal(pollingCopy(done, null).title, 'Tu plan está activo');
  assert.equal(pollingCopy(state, null).title, 'Confirmando tu pago…');
  assert.match(pollingCopy({ ...state, phase: 'timeout' }, null).body, /vuelve a cargar/);
  assert.match(pollingCopy({ ...state, phase: 'unavailable' }, null).body, new RegExp(BILLING_UNAVAILABLE_MESSAGE));
  assert.equal(normalizeCheckoutStatus({ ok: true, status: 'Completed' }), 'completed');
  assert.equal(normalizeCheckoutStatus({ ok: true, status: 'paid' }), null);
  assert.equal(responsePlanName({ ok: true, status: 'completed', subscription: { plan: 'NEGOCIO' } }), 'Impulsa');
  assert.equal(responsePlanName({ ok: true, subscription: { plan: 'EMPRESA', plan_name: 'Expande Plus' } }), 'Expande Plus');
  assert.equal(responsePlanName({ ok: true, subscription: null }), null);
});

test('the six subscription endpoints are recognised and the analytics IVA export is not', () => {
  for (const path of ['/api/admin/billing', '/api/admin/billing/checkout', '/api/admin/billing/checkout/chk_1', '/api/admin/billing/change', '/api/admin/billing/cancel', '/api/admin/billing/invoices'])
    assert.equal(isSubscriptionBillingPath(path), true, path);
  for (const path of ['/api/admin/billing/iva.csv', '/api/admin/billing/', '/api/admin/billing/checkout/a/b', '/api/admin/billingx', '/api/admin/plan'])
    assert.equal(isSubscriptionBillingPath(path), false, path);
});

test('unavailable billing (404 or 503) and the documented error codes map to Spanish copy', () => {
  assert.equal(isBillingUnavailable({ status: 404 }), true);
  assert.equal(isBillingUnavailable({ status: 503 }), true);
  assert.equal(isBillingUnavailable({ status: 400, code: 'BILLING_UNAVAILABLE' }), true);
  assert.equal(isBillingUnavailable({ status: 409, code: 'BILLING_ALREADY_ACTIVE' }), false);
  assert.equal(isBillingUnavailable(null), false);
  assert.match(billingErrorMessage({ status: 503, code: 'BILLING_UNAVAILABLE' }), new RegExp(`^${BILLING_UNAVAILABLE_MESSAGE}\\.`));
  assert.match(billingErrorMessage({ status: 404 }), new RegExp(BILLING_UNAVAILABLE_MESSAGE));
  assert.match(billingErrorMessage({ status: 409, code: 'BILLING_QUANTITY_LIMIT' }), new RegExp(`hasta ${MAX_ONLINE_BRANCHES} sucursales`));
  assert.match(billingErrorMessage({ status: 409, code: 'BILLING_ALREADY_ACTIVE' }), /ya tiene un plan activo/);
  assert.match(billingErrorMessage({ status: 400, code: 'BILLING_PLAN_INVALID' }), /no está disponible para pago en línea/);
  assert.equal(billingErrorMessage({ status: 500 }), null);
  assert.equal(billingErrorMessage('x'), null);
  assert.equal(checkoutUrl({ ok: true, checkout: { id: 'c', url: 'https://pay.recurrente.com/c' } }), 'https://pay.recurrente.com/c');
  assert.equal(checkoutUrl({ ok: true, checkout: { id: 'c', url: '/demostracion/?plan=activa#plan?checkout=c' } }), '/demostracion/?plan=activa#plan?checkout=c');
  assert.equal(checkoutUrl({ ok: true, checkout: { id: 'c', url: 'javascript:alert(1)' } }), null);
  assert.equal(checkoutUrl({ ok: true }), null);
});

test('what each state offers: checkout for trials, change and cancel for Recurrente subscriptions, invoices once paid', () => {
  const trial = normalizeBilling(response({ status: 'trial', plan: 'EMPRENDEDOR', upgrade_available: true }));
  assert.equal(canStartCheckout(trial), true);
  assert.equal(canChangePlan(trial), false);
  assert.equal(canCancel(trial), false);
  assert.equal(showsInvoices(trial), false);
  assert.equal(canStartCheckout(normalizeBilling(response({ status: 'trial', plan: 'EMPRENDEDOR', upgrade_available: false }))), false, 'no provider, no checkout');
  const paid = normalizeBilling(response(active));
  assert.equal(canStartCheckout(paid), false);
  assert.equal(canChangePlan(paid), true);
  assert.equal(canCancel(paid), true);
  assert.equal(showsInvoices(paid), true);
  const manual = normalizeBilling(response({ ...active, status: 'manual', provider: 'manual', upgrade_available: false }));
  assert.equal(canChangePlan(manual), false);
  assert.equal(canCancel(manual), false);
  assert.equal(showsInvoices(manual), false);
  const pastDue = normalizeBilling(response({ ...active, status: 'past_due' }));
  assert.equal(canChangePlan(pastDue), false);
  assert.equal(canCancel(pastDue), true);
  const canceled = normalizeBilling(response({ ...active, status: 'canceled', cancel_at: day(20) }));
  assert.equal(canCancel(canceled), false);
  assert.equal(showsInvoices(canceled), true);
  const invoices = normalizeInvoices({ ok: true, invoices: [{ occurred_at: day(-40), amount_minor: 7900, currency: 'USD', status: 'paid', tax_invoice_url: 'https://fel/1' }, { occurred_at: day(-10), amount_minor: 7900, currency: 'USD', status: 'failed', tax_invoice_url: null }, { amount_minor: 'x' }] });
  assert.equal(invoices.length, 2);
  assert.equal(invoices[0].status, 'failed', 'newest first');
  assert.equal(invoiceStatusLabel('paid'), 'Pagado');
  assert.equal(invoiceStatusLabel('failed'), 'Rechazado');
  assert.equal(invoiceStatusLabel('custom'), 'custom');
  assert.deepEqual(normalizeInvoices({ ok: true }), []);
});
